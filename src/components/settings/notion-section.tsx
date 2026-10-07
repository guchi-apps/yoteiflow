"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConnectionStatusBadge } from "@/components/settings/connection-status-badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  TASK_FIELD_REQUIREMENTS,
  type DataSourceSummary,
  type PropertyMap,
  type SharedPageSummary,
} from "@/services/notion/task-database";
import {
  PLACE_FIELD_REQUIREMENTS,
  type PlaceOptionalField,
  type PlacePropertyMap,
} from "@/services/notion/place-database";
import {
  GARBAGE_FIELD_REQUIREMENTS,
  REMINDER_FIELD_REQUIREMENTS,
  type ReminderPropertyMap,
} from "@/services/notion/reminder-database";
import {
  SHOPPING_FIELD_REQUIREMENTS,
  type ShoppingPropertyMap,
} from "@/services/notion/shopping-database";
import { AttentionDot } from "@/components/settings/attention-dot";
import { notionActionCounts } from "@/lib/notion-action-needed";
import { WORK_FIELD_REQUIREMENTS, type WorkPropertyMap } from "@/services/notion/work-database";

type MissingProperty = { field: string; label: string; types: string[] };

/** 新規作成できるDB。作成の手順は同じで、APIの経路と既定名だけが違う。 */
type DatabaseKind = "task" | "place" | "work" | "shopping";

const DATABASE_LABELS: Record<DatabaseKind, string> = {
  task: "タスクDB",
  place: "場所DB",
  work: "勤務記録DB",
  shopping: "買い物リストDB",
};

const DATABASE_DEFAULT_TITLES: Record<DatabaseKind, string> = {
  task: "YoteiFlow タスク",
  place: "YoteiFlow 場所",
  work: "YoteiFlow 勤務記録",
  shopping: "YoteiFlow 買い物リスト",
};

/** Notionが返したメッセージがあればそれを見せる。原因が分からないまま止まらないようにする。 */
async function errorText(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ? `${fallback}（${body.message}）` : fallback;
  } catch {
    return fallback;
  }
}

export type NotionSectionState = {
  connected: boolean;
  workspaceName: string | null;
  taskDataSourceId: string | null;
  taskTitle: string | null;
  propertyMap: PropertyMap | null;
  reminderDataSourceId: string | null;
  reminderTitle: string | null;
  reminderPropertyMap: ReminderPropertyMap | null;
  placeDataSourceId: string | null;
  placeTitle: string | null;
  placePropertyMap: PlacePropertyMap | null;
  garbageDataSourceId: string | null;
  garbageTitle: string | null;
  garbagePropertyMap: ReminderPropertyMap | null;
  workDataSourceId: string | null;
  workTitle: string | null;
  workPropertyMap: WorkPropertyMap | null;
  shoppingDataSourceId: string | null;
  shoppingTitle: string | null;
  shoppingPropertyMap: ShoppingPropertyMap | null;
  dataSources: DataSourceSummary[];
  sharedPages: SharedPageSummary[];
  dataSourcesFailed: boolean;
};

export function NotionSection({ state }: { state: NotionSectionState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [missing, setMissing] = useState<MissingProperty[] | null>(null);
  const [busy, setBusy] = useState(false);
  // 新規作成はタスクDBと場所DBで同じ手順のため、どちらを作るかだけを持つ。
  const [creating, setCreating] = useState<DatabaseKind | null>(null);
  const [newDatabaseTitle, setNewDatabaseTitle] = useState("");
  const [parentPageId, setParentPageId] = useState("");

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        setMessage({ text: "トークンが正しくないか、権限がありません。", tone: "error" });
        return;
      }

      setToken("");
      setMessage({ text: "Notionに接続しました。タスクDBを選択してください。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await fetch("/api/notion/connect", { method: "DELETE" });
      setMissing(null);
      setMessage(null);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const selectDataSource = async (dataSourceId: string) => {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/task-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSourceId }),
      });

      if (response.status === 422) {
        const body = (await response.json()) as { missingRequired: MissingProperty[] };
        setMissing(body.missingRequired);
        setMessage({ text: "必要なプロパティが不足しています。", tone: "error" });
        return;
      }
      if (!response.ok) {
        setMessage({ text: "タスクDBを設定できませんでした。", tone: "error" });
        return;
      }

      setMessage({ text: "タスクDBを設定しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const selectReminderDataSource = async (dataSourceId: string) => {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/reminder-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSourceId }),
      });
      if (response.status === 422) {
        const body = (await response.json()) as { missingRequired: MissingProperty[] };
        setMissing(body.missingRequired);
        setMessage({ text: "日付リマインドDBに必要なプロパティが不足しています。", tone: "error" });
        return;
      }
      if (!response.ok) {
        setMessage({ text: "日付リマインドDBを設定できませんでした。", tone: "error" });
        return;
      }
      setMessage({ text: "日付リマインドDBを設定しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const selectPlaceDataSource = async (dataSourceId: string) => {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/place-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSourceId }),
      });
      if (response.status === 422) {
        const body = (await response.json()) as { missingRequired: MissingProperty[] };
        setMissing(body.missingRequired);
        setMessage({ text: "場所DBに必要なプロパティが不足しています。", tone: "error" });
        return;
      }
      if (!response.ok) {
        setMessage({ text: await errorText(response, "場所DBを設定できませんでした。"), tone: "error" });
        return;
      }
      setMessage({ text: "場所DBを設定しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  /**
   * 使用中の場所DBへ、あとから増えた任意のプロパティ（座標・最寄り駅）を足す。
   * それより前に作ったDBには置き場所が無く、Notion側で何という名前・どの型で足せばよいかは
   * 画面のどこにも出ていないため、ここから実行できるようにする。
   */
  const addPlaceProperty = async (field: PlaceOptionalField, label: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/place-database/property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field }),
      });
      if (!response.ok) {
        setMessage({
          text: await errorText(response, `「${label}」プロパティを追加できませんでした。`),
          tone: "error",
        });
        return;
      }
      setMessage({ text: `場所DBに「${label}」プロパティを追加しました。`, tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const selectGarbageDataSource = async (dataSourceId: string) => {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/garbage-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSourceId }),
      });
      if (response.status === 422) {
        const body = (await response.json()) as { missingRequired: MissingProperty[] };
        setMissing(body.missingRequired);
        setMessage({ text: "ゴミの日DBに必要なプロパティが不足しています。", tone: "error" });
        return;
      }
      if (!response.ok) {
        setMessage({ text: "ゴミの日DBを設定できませんでした。", tone: "error" });
        return;
      }
      setMessage({ text: "ゴミの日DBを設定しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const selectWorkDataSource = async (dataSourceId: string) => {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/work-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSourceId }),
      });
      if (response.status === 422) {
        const body = (await response.json()) as { missingRequired: MissingProperty[] };
        setMissing(body.missingRequired);
        setMessage({ text: "勤務記録DBに必要なプロパティが不足しています。", tone: "error" });
        return;
      }
      if (!response.ok) {
        setMessage({
          text: await errorText(response, "勤務記録DBを設定できませんでした。"),
          tone: "error",
        });
        return;
      }
      setMessage({ text: "勤務記録DBを設定しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const selectShoppingDataSource = async (dataSourceId: string) => {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/shopping-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSourceId }),
      });
      if (response.status === 422) {
        const body = (await response.json()) as { missingRequired: MissingProperty[] };
        setMissing(body.missingRequired);
        setMessage({ text: "買い物リストDBに必要なプロパティが不足しています。", tone: "error" });
        return;
      }
      if (!response.ok) {
        setMessage({
          text: await errorText(response, "買い物リストDBを設定できませんでした。"),
          tone: "error",
        });
        return;
      }
      setMessage({ text: "買い物リストDBを設定しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  /** 使用中のタスクDBへ、対応付けできていない任意プロパティ（対応状況など）を足す。 */
  const addTaskOptionalProperties = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/task-database", { method: "PATCH" });
      if (!response.ok) {
        setMessage({
          text: await errorText(response, "タスクDBのプロパティを追加できませんでした。"),
          tone: "error",
        });
        return;
      }
      setMessage({ text: "タスクDBに不足していたプロパティを追加しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  /**
   * 使用中の勤務記録DBへ、年休・出張・会社休業日・事前申請・事後登録・メモ・時間帯のプロパティを足す。
   * この4つは名前が当たったときだけ対応付けるため、既存のDBを選ぶと揃わないことがある。
   */
  const addWorkOptionalProperties = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/work-database", { method: "PATCH" });
      if (!response.ok) {
        setMessage({
          text: await errorText(response, "勤務記録DBのプロパティを追加できませんでした。"),
          tone: "error",
        });
        return;
      }
      setMessage({
        text: "勤務記録DBに出張・年休・会社休業日のプロパティを追加しました。",
        tone: "ok",
      });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  /**
   * 使用中の買い物リストDBへ「購入予定日」を足す（docs/spec.md §36）。
   * 購入予定日より前に作ったDB・shopping-listアプリが作ったDBには置き場所が無い。
   * 名前が当たったときだけ対応付けるため、Notion側で足す名前も画面に出ていない。
   */
  const addShoppingDateProperty = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/shopping-database/property", { method: "POST" });
      if (!response.ok) {
        setMessage({
          text: await errorText(response, "「購入予定日」プロパティを追加できませんでした。"),
          tone: "error",
        });
        return;
      }
      setMessage({ text: "買い物リストDBに「購入予定日」プロパティを追加しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  /** 既存DBへ欲しいものの所属を持たせる。自動では足さず、利用者がここで明示的に実行する。 */
  const addShoppingWishlistProperty = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/shopping-database/property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "wishlisted" }),
      });
      if (!response.ok) {
        setMessage({
          text: await errorText(response, "「欲しいもの」プロパティを追加できませんでした。"),
          tone: "error",
        });
        return;
      }
      setMessage({ text: "買い物リストDBに「欲しいもの」プロパティを追加しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const createDatabase = async (kind: DatabaseKind) => {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    const label = DATABASE_LABELS[kind];
    try {
      const response = await fetch(`/api/notion/${kind}-database/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPageId, title: newDatabaseTitle }),
      });

      if (!response.ok) {
        setMessage({ text: await errorText(response, `${label}を作成できませんでした。`), tone: "error" });
        return;
      }

      setCreating(null);
      setMessage({ text: `${label}を作成して設定しました。`, tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const startCreating = (kind: DatabaseKind) => {
    setCreating(kind);
    setNewDatabaseTitle(DATABASE_DEFAULT_TITLES[kind]);
  };

  const disabled = busy || pending;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {message && (
          <p
            className={
              message.tone === "ok"
                ? "type-body-medium text-on-surface-variant"
                : "type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container"
            }
          >
            {message.text}
          </p>
        )}

        {!state.connected ? (
          <div className="flex flex-col gap-3">
            <ConnectionStatusBadge tone="not_connected">未接続</ConnectionStatusBadge>
            <div className="flex flex-col gap-2">
              <Input
                id="notion-token"
                label="Integration Token"
                type="password"
                autoComplete="off"
                placeholder="ntn_..."
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Notionで作成したInternal Integrationのトークンです。対象のタスクDBに、そのIntegrationを接続しておいてください。
              </p>
            </div>
            <Button className="w-fit" disabled={!token.trim() || disabled} onClick={connect}>
              接続する
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="type-body-large truncate font-medium">
                  {state.workspaceName ?? "接続済み"}
                </span>
                <ConnectionStatusBadge tone="connected">接続済み</ConnectionStatusBadge>
              </div>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={disconnect}>
                接続を解除
              </Button>
            </div>

            {state.taskDataSourceId && (
              <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary">タスクDB</Badge>
                  {notionActionCounts.task(state) > 0 && <AttentionDot label="プロパティの追加が必要" />}
                  <span className="font-medium">{state.taskTitle}</span>
                </div>
                {state.propertyMap && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {TASK_FIELD_REQUIREMENTS.map((requirement) => (
                      <div key={requirement.field} className="contents">
                        <dt>{requirement.label}</dt>
                        <dd>{state.propertyMap?.[requirement.field] ?? "未対応"}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {state.propertyMap &&
                  TASK_FIELD_REQUIREMENTS.some(
                    (requirement) => !requirement.required && !state.propertyMap?.[requirement.field],
                  ) && (
                    <div className="flex flex-col items-start gap-2">
                      <p className="text-xs text-muted-foreground">
                        対応付けできていない項目があります。Notionでプロパティを足したときは、
                        しばらくすると自動で反映されます。DBに無い項目は、下のボタンで足せます
                        （同じ名前のプロパティが既にあるときは作りません）。
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={addTaskOptionalProperties}
                      >
                        <Plus className="size-4" />
                        不足しているプロパティを追加
                      </Button>
                    </div>
                  )}
              </div>
            )}

            {missing && missing.length > 0 && (
              <div className="flex flex-col gap-1 rounded-lg bg-error-container/70 p-3 text-on-error-container">
                <p className="type-body-medium font-medium">
                  次のプロパティをNotion側に追加してください
                </p>
                <ul className="type-body-small list-disc pl-5">
                  {missing.map((item) => (
                    <li key={item.field}>
                      {item.label}（{item.types.join(" または ")}）
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">タスクDBを選択</span>
              <p className="text-xs text-muted-foreground">
                Notion側にプロパティを足したときは、同じDBをもう一度選ぶと対応が更新されます。
              </p>

              {state.dataSourcesFailed && (
                <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
                  Notionからデータベース一覧を取得できませんでした。トークンを確認してください。
                </p>
              )}

              {!state.dataSourcesFailed && state.dataSources.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Integrationに共有されているデータベースがありません。Notion側でタスクDBに接続を許可してください。
                </p>
              )}

              <ul className="flex flex-wrap gap-2">
                {state.dataSources.map((dataSource) => (
                  <li key={dataSource.dataSourceId}>
                    <Button
                      variant={
                        state.taskDataSourceId === dataSource.dataSourceId ? "secondary" : "outline"
                      }
                      size="sm"
                      disabled={disabled}
                      onClick={() => selectDataSource(dataSource.dataSourceId)}
                    >
                      {dataSource.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">日付リマインドDBを選択</span>
              <p className="text-xs text-muted-foreground">
                記念日や更新日など、完了して消化するものではない日付を管理します。タイトルと日付が必要です。
              </p>
              {state.reminderDataSourceId && (
                <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary">日付リマインドDB</Badge>
                    <span className="font-medium">{state.reminderTitle}</span>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {REMINDER_FIELD_REQUIREMENTS.map((requirement) => (
                      <div key={requirement.field} className="contents">
                        <dt>{requirement.label}</dt>
                        <dd>{state.reminderPropertyMap?.[requirement.field] ?? "未対応"}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              <ul className="flex flex-wrap gap-2">
                {state.dataSources.map((dataSource) => (
                  <li key={dataSource.dataSourceId}>
                    <Button
                      variant={state.reminderDataSourceId === dataSource.dataSourceId ? "secondary" : "outline"}
                      size="sm"
                      disabled={disabled || state.taskDataSourceId === dataSource.dataSourceId}
                      onClick={() => selectReminderDataSource(dataSource.dataSourceId)}
                    >
                      {dataSource.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">場所DBを選択</span>
              <p className="text-xs text-muted-foreground">
                よく行く場所を管理します。予定・移動の「場所」欄に入力候補として出ます。
                名前が必要で、住所・タグ・座標・最寄り駅は任意です。座標は地図から登録したときの
                地点が、最寄り駅は電車の移動でYahoo!乗換案内を開く駅名が入ります。
              </p>
              {state.placeDataSourceId && (
                <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary">場所DB</Badge>
                    {notionActionCounts.place(state) > 0 && <AttentionDot label="プロパティの追加が必要" />}
                    <span className="font-medium">{state.placeTitle}</span>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {PLACE_FIELD_REQUIREMENTS.map((requirement) => (
                      <div key={requirement.field} className="contents">
                        <dt>{requirement.label}</dt>
                        <dd>{state.placePropertyMap?.[requirement.field] ?? "未対応"}</dd>
                      </div>
                    ))}
                  </dl>
                  {!state.placePropertyMap?.coordinates && (
                    <div className="flex flex-col items-start gap-2">
                      <p className="text-xs text-muted-foreground">
                        座標のプロパティがありません。足すと、地図から登録した場所を次に開くとき
                        その地点から始められます。無いままでも登録はできます。
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() => addPlaceProperty("coordinates", "座標")}
                      >
                        <Plus className="size-4" />
                        座標プロパティを追加
                      </Button>
                    </div>
                  )}
                  {!state.placePropertyMap?.station && (
                    <div className="flex flex-col items-start gap-2">
                      <p className="text-xs text-muted-foreground">
                        最寄り駅のプロパティがありません。足すと、電車の移動でYahoo!乗換案内を
                        その駅から探せます。無いままでも登録はできます（地点か住所で探します）。
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() => addPlaceProperty("station", "最寄り駅")}
                      >
                        <Plus className="size-4" />
                        最寄り駅プロパティを追加
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <ul className="flex flex-wrap gap-2">
                {state.dataSources.map((dataSource) => (
                  <li key={dataSource.dataSourceId}>
                    <Button
                      variant={state.placeDataSourceId === dataSource.dataSourceId ? "secondary" : "outline"}
                      size="sm"
                      disabled={
                        disabled ||
                        state.taskDataSourceId === dataSource.dataSourceId ||
                        state.reminderDataSourceId === dataSource.dataSourceId
                      }
                      onClick={() => selectPlaceDataSource(dataSource.dataSourceId)}
                    >
                      {dataSource.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">ゴミの日DBを選択</span>
              <p className="text-xs text-muted-foreground">
                myroomが書き出すゴミの収集日をカレンダーに表示します。YoteiFlowからは読むだけで、
                編集・削除はできません（myroomが毎日書き直すため）。タイトルと日付が必要です。
                日付に時刻が入っていれば、終日ではなくその時刻の位置に表示します。
              </p>
              {state.garbageDataSourceId && (
                <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary">ゴミの日DB</Badge>
                    <span className="font-medium">{state.garbageTitle}</span>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {GARBAGE_FIELD_REQUIREMENTS.map((requirement) => (
                      <div key={requirement.field} className="contents">
                        <dt>{requirement.label}</dt>
                        <dd>{state.garbagePropertyMap?.[requirement.field] ?? "未対応"}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              <ul className="flex flex-wrap gap-2">
                {state.dataSources.map((dataSource) => (
                  <li key={dataSource.dataSourceId}>
                    <Button
                      variant={state.garbageDataSourceId === dataSource.dataSourceId ? "secondary" : "outline"}
                      size="sm"
                      disabled={
                        disabled ||
                        state.taskDataSourceId === dataSource.dataSourceId ||
                        state.reminderDataSourceId === dataSource.dataSourceId ||
                        state.placeDataSourceId === dataSource.dataSourceId
                      }
                      onClick={() => selectGarbageDataSource(dataSource.dataSourceId)}
                    >
                      {dataSource.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">勤務記録DBを選択</span>
              <p className="text-xs text-muted-foreground">
                その日どこで働いたかと、出張・年休の申請の済み未済、会社の休業日を記録します。
                タイトル・日付・勤務場所が必要です。年休（セレクト）と出張・会社休業日・事前申請・
                事後登録（チェックボックス）、時間帯（テキスト）は名前が一致したときだけ対応付けます。
              </p>
              {state.workDataSourceId && (
                <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary">勤務記録DB</Badge>
                  {notionActionCounts.work(state) > 0 && <AttentionDot label="プロパティの追加が必要" />}
                    <span className="font-medium">{state.workTitle}</span>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {WORK_FIELD_REQUIREMENTS.map((requirement) => (
                      <div key={requirement.field} className="contents">
                        <dt>{requirement.label}</dt>
                        <dd>{state.workPropertyMap?.[requirement.field] ?? "未対応"}</dd>
                      </div>
                    ))}
                  </dl>
                  {!(
                    state.workPropertyMap?.businessTrip &&
                    state.workPropertyMap?.annualLeave &&
                    state.workPropertyMap?.companyHoliday &&
                    state.workPropertyMap?.preApplied &&
                    state.workPropertyMap?.postRegistered &&
                    state.workPropertyMap?.segments
                  ) && (
                    <div className="flex flex-col items-start gap-2">
                      <p className="text-xs text-muted-foreground">
                        出張・年休・会社休業日・時間帯のプロパティが揃っていません。足すと、出張の
                        事前申請・事後登録と年休の事前申請の済み・未済を勤務の画面で追え、
                        会社の休業日の登録や、1日を時間帯ごとに分けた記録（朝は在宅、昼から出張など）も
                        できるようになります。無いままでも勤務場所は登録できます。
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={addWorkOptionalProperties}
                      >
                        <Plus className="size-4" />
                        足りないプロパティを追加
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <ul className="flex flex-wrap gap-2">
                {state.dataSources.map((dataSource) => (
                  <li key={dataSource.dataSourceId}>
                    <Button
                      variant={state.workDataSourceId === dataSource.dataSourceId ? "secondary" : "outline"}
                      size="sm"
                      disabled={
                        disabled ||
                        state.taskDataSourceId === dataSource.dataSourceId ||
                        state.reminderDataSourceId === dataSource.dataSourceId ||
                        state.placeDataSourceId === dataSource.dataSourceId ||
                        state.garbageDataSourceId === dataSource.dataSourceId
                      }
                      onClick={() => selectWorkDataSource(dataSource.dataSourceId)}
                    >
                      {dataSource.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">買い物リストDBを選択</span>
              <p className="text-xs text-muted-foreground">
                買うものを記録します。項目（タイトル）だけが必須で、メモ・購入済みは型から、
                カテゴリ・優先度・購入予定日は名前が一致したときだけ対応付けます（カテゴリと優先度は
                どちらもセレクト、購入予定日は「登録日」のような別の日付と取り違えうるため、
                型だけでは割り当てません）。shopping-listアプリと同じDBを選べば、
                どちらから足したものも両方に出ます。
              </p>
              {state.shoppingDataSourceId && (
                <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary">買い物リストDB</Badge>
                  {notionActionCounts.shopping(state) > 0 && <AttentionDot label="プロパティの追加が必要" />}
                    <span className="font-medium">{state.shoppingTitle}</span>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {SHOPPING_FIELD_REQUIREMENTS.map((requirement) => (
                      <div key={requirement.field} className="contents">
                        <dt>{requirement.label}</dt>
                        <dd>{state.shoppingPropertyMap?.[requirement.field] ?? "未対応"}</dd>
                      </div>
                    ))}
                  </dl>

                  {!state.shoppingPropertyMap?.plannedDate && (
                    <div className="flex flex-col items-start gap-2">
                      <p className="text-xs text-muted-foreground">
                        購入予定日のプロパティがありません。足すと、いつ買うかを項目ごとに決められ、
                        その日の買い物がカレンダーにも1件でまとまって出ます。
                        無いままでも買い物リストは使えます。
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={addShoppingDateProperty}
                      >
                        <Plus className="size-4" />
                        購入予定日プロパティを追加
                      </Button>
                    </div>
                  )}
                  {!state.shoppingPropertyMap?.wishlisted && (
                    <div className="flex flex-col items-start gap-2">
                      <p className="text-xs text-muted-foreground">
                        欲しいもののプロパティがありません。足すと、今すぐ買わないものを買うものと
                        分けて保管し、買う時期になったときに同じ項目を買うものへ変更できます。
                        無いままでも通常の買い物リストは使えます。
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={addShoppingWishlistProperty}
                      >
                        <Plus className="size-4" />
                        欲しいものプロパティを追加
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <ul className="flex flex-wrap gap-2">
                {state.dataSources.map((dataSource) => (
                  <li key={dataSource.dataSourceId}>
                    <Button
                      variant={
                        state.shoppingDataSourceId === dataSource.dataSourceId
                          ? "secondary"
                          : "outline"
                      }
                      size="sm"
                      disabled={
                        disabled ||
                        state.taskDataSourceId === dataSource.dataSourceId ||
                        state.reminderDataSourceId === dataSource.dataSourceId ||
                        state.placeDataSourceId === dataSource.dataSourceId ||
                        state.garbageDataSourceId === dataSource.dataSourceId ||
                        state.workDataSourceId === dataSource.dataSourceId
                      }
                      onClick={() => selectShoppingDataSource(dataSource.dataSourceId)}
                    >
                      {dataSource.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              {!creating ? (
                <div className="flex flex-wrap gap-2">
                  {(["task", "place", "work", "shopping"] as const).map((kind) => (
                    <Button
                      key={kind}
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      disabled={disabled}
                      onClick={() => startCreating(kind)}
                    >
                      <Plus className="size-4" />
                      {DATABASE_LABELS[kind]}を新規作成
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">
                    必要なプロパティを揃えた{DATABASE_LABELS[creating]}をNotionに作成します。作成先のページは、
                    このConnectionに共有されているものから選べます。
                  </p>

                  <Input
                    id="new-database-title"
                    label="データベース名"
                    value={newDatabaseTitle}
                    onChange={(event) => setNewDatabaseTitle(event.target.value)}
                  />

                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">作成先のページ</span>
                    {state.sharedPages.length === 0 ? (
                      <p className="text-xs text-destructive">
                        共有されているページがありません。Notionで任意のページを開き、
                        ••• →「接続」からこのConnectionを追加してください。
                      </p>
                    ) : (
                      <ul className="flex flex-wrap gap-2">
                        {state.sharedPages.map((page) => (
                          <li key={page.pageId}>
                            <Button
                              variant={parentPageId === page.pageId ? "secondary" : "outline"}
                              size="sm"
                              disabled={disabled}
                              onClick={() => setParentPageId(page.pageId)}
                            >
                              {page.title}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={disabled || !parentPageId || !newDatabaseTitle.trim()}
                      onClick={() => createDatabase(creating)}
                    >
                      作成する
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => setCreating(null)}
                    >
                      やめる
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
