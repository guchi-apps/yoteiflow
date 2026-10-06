import { after } from "next/server";

import {
  resolveActivityStopUserId,
  shortcutError,
  shortcutFailure,
  shortcutJson,
} from "@/app/api/shortcuts/shared";
import { db } from "@/lib/db";
import { decideSleepFocusAction, isSleepFocusMode } from "@/lib/sleep-focus";
import {
  ActivityRecordChangedError,
  getRunningActivity,
  startActivity,
  stopRunningActivity,
} from "@/services/activity/running";
import { getSleepSettings } from "@/services/activity/settings";
import { notifyLiveActivity } from "@/services/live-activity/notify";

/**
 * 睡眠モード（iOSのフォーカス「睡眠」）の切り替えに合わせて、睡眠の記録を始める・止める（issue #1109）。
 *
 * iOSアプリのフォーカスフィルタ（`SetFocusFilterIntent`）が、アプリのKeychainにある停止専用トークンで呼ぶ。
 * アラームを止めると睡眠モードはiOSが解除するため、起床時の停止も同じ経路になる。
 *
 * **開けるのは睡眠の項目だけ**。項目名も時刻も受け取らない（項目は `getSleepSettings().title`、時刻は
 * サーバーの時計）。停止専用トークンの許可範囲を書き込み側へ広げる代わりに、漏れたときにできることを
 * 「睡眠の記録を始める・止める」へ絞る。
 */
export async function POST(request: Request) {
  const auth = await resolveActivityStopUserId(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
  const mode = body?.mode;
  if (!isSleepFocusMode(mode)) {
    return shortcutError(400, "invalid_mode", "mode は start か stop を指定してください。");
  }

  const userId = auth.userId;

  try {
    const [running, sleep, uiSetting] = await Promise.all([
      getRunningActivity(userId),
      getSleepSettings(userId),
      db.uiSetting.findUnique({ where: { userId }, select: { timeZone: true } }),
    ]);
    const now = new Date();
    const action = decideSleepFocusAction(
      mode,
      running,
      sleep.title,
      now,
      uiSetting?.timeZone ?? "Asia/Tokyo",
    );

    if (action === "not_changed") {
      return shortcutJson({ ok: true, status: "not_changed", message: `すでに${sleep.title}を記録中です。` });
    }
    if (action === "not_sleeping") {
      return shortcutJson({ ok: true, status: "not_sleeping", message: `${sleep.title}を記録していないため、何もしませんでした。` });
    }

    if (action === "start") {
      const result = await startActivity(userId, { title: sleep.title });
      after(() =>
        notifyLiveActivity(userId, {
          type: "started",
          running: result.running,
          switched: result.saved !== null,
        }),
      );
      return shortcutJson({ ok: true, status: "started", message: `${sleep.title}の記録を始めました。` });
    }

    // 判定から止めるまでの間に別の記録へ変わっていたら止めない（開始時刻と項目名を前提に添える）
    const stopped = await stopRunningActivity(userId, now, {
      expected: running ? { startedAt: new Date(running.startedAt), title: sleep.title } : undefined,
    });

    if (stopped.status === "not_running") {
      return shortcutJson({ ok: true, status: "not_sleeping", message: `${sleep.title}を記録していないため、何もしませんでした。` });
    }
    after(() => notifyLiveActivity(userId, { type: "stopped" }));
    return shortcutJson({ ok: true, status: "stopped", saved: stopped.range, message: `${sleep.title}の記録を止めました。` });
  } catch (error) {
    // 別の記録に変わっていた（他の端末で処理済み）。何も止めていないので成功として返す
    if (error instanceof ActivityRecordChangedError) {
      return shortcutJson({ ok: true, status: "not_sleeping", message: "別の記録に変わっていたため、何もしませんでした。" });
    }
    return shortcutFailure("睡眠の記録", error);
  }
}
