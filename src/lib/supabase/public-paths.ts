/**
 * 未ログインでも通す画面・経路。`middleware.ts` から切り出しているのは、依存を持たない形にして
 * `node --test` で確かめられるようにするため（`@supabase/ssr` などを実行時に読み込まない）。
 *
 * `/auth/native` はiOSアプリの認証引き継ぎ（issue #908）。`start` は認証シート（Cookieなし）、
 * `consume` はまだログインしていないWKWebViewから呼ばれるため、公開でなければ `/login` へ
 * 飛ばされてネイティブのログインが始まらない。
 */
export const PUBLIC_PATHS = ["/login", "/auth/signin", "/auth/callback", "/auth/native"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Supabaseのセッションではなく、それぞれ専用のトークン・APIキーで認証する（または認証が要らない）API。
 *
 * - `/api/widget/` … iPhoneウィジェット用（docs/spec.md §28）
 * - `/api/shortcuts/` … ライブアクティビティの停止ボタン用（docs/spec.md §43）
 * - `/api/internal/` … サーバー間参照用（docs/internal-api.md）
 * - `/api/app-version` … 稼働中の版の照合用（deploy.yml のヘルスチェックが未ログインで呼ぶ。issue #1257）
 * - `/.well-known/apple-app-site-association` … Universal Linkの関連付け（AppleのCDN・端末が未ログインで取りに来る。issue #1366）
 *
 * ここを通常の経路に通すと、呼ばれるたびにSupabase Authへ往復が1回増えるうえ、Supabaseへ
 * 到達できない間は（updateSession の authUnreachable の分岐で）トークンだけで判定できる要求まで503になる。
 * matcherから外さずここで分けるのは、外すと詐称されたユーザーIDヘッダーがそのまま後段へ届くため。
 */
export function isTokenAuthApiPath(pathname: string): boolean {
  return (
    pathname === "/api/app-version" ||
    pathname === "/.well-known/apple-app-site-association" ||
    pathname.startsWith("/api/widget/") ||
    pathname.startsWith("/api/shortcuts/") ||
    pathname.startsWith("/api/internal/")
  );
}
