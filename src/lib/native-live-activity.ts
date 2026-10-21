/**
 * iOSアプリのライブアクティビティの表示を、設定画面からこの端末だけオン・オフするブリッジ（issue #1297）。
 *
 * 表示するかは端末ごとにアプリ（UserDefaults）が持つ。iPhoneとiPadで別々に選べ、DBには持たない。
 * アプリは `WKScriptMessageHandlerWithReply` で答える（通知の `native-push.ts` と同じ形）。
 */

import { NATIVE_LIVE_ACTIVITY_BRIDGE } from "@/lib/native-auth/native-app";

export type NativeLiveActivityStatus = {
  /** iPhoneの設定でライブアクティビティが許可されているか。 */
  supported: boolean;
  /** この端末で表示するか（アプリ内の設定）。 */
  enabled: boolean;
  /** 失敗の理由（アプリが返す定型の短い文）。 */
  error: string | null;
};

type Bridge = { postMessage: (message: unknown) => Promise<unknown> };

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const handlers = (window as unknown as { webkit?: { messageHandlers?: Record<string, Bridge> } })
    .webkit?.messageHandlers;
  return handlers?.[NATIVE_LIVE_ACTIVITY_BRIDGE] ?? null;
}

/** このブリッジを持つiOSアプリの中か。古いビルド・ブラウザ・PWAでは false（設定を出さない）。 */
export function hasNativeLiveActivityBridge(): boolean {
  return bridge() !== null;
}

/** アプリからの返事を、画面が扱える形へ寄せる。想定外の形は「許可されていない・表示する」として扱う。 */
export function parseNativeLiveActivityStatus(value: unknown): NativeLiveActivityStatus {
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    supported: record.supported === true,
    // 既定はオン。読めない返事でオフと見せると、押して直す必要の無いものを直させる
    enabled: record.enabled !== false,
    error: typeof record.error === "string" ? record.error : null,
  };
}

async function call(action: "status" | "enable" | "disable"): Promise<NativeLiveActivityStatus> {
  const target = bridge();
  if (!target) throw new Error("アプリの機能を呼べませんでした。アプリを最新にしてください。");
  return parseNativeLiveActivityStatus(await target.postMessage({ action }));
}

export const nativeLiveActivityStatus = () => call("status");
export const enableNativeLiveActivity = () => call("enable");
export const disableNativeLiveActivity = () => call("disable");
