/**
 * `/login?error=` で受ける失敗の種類と、ログイン画面に出す案内（issue #1113）。
 *
 * ここに載っている値が付いた `/login` は、ログイン済みのセッションが残っていても起動画面へ戻さない
 * （`updateSession()`）。戻すと、DaySpanのUserに結び付いていないセッションで保護ページ→
 * `/login`→保護ページ…と往復し、案内が一度も表示されないまま止まる。
 * iOSアプリから渡る値は `NATIVE_LOGIN_ERRORS`（native-app.ts）と同じ。
 */
export const LOGIN_ERROR_MESSAGES = {
  not_allowed: "このGoogleアカウントは利用を許可されていません。",
  auth_failed: "ログインに失敗しました。時間をおいて再度お試しください。",
  callback_failed:
    "ログインの完了処理に失敗しました。もう一度Googleでログインしてください。繰り返す場合は、時間をおいてからお試しください。",
  account_conflict:
    "このGoogleアカウントを以前の利用データと自動で結び付けられませんでした。データは変更していません。以前使っていたGoogleアカウントでログインするか、管理者に連絡してください。",
  session_unlinked:
    "ログイン情報を利用データと結び付けられていません。もう一度Googleでログインしてください。",
} as const;

export type LoginError = keyof typeof LOGIN_ERROR_MESSAGES;

export function isLoginError(value: string | null | undefined): value is LoginError {
  return typeof value === "string" && Object.hasOwn(LOGIN_ERROR_MESSAGES, value);
}

/** ログイン済みのセッションはあるのに、DaySpanのUserが引けなかったときの戻り先。 */
export const SESSION_UNLINKED_LOGIN_PATH = "/login?error=session_unlinked";
