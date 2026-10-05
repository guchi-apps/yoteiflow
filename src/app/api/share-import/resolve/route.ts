import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { resolveSharedImport } from "@/lib/share-import/resolve";
import { getTimeZone } from "@/services/travel/plans";

/**
 * 画面（予定の場所欄へのGoogleマップURLの貼り付けなど）から、共有内容を共通モデルへ読み取る（issue #1083）。
 * iOS共有拡張の preview と同じ `resolveSharedImport` を使う。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { text?: unknown; url?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "内容を読み取れませんでした。" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.slice(0, 50_000) : undefined;
  const url = typeof body.url === "string" ? body.url.slice(0, 2_048) : undefined;

  const result = await resolveSharedImport({ text, url }, await getTimeZone(userId));
  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
  }
  return NextResponse.json({ item: result.item });
}
