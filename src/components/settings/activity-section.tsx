"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACTIVITY_ICON_KEYS,
  ACTIVITY_ICONS,
  resolveActivityIcon,
} from "@/lib/activity-icons";
import { cn } from "@/lib/utils";
import type { ActivityPresetItem } from "@/types/activity";
import type { WritableCalendar } from "@/types/calendar";

/** 保存先を選ぶ欄で「指定しない」を表す値。Radixのセレクトは空文字を値にできない。 */
const DEFAULT_CALENDAR_VALUE = "__default__";

/**
 * 活動記録の項目と保存先（docs/spec.md §27）。
 *
 * 記録は押した順ではなく、ここに並んだ順で記録画面に出る。よく使うものを
 * 上へ持ってこられるよう、名前とあわせて並び順もここで変えられるようにする。
 *
 * 保存先カレンダーは項目ごとではなく全ての項目で1つ。項目ごとに選べる形だと、
 * 項目の数だけ同じ欄が並ぶわりにほとんどが既定のままで、保存先を変えるときは
 * 全ての項目を1つずつ直すことになる。
 */
export function ActivitySection({
  presets,
  calendars,
  activityCalendarId,
}: {
  presets: ActivityPresetItem[];
  calendars: WritableCalendar[];
  activityCalendarId: string | null;
}) {
  const router = useRouter();

  const [items, setItems] = useState(presets);
  const [calendarId, setCalendarId] = useState(activityCalendarId);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iconTarget, setIconTarget] = useState<ActivityPresetItem | null>(null);

  const defaultCalendarName =
    calendars.find((calendar) => calendar.isCreateDefault)?.name ?? calendars[0]?.name;

  /** 変更を送り、成功したら一覧を差し替える。カレンダー画面の選択肢も古くなるため取り直させる。 */
  const send = async (
    path: string,
    init: RequestInit,
    fallback: string,
    apply: (body: Record<string, unknown>) => void,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, init);
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        setError((body?.message as string) ?? fallback);
        return false;
      }

      apply(body ?? {});
      router.refresh();
      return true;
    } catch {
      setError(fallback);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const added = await send(
      "/api/activities/presets",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      },
      "項目を追加できませんでした。",
      (body) => setItems((prev) => [...prev, body.preset as ActivityPresetItem]),
    );

    if (added) setName("");
  };

  const rename = async (preset: ActivityPresetItem, next: string) => {
    const trimmed = next.trim();
    if (!trimmed || trimmed === preset.name) return;

    await send(
      `/api/activities/presets/${encodeURIComponent(preset.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      },
      "名前を変更できませんでした。",
      (body) => replace(body.preset as ActivityPresetItem),
    );
  };

  /** アイコンを選ぶ（null で解除）。解除しても初期項目は名前の既定に戻る。 */
  const changeIcon = async (preset: ActivityPresetItem, icon: string | null) => {
    setIconTarget(null);
    await send(
      `/api/activities/presets/${encodeURIComponent(preset.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icon }),
      },
      "アイコンを変更できませんでした。",
      (body) => replace(body.preset as ActivityPresetItem),
    );
  };

  const changeCalendar = async (value: string) => {
    const next = value === DEFAULT_CALENDAR_VALUE ? null : value;

    // 応答を待ってから欄を動かすと、選んだのに変わらない時間ができる。先に反映し、失敗したら戻す。
    const previous = calendarId;
    setCalendarId(next);

    const ok = await send(
      "/api/activities/settings",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: next }),
      },
      "保存先を変更できませんでした。",
      () => {},
    );

    if (!ok) setCalendarId(previous);
  };

  const remove = async (preset: ActivityPresetItem) => {
    // 消えるのは押すための項目だけで、保存済みの予定はカレンダーに残る。
    // それでも押し間違いで並びが変わるため、消す前に何が消えるかを示す。
    const confirmed = window.confirm(
      `「${preset.name}」を削除します。\nすでにカレンダーへ保存された予定はそのまま残ります。よろしいですか？`,
    );
    if (!confirmed) return;

    await send(
      `/api/activities/presets/${encodeURIComponent(preset.id)}`,
      { method: "DELETE" },
      "項目を削除できませんでした。",
      () => setItems((prev) => prev.filter((item) => item.id !== preset.id)),
    );
  };

  /**
   * 並びを1つ入れ替える。上下ボタンにしているのは、指でつまんで動かす操作だと
   * ページのスクロールと取り違えやすいため。
   */
  const move = async (index: number, delta: number) => {
    const next = [...items];
    const target = next[index + delta];
    if (!target) return;

    next[index + delta] = next[index];
    next[index] = target;

    // 応答を待ってから動かすと、押したのに動かない時間ができる。先に反映し、失敗したら戻す。
    const previous = items;
    setItems(next);

    const ok = await send(
      "/api/activities/presets",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next.map((item) => item.id) }),
      },
      "並び順を保存できませんでした。",
      () => {},
    );

    if (!ok) setItems(previous);
  };

  const replace = (preset: ActivityPresetItem) =>
    setItems((prev) => prev.map((item) => (item.id === preset.id ? preset : item)));

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
            {error}
          </p>
        )}

        {/* 保存先は項目より先に置く。どのカレンダーへ入るかは項目を足す前に決まっている必要がある。 */}
        <div className="flex flex-col gap-2">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <Label htmlFor="activity-calendar">記録の保存先</Label>
            <Select
              value={calendarId ?? DEFAULT_CALENDAR_VALUE}
              disabled={busy}
              onValueChange={changeCalendar}
            >
              <SelectTrigger id="activity-calendar" variant="flat" className="max-w-[60%] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_CALENDAR_VALUE}>
                  既定の保存先{defaultCalendarName ? `（${defaultCalendarName}）` : ""}
                </SelectItem>
                {calendars.map((calendar) => (
                  <SelectItem key={calendar.calendarId} value={calendar.calendarId}>
                    {calendar.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="type-body-small text-on-surface-variant">
            すべての項目がこのカレンダーへ保存されます。
          </p>
        </div>

        <ul className="flex flex-col divide-y divide-rule border-t border-rule pt-1">
          {items.map((preset, index) => (
            <li key={preset.id} className="flex min-w-0 items-center gap-2 py-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={`${preset.name} のアイコンを選ぶ`}
                disabled={busy}
                onClick={() => setIconTarget(preset)}
              >
                <PresetIconView preset={preset} />
              </Button>

              {/* 名前は打ち終えて欄から離れた時点で保存する。1文字ごとに送ると、
                  打っている途中の名前が保存されてしまう。 */}
              <Input
                variant="flat"
                aria-label={`${preset.name} の名前`}
                className="h-10 min-w-0 flex-1"
                defaultValue={preset.name}
                disabled={busy}
                onBlur={(event) => rename(preset, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />

              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${preset.name} を上へ`}
                disabled={busy || index === 0}
                onClick={() => move(index, -1)}
              >
                <ChevronUp className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${preset.name} を下へ`}
                disabled={busy || index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                <ChevronDown className="size-4" />
              </Button>
              <Button
                variant="destructive"
                size="icon-sm"
                aria-label={`${preset.name} を削除`}
                disabled={busy}
                onClick={() => remove(preset)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}

          {items.length === 0 && (
            <li className="type-body-medium py-2 text-on-surface-variant">
              項目がありません。よく記録するものを追加してください。
            </li>
          )}
        </ul>

        <div className="flex flex-col gap-2 border-t border-rule pt-4">
          <Label htmlFor="activity-preset-name">新しく追加</Label>

          <div className="flex min-w-0 items-center gap-2">
            <Input
              variant="flat"
              id="activity-preset-name"
              className="h-10 min-w-0 flex-1"
              placeholder="睡眠・移動・仕事など"
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <Button size="sm" disabled={busy || !name.trim()} onClick={add}>
              <Plus className="size-4" />
              追加
            </Button>
          </div>
        </div>
      </CardContent>

      <Dialog open={iconTarget !== null} onOpenChange={(open) => !open && setIconTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{iconTarget?.name} のアイコン</DialogTitle>
            <DialogDescription>
              カレンダーの記録と、記録画面のボタンに出ます。
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
            {ACTIVITY_ICON_KEYS.map((key) => {
              const Icon = ACTIVITY_ICONS[key];
              const selected = iconTarget
                ? resolveActivityIcon(iconTarget.name, iconTarget.icon) === key
                : false;

              return (
                <Button
                  key={key}
                  variant={selected ? "secondary" : "outline"}
                  size="icon"
                  aria-label={key}
                  aria-pressed={selected}
                  className={cn("size-11", selected && "ring-2 ring-primary")}
                  onClick={() => iconTarget && changeIcon(iconTarget, key)}
                >
                  <Icon className="size-5" />
                </Button>
              );
            })}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => iconTarget && changeIcon(iconTarget, null)}
          >
            アイコンを外す（初期項目は既定に戻る）
          </Button>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** 行のボタンに出す現在のアイコン。無ければ円（カレンダーの ActivityMark と同じ）。 */
function PresetIconView({ preset }: { preset: ActivityPresetItem }) {
  const key = resolveActivityIcon(preset.name, preset.icon);
  if (!key) {
    return <span aria-hidden className="size-2 rounded-full border-[1.5px] border-current" />;
  }

  const Icon = ACTIVITY_ICONS[key];
  return <Icon aria-hidden className="size-4" />;
}
