import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { validGoogleMapsUrl } from "@/lib/google-maps-expand";
import { resolveGoogleMapsShare } from "@/lib/share-import/google-maps";
import { getTimeZone } from "@/services/travel/plans";

type RouteBody = { url?: unknown; aiMinutes?: unknown };

const MAX_AI_MINUTES = 24 * 60;

/**
 * 移動の入力へ貼り付けたGoogleマップの経路URLを読む。HTML本文は読まず、許可したGoogleホストへのリダイレクトだけを追う。
 * ブラウザからはCORSで最終URLを読めないため、利用者が貼り付けた明示操作に限ってサーバーで行う。
 *
 * iOS共有拡張の preview と同じ `resolveGoogleMapsShare` を通し、URL形式の扱い（`saddr`/`daddr` など）・
 * AI未設定や失敗時の扱いを揃える（issue #1142）。AIで所要時間を補えなくても、読めた発着地・移動手段は返す。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as RouteBody;
  const value = typeof body.url === "string" ? body.url.trim() : "";
  if (!value || value.length > 2_048) {
    return NextResponse.json({ error: "invalid_request", message: "Googleマップの経路URLを入力してください。" }, { status: 400 });
  }

  if (!validGoogleMapsUrl(value)) {
    return NextResponse.json({ error: "invalid_request", message: "Googleマップの経路URLを貼り付けてください。" }, { status: 400 });
  }

  // 共有拡張の確認画面で出したAIの目安を引き継ぐ。Googleから取れないときAIへ聞き直さない（issue #1213）
  const aiMinutes =
    typeof body.aiMinutes === "number" && Number.isInteger(body.aiMinutes) && body.aiMinutes >= 1 && body.aiMinutes <= MAX_AI_MINUTES
      ? body.aiMinutes
      : null;
  const result = await resolveGoogleMapsShare(value, { knownAiMinutes: aiMinutes }, await getTimeZone(userId));
  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
  }
  const { item } = result;
  if (item.type !== "route" || !item.origin || !item.destination || !item.mode) {
    return NextResponse.json(
      { error: "unreadable_route", message: "場所のURLのため、経路として読み取れませんでした。経路を表示した状態で共有したURLを貼り付けてください。" },
      { status: 422 },
    );
  }

  // 共有拡張の preview と同じ共通モデルをそのまま返し、日時・所要時間・候補の解釈を共有と揃える（issue #1160）
  return NextResponse.json({ item });
}
