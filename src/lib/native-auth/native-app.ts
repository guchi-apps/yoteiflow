/**
 * iOSアプリ（issue #908）とサーバーで揃える定数。値を変えるときは `ios/YoteiFlow/AppConfig.swift`
 * も直す（`ios/scripts/check-consistency.mjs` が照合する）。
 */

/** 認証シートの戻り先スキーム。 */
export const NATIVE_SCHEME = "yoteiflow";

export const NATIVE_LOGIN_CALLBACK = `${NATIVE_SCHEME}://auth-callback`;
export const NATIVE_GOOGLE_CALLBACK = `${NATIVE_SCHEME}://google-connected`;

/**
 * Googleログインで認証シートから戻すときの失敗の種類（アプリはこの値をそのまま `/login?error=` へ渡す）。
 * 値を足すときは `ios/YoteiFlow/WebViewModel.swift` の `loginErrors` も直す（check-consistency.mjs が照合する）。
 */
export const NATIVE_LOGIN_ERRORS = ["auth_failed", "not_allowed", "callback_failed", "account_conflict"] as const;
export type NativeLoginError = (typeof NATIVE_LOGIN_ERRORS)[number];

export function nativeLoginErrorUrl(error: NativeLoginError): string {
  return `${NATIVE_LOGIN_CALLBACK}?error=${error}`;
}

export function nativeLoginCodeUrl(code: string): string {
  return `${NATIVE_LOGIN_CALLBACK}?code=${encodeURIComponent(code)}`;
}

/** Calendar連携の結果。定型値だけを返す（既存の `/settings/google?google=` と同じ値）。 */
export function nativeGoogleResultUrl(result: string): string {
  return `${NATIVE_GOOGLE_CALLBACK}?result=${encodeURIComponent(result)}`;
}

/**
 * 通知の設定画面がiOSアプリへ頼むためのブリッジ（WKScriptMessageHandler）の名前。
 * `ios/YoteiFlow/WebViewModel.swift` の `pushBridgeName` と揃える（check-consistency.mjs が照合する）。
 */
export const NATIVE_PUSH_BRIDGE = "yoteiflowPush";

/**
 * 睡眠をHealthKitへ書くブリッジ（issue #976）。`ios/YoteiFlow/WebViewModel.swift` の
 * `healthBridgeName` と揃える（check-consistency.mjs が照合する）。
 */
export const NATIVE_HEALTH_BRIDGE = "yoteiflowHealth";
