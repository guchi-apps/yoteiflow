import { NextResponse } from "next/server";

import { isUserIdAllowed } from "@/lib/access/user-access";
import { externalApiMessage } from "@/lib/api-error";
import {
  ActivityCalendarNotFoundError,
  ActivityTimeRangeError,
} from "@/services/activity/running";
import { resolveUserIdByActivityStopToken } from "@/services/live-activity/devices";

/**
 * ライブアクティビティの停止ボタン用トークンで本人を特定する（issue #971）。
 * 許可するのは7経路だけ: `/api/shortcuts/activity/` の停止・activity tokenの登録・記録中の読み取り・睡眠モード連動の睡眠の開始と停止（`activity/sleep`・issue #1109。開けるのは睡眠の項目だけ）と、
 * 共有拡張が使う `/api/shortcuts/import/preview`（共通の取り込み。issue #1083）・`travel/preview`・`travel/import`
 * （issue #1026/#1054）。preview は共有内容を読むだけ（Googleマップ経路ではAIを1回呼ぶ）、import は任意の移動を作れる。新しいトークンを足さず、
 * マイグレーションを避けるためここへ相乗りさせた。
 */
export async function resolveActivityStopUserId(
  request: Request,
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const token = readBearerToken(request.headers.get("authorization"));
  const userId = token ? await resolveUserIdByActivityStopToken(token) : null;
  // 許可を取り消された利用者はトークンが生きていても通さない（issue #1179）
  if (!userId || !(await isUserIdAllowed(userId))) {
    return {
      ok: false,
      response: unauthorized("トークンが無効です。アプリでログインし直してください。"),
    };
  }
  return { ok: true, userId };
}

/**
 * ショートカットへの応答。
 *
 * **必ず日本語の `message` を添える。** ショートカットの「通知を表示」へそのまま流せると、
 * 効いているかどうかを実機で確かめられる。オートメーションは人が見ていない時点で走るため、
 * 打ち間違い・設定漏れに気付ける場所がほかに無い。
 *
 * `no-store` を付けるのは、途中の経路に残された応答が再生されると、記録していないのに
 * 「記録しました」が出るため。
 */
export function shortcutJson(body: { message: string } & Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * ショートカットの失敗の応答。HTTPのコードは分けたうえで、本文の形は成功時と揃える。
 *
 * 揃えておくと、ショートカット側は成否によらず `message` を1つ取り出して通知へ流せる。
 * 分けると、失敗したときだけ通知が空になる（＝いちばん知りたいときに何も出ない）。
 */
export function shortcutError(
  status: number,
  error: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    { ok: false, error, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function readBearerToken(header: string | null): string | null {
  if (!header) return null;

  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

function unauthorized(message: string): NextResponse {
  return shortcutError(401, "unauthorized", message);
}

/**
 * 3経路で共通の失敗の扱い。
 *
 * 断りの理由（未来の時刻・保存先が決まらない）と外部APIの失敗を分けたうえで、どれも
 * `message` に日本語の理由が入る形へ揃える。握りつぶさず、Googleが返した文面は
 * `externalApiMessage()` がサーバーログへ全文を残す（CLAUDE.md「外部APIの扱い」）。
 */
export function shortcutFailure(operation: string, error: unknown): NextResponse {
  if (error instanceof ActivityTimeRangeError) {
    return shortcutError(400, "invalid_time", error.message);
  }
  if (error instanceof ActivityCalendarNotFoundError) {
    return shortcutError(404, "calendar_not_found", error.message);
  }

  return shortcutError(502, "google_request_failed", externalApiMessage("google", operation, error));
}
