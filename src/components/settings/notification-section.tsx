"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { usePushSubscription } from "@/components/notifications/use-push-subscription";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { eventLeadLabel } from "@/lib/event-notification";
import { cn } from "@/lib/utils";
import { EVENT_LEAD_MINUTES, type NotificationSettings } from "@/types/notification";

/**
 * 通知の設定（docs/spec.md §32）。
 *
 * 上段は「この端末で受け取るか」（ブラウザが端末ごとに持つ許可）、下段は「何を知らせるか」
 * （アカウントにつき1つ）。分けているのは、許可が端末ごとにしか決められない一方で、
 * 何分前に知らせるかを端末ごとに変える理由が無いため。
 */
export function NotificationSection({
  settings,
  publicKey,
  deviceCount,
  apnsConfigured,
  timeZone,
}: {
  settings: NotificationSettings;
  /** VAPIDの公開鍵。未設定のサーバーでは null（この端末を登録できない）。 */
  publicKey: string | null;
  /** 登録済みの端末の数。この端末を含む。 */
  deviceCount: number;
  /** APNsの認証キーが設定されているか。iOSアプリの端末が登録できるかを決める。 */
  apnsConfigured: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const { state, subscribe, unsubscribe } = usePushSubscription(publicKey);

  const [value, setValue] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const send = async (patch: Partial<NotificationSettings>) => {
    // 応答を待ってから動かすと、押したのに変わらない時間ができる。先に反映し、失敗したら戻す。
    const previous = value;
    setValue({ ...value, ...patch });
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/notifications/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        setValue(previous);
        setError(body?.message ?? "設定を保存できませんでした。");
      }
    } catch {
      setValue(previous);
      setError("設定を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setTestResult(null);
    setError(null);

    try {
      const response = await fetch("/api/notifications/test", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;

      setTestResult(
        response.ok
          ? "送信しました。数秒たっても出ない場合は、端末の通知設定を確認してください。"
          : (body?.message ?? "テスト通知を送れませんでした。"),
      );
    } catch {
      setTestResult("テスト通知を送れませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {publicKey === null && !state.native && (
        <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
          サーバーで通知の鍵（VAPID）が設定されていません。設定するまで、どの端末でも通知は届きません。
        </p>
      )}

      {state.native && !apnsConfigured && (
        <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
          サーバーでAPNsの認証キーが設定されていません。設定するまで、アプリには通知が届きません。
        </p>
      )}

      {/* iPhoneは、ホーム画面に追加したDaySpanから開いたときにしか通知を許可できない。
          スイッチを押しても何も起きない状態になるため、理由を先に出す。 */}
      {state.ready && state.needsInstall && (
        <p className="type-body-medium rounded-lg bg-primary-container/70 px-3 py-2 text-on-primary-container">
          この端末では、Safariで開いた画面から通知を許可できません。共有ボタンから「ホーム画面に追加」でYoteiFlowを追加し、そのアイコンから開いてください。
        </p>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="push-enabled">この端末で受け取る</Label>
              <p className="type-body-small text-on-surface-variant">
                {!state.ready
                  ? "確認しています…"
                  : !state.supported
                    ? "この端末では通知を扱えません。"
                    : state.subscribed
                      ? deviceCount > 1
                        ? `登録済み（ほかに${deviceCount - 1}台）`
                        : "登録済み"
                      : "許可すると、この端末に通知が届きます。"}
              </p>
            </div>

            <Switch
              id="push-enabled"
              checked={state.subscribed}
              disabled={!state.ready || !state.supported || state.busy || (publicKey === null && !state.native)}
              onCheckedChange={(checked) => {
                // 登録した端末の数は、この画面をサーバーで描いた時点の値。取り直さないと
                // 「登録済み（ほかに1台）」の数が押した直後だけ合わなくなる。
                void (checked ? subscribe() : unsubscribe()).then(() => router.refresh());
              }}
            />
          </div>

          {state.error && (
            <p className="type-body-small rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
              {state.error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-6">
          {error && (
            <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="event-enabled">予定</Label>
                <p className="type-body-small text-on-surface-variant">
                  予定の通知を使うかどうかの親スイッチです。通知するのは、予定の画面で通知を入れた予定だけです。下の時間は、通知を入れるときの初期値になります。
                </p>
              </div>

              <Switch
                id="event-enabled"
                checked={value.eventEnabled}
                disabled={busy}
                onCheckedChange={(checked) => void send({ eventEnabled: checked })}
              />
            </div>

            {/* 切ったときも選択肢は残す（薄くするだけ）。次に入れたときに選び直させないため。 */}
            <div
              className={cn(
                "flex flex-wrap gap-2 transition-opacity",
                !value.eventEnabled && "pointer-events-none opacity-38",
              )}
            >
              {EVENT_LEAD_MINUTES.map((minutes) => (
                <Button
                  key={minutes}
                  type="button"
                  size="sm"
                  variant={minutes === value.eventLeadMinutes ? "secondary" : "outline"}
                  disabled={busy || !value.eventEnabled}
                  onClick={() => void send({ eventLeadMinutes: minutes })}
                >
                  {eventLeadLabel(minutes)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="task-enabled">タスク</Label>
                <p className="type-body-small text-on-surface-variant">
                  時刻のある期限は、その時刻に知らせます。
                </p>
              </div>

              <Switch
                id="task-enabled"
                checked={value.taskEnabled}
                disabled={busy}
                onCheckedChange={(checked) => void send({ taskEnabled: checked })}
              />
            </div>

            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-3 transition-opacity",
                !value.taskEnabled && "pointer-events-none opacity-38",
              )}
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor="task-digest-time">時刻の無い期限</Label>
                <p className="type-body-small text-on-surface-variant">
                  その日ぶんをまとめて1通にします（{timeZone}）。
                </p>
              </div>

              <Input
                id="task-digest-time"
                type="time"
                className="h-10 w-32"
                defaultValue={value.taskDigestTime}
                disabled={busy || !value.taskEnabled}
                onBlur={(event) => {
                  const next = event.target.value;
                  if (next && next !== value.taskDigestTime) void send({ taskDigestTime: next });
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="work-apply-mail-enabled">事前申請の未完了をメールで知らせる</Label>
              <p className="type-body-small text-on-surface-variant">
                出張・年休の事前申請が済んでいないとき、開始日の前日（土日祝・休みを挟むときはその手前の出勤日）の16時台に会社宛てへメールを1通送ります（{timeZone}）。
              </p>
            </div>

            <Switch
              id="work-apply-mail-enabled"
              checked={value.workApplyMailEnabled}
              disabled={busy}
              onCheckedChange={(checked) => void send({ workApplyMailEnabled: checked })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Label>テスト通知</Label>
              <p className="type-body-small text-on-surface-variant">
                登録済みの端末すべてに1通送ります。アイコンのバッジも一緒に更新します。
              </p>
            </div>

            <Button type="button" variant="outline" disabled={busy} onClick={() => void sendTest()}>
              送る
            </Button>
          </div>

          {testResult && (
            <p className="type-body-small text-on-surface-variant">{testResult}</p>
          )}
        </CardContent>
      </Card>

      <p className="type-body-small text-on-surface-variant">
        アプリアイコンのバッジには、期限が今日以前の未完了タスクの件数が出ます（タスク画面の「期限切れ」と「今日」の合計）。件数はアプリを開いたときと、通知が届いたときに更新されます。
      </p>

      <p className="type-body-small text-on-surface-variant">
        予定の詳細画面からは、予定ごとに個別の通知設定もできます。
      </p>
    </div>
  );
}
