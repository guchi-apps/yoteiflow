import { after } from "next/server";

import {
  resolveActivityStopUserId,
  shortcutFailure,
  shortcutJson,
} from "@/app/api/shortcuts/shared";
import {
  ActivityRecordChangedError,
  getRunningActivity,
  stopRunningActivity,
  type ExpectedRunning,
} from "@/services/activity/running";
import { notifyLiveActivity } from "@/services/live-activity/notify";

/**
 * ライブアクティビティの停止ボタンから記録を止める（issue #971）。
 *
 * ロック画面のボタン（AppIntent）は、アプリのKeychainにある停止専用トークンで呼ぶ。
 * `/api/shortcuts/` は proxy が Supabase へ問い合わせずに素通しするため、トークンだけで通る。
 * 終了時刻はサーバーの時計で決める。
 *
 * 本文に `startedAtEpoch`（Unix秒）と `title` があれば、表示中の記録を前提条件（expected）にして、
 * 別の記録に変わっていたら止めない（APNsの更新は順序も到達も保証されず、ロック画面に古い記録が
 * 残りうる・issue #1181）。本文が空の古いアプリは従来どおり無条件で止める。
 */
function parseExpected(body: unknown): ExpectedRunning | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { startedAtEpoch, title } = body as { startedAtEpoch?: unknown; title?: unknown };
  if (typeof startedAtEpoch !== "number" || !Number.isFinite(startedAtEpoch)) return undefined;
  return {
    // ContentState は秒の小数で持つ（ミリ秒÷1000）。浮動小数の誤差を丸めてミリ秒に戻す
    startedAt: new Date(Math.round(startedAtEpoch * 1000)),
    title: typeof title === "string" ? title : undefined,
  };
}

export async function POST(request: Request) {
  const auth = await resolveActivityStopUserId(request);
  if (!auth.ok) return auth.response;

  const expected = parseExpected(await request.json().catch(() => null));

  try {
    const result = await stopRunningActivity(auth.userId, new Date(), { expected });

    after(() => notifyLiveActivity(auth.userId, { type: "stopped" }));

    if (result.status === "not_running") {
      return shortcutJson({ ok: true, status: "not_running", message: "記録していないため、何もしませんでした。" });
    }
    return shortcutJson({ ok: true, status: "saved", saved: result.range, message: "記録を止めました。" });
  } catch (error) {
    if (error instanceof ActivityRecordChangedError) {
      // 何も止めていない。ロック画面の表示を今の記録へ合わせる
      const running = await getRunningActivity(auth.userId).catch(() => null);
      after(() =>
        notifyLiveActivity(
          auth.userId,
          running ? { type: "updated", running } : { type: "stopped" },
        ),
      );
      return shortcutJson({ ok: true, status: "record_changed", message: "別の記録に変わっていたため、何もしませんでした。" });
    }
    return shortcutFailure("活動記録の保存", error);
  }
}
