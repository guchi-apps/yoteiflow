/**
 * iOSアプリ（WKWebView）でYahoo!乗換案内アプリを開くブリッジ（issue #1330・docs/spec.md §29）。
 *
 * 素の `<a href="ytransit://…">` だと、WKWebViewはアプリ未導入のとき何も起きず、Web版へ逃がせない。
 * アプリへ頼めば、開けなかったときに同じ条件のWeb検索をSafariで開ける。あわせて下書きのIDと表示名を
 * App Groupへ置かせ、共有拡張が「『梅田→本社』に反映」を出せるようにする。
 */

import { NATIVE_TRANSIT_BRIDGE } from "@/lib/native-auth/native-app";

type Bridge = { postMessage: (message: unknown) => Promise<unknown> };

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const handlers = (window as unknown as { webkit?: { messageHandlers?: Record<string, Bridge> } })
    .webkit?.messageHandlers;
  return handlers?.[NATIVE_TRANSIT_BRIDGE] ?? null;
}

/** アプリがこのブリッジを持っているか。古いビルド・Safari・PCでは false。 */
export function hasNativeTransit(): boolean {
  return bridge() !== null;
}

/** どこで開けたか。`failed` はアプリもWeb版も開けなかった。 */
export type NativeTransitOpened = "app" | "web" | "failed";

export function parseNativeTransitOpened(value: unknown): NativeTransitOpened {
  const opened = (value as { opened?: unknown } | null)?.opened;
  return opened === "app" || opened === "web" ? opened : "failed";
}

export async function openTransitInNativeApp(input: {
  appUrl: string;
  webUrl: string;
  session: { id: string; label: string; expiresAt: number } | null;
}): Promise<NativeTransitOpened> {
  const target = bridge();
  if (!target) return "failed";
  try {
    return parseNativeTransitOpened(await target.postMessage({ action: "open", ...input }));
  } catch {
    return "failed";
  }
}

/** 共有拡張に置いた下書きの印を消す（入力画面で保存したとき）。ブリッジが無ければ何もしない。 */
export function clearTransitInNativeApp(): void {
  void bridge()?.postMessage({ action: "clear" }).catch(() => undefined);
}
