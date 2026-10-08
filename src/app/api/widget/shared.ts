import { NextResponse } from "next/server";

import { isUserIdAllowed } from "@/lib/access/user-access";
import { resolveUserIdByWidgetToken } from "@/services/activity/widget-token";

/**
 * ウィジェット用APIの認証（docs/spec.md §28）。
 *
 * 認証はウィジェット専用トークンのみで、Supabaseのセッションは見ない。ウィジェットの更新は
 * 利用者が操作していない時点でiOSが走らせるため、ブラウザのセッションを前提にできない。
 * `/api/widget/` は proxy.ts（middleware.ts）がSupabaseへ問い合わせずに素通しする。
 *
 * トークンはクエリではなく `Authorization` ヘッダーで受ける。クエリだとApacheのアクセスログに
 * そのまま残り、ログを見られるだけで他人の記録を読めるようになる。
 *
 * 面が増えても認証の形は1つに保つため、ここへ集約する（`api/work/shared.ts` と同じ立ち位置）。
 */
export async function resolveWidgetUserId(
  request: Request,
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) {
    return {
      ok: false,
      response: unauthorized("トークンがありません。設定のiPhoneウィジェットから台本を取り直してください。"),
    };
  }

  const userId = await resolveUserIdByWidgetToken(token);
  // 許可を取り消された利用者はトークンが生きていても通さない（issue #1179）
  if (!userId || !(await isUserIdAllowed(userId))) {
    return {
      ok: false,
      response: unauthorized("トークンが無効です。設定のiPhoneウィジェットから台本を取り直してください。"),
    };
  }

  return { ok: true, userId };
}

/**
 * ウィジェットへの応答。
 *
 * ウィジェットは毎回その時点の値を見るためのもの。途中の経路に残されると、止めたはずの記録や
 * 買い終えた買い物がいつまでも出続ける。
 */
export function widgetJson(body: unknown): NextResponse {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

function readBearerToken(header: string | null): string | null {
  if (!header) return null;

  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

function unauthorized(message: string): NextResponse {
  return NextResponse.json(
    { error: "unauthorized", message },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
