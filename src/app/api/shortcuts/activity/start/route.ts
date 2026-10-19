import { after } from "next/server";

import {
  resolveActivityStopUserId,
  shortcutError,
  shortcutFailure,
  shortcutJson,
} from "@/app/api/shortcuts/shared";
import { db } from "@/lib/db";
import { decideControlStart, parseStartPresetId } from "@/lib/shortcut-activity-start";
import { getRunningActivity, startActivity } from "@/services/activity/running";
import { notifyLiveActivity } from "@/services/live-activity/notify";

/**
 * iOSのコントロール（コントロールセンター・ロック画面・アクションボタン）から記録を始める（issue #1281）。
 *
 * アプリのKeychainにある停止専用トークンで呼ぶ。**始められるのは本人が登録済みの項目だけ**で、
 * 項目名は受け取らずIDからDBで引く。時刻はサーバーの時計。停止専用トークンの許可範囲を
 * 「睡眠の開始」（#1109）から「登録済み項目の開始」へ広げるが、任意の名前の記録は作らせない。
 * 別の項目を記録中なら切り替える（記録の画面と同じ）。同じ項目を記録中なら何もしない。
 */
export async function POST(request: Request) {
  const auth = await resolveActivityStopUserId(request);
  if (!auth.ok) return auth.response;

  const presetId = parseStartPresetId(await request.json().catch(() => null));
  if (!presetId) {
    return shortcutError(400, "invalid_preset", "presetId を指定してください。");
  }

  const userId = auth.userId;
  const preset = await db.activityPreset.findFirst({
    where: { id: presetId, userId },
    select: { name: true },
  });
  if (!preset) {
    return shortcutError(404, "preset_not_found", "その記録の項目が見つかりません。");
  }

  try {
    const running = await getRunningActivity(userId);
    if (decideControlStart(running?.title ?? null, preset.name) === "not_changed") {
      return shortcutJson({ ok: true, status: "not_changed", message: `すでに${preset.name}を記録中です。` });
    }

    const result = await startActivity(userId, { title: preset.name });
    after(() =>
      notifyLiveActivity(userId, {
        type: "started",
        running: result.running,
        switched: result.saved !== null,
      }),
    );
    return shortcutJson({ ok: true, status: "started", message: `${preset.name}の記録を始めました。` });
  } catch (error) {
    return shortcutFailure("活動記録の開始", error);
  }
}
