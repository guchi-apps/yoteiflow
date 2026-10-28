import { extractGoogleMapsUrl, resolveGoogleMapsShare, type GoogleMapsShareDeps } from "@/lib/share-import/google-maps";
import type { ShareImportResult } from "@/lib/share-import/types";
import type { YahooTravelWalk } from "@/lib/yahoo-transit-import";
import { resolveYahooShare } from "@/lib/share-import/yahoo";

export type ShareImportInput = {
  /** 共有されたテキスト（Yahoo!乗換案内の経路本文、Googleマップの「名前 URL」） */
  text?: string;
  /** 共有されたURL（URL型で渡されるGoogleマップ） */
  url?: string;
};

/**
 * 共有内容の出どころを判別して共通モデルへ変換する。URLがGoogleマップならそちら、
 * それ以外のテキストはYahoo!乗換案内として読む。
 */
export async function resolveSharedImport(
  input: ShareImportInput,
  timeZone: string,
  deps?: GoogleMapsShareDeps,
  /** Yahoo!の経路の電車の前後に足す徒歩（設定 ▸ 移動・issue #1463） */
  walk?: YahooTravelWalk,
): Promise<ShareImportResult> {
  const googleUrl = extractGoogleMapsUrl(input.url ?? "") ?? extractGoogleMapsUrl(input.text ?? "");
  if (googleUrl) return resolveGoogleMapsShare(googleUrl, deps, timeZone);

  const text = input.text ?? "";
  if (!text.trim()) {
    return { ok: false, status: 422, error: "unreadable", message: "共有された内容を読み取れませんでした。" };
  }
  return resolveYahooShare(text, timeZone, walk);
}

export { extractGoogleMapsUrl };
export type { SharedImport, ShareImportResult } from "@/lib/share-import/types";
