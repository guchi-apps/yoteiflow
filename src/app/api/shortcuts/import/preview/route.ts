import { resolveActivityStopUserId, shortcutError, shortcutJson } from "@/app/api/shortcuts/shared";
import { resolveSharedImport } from "@/lib/share-import/resolve";
import { getTimeZone } from "@/services/travel/plans";

/**
 * 外部アプリ（Yahoo!乗換案内・Googleマップ）の共有内容を、登録せず確認画面向けに読み取る（issue #1083）。
 * 本文は `{ text?, url? }`。iOS共有拡張が使う。Googleマップの経路はここで1回だけAIで解析し、
 * 登録側（`/api/shortcuts/travel/import`）は返した結果を検証するだけで再解析しない。
 */
export async function POST(request: Request) {
  const auth = await resolveActivityStopUserId(request);
  if (!auth.ok) return auth.response;

  let body: { text?: unknown; url?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return shortcutError(400, "invalid_request", "共有された内容を読み取れませんでした。");
  }
  const text = typeof body.text === "string" ? body.text.slice(0, 50_000) : undefined;
  const url = typeof body.url === "string" ? body.url.slice(0, 2_048) : undefined;

  const timeZone = await getTimeZone(auth.userId);
  const result = await resolveSharedImport({ text, url }, timeZone);
  if (!result.ok) return shortcutError(result.status, result.error, result.message);

  return shortcutJson({ ok: true, item: result.item, timeZone, message: `${result.item.title} を読み取りました。` });
}
