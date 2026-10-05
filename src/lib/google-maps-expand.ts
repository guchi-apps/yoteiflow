import { isGoogleMapsHost } from "@/lib/google-maps-route";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;

/** 許可したGoogleマップのhttpsでなければ null */
export function validGoogleMapsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isGoogleMapsHost(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Googleマップの共有URLを、`parse` が読める形になるまで展開する。HTML本文は読まず、
 * 許可したGoogleホストへのリダイレクトだけを追う（短縮URLは最終URLにしか情報が無い）。
 * 読めなければ null。通信失敗は投げる。
 */
export async function expandGoogleMapsUrl<T>(
  value: string,
  parse: (url: string) => T | null,
): Promise<{ result: T; url: string } | null> {
  let current = validGoogleMapsUrl(value);
  for (let count = 0; current && count <= MAX_REDIRECTS; count += 1) {
    const result = parse(current.toString());
    if (result) return { result, url: current.toString() };

    const response = await fetch(current, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) break;
    current = validGoogleMapsUrl(new URL(location, current).toString());
  }
  return null;
}
