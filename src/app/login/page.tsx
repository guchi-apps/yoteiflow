import { cookies } from "next/headers";

import { Wordmark } from "@/components/brand/wordmark";
import { ClearOfflineCache } from "@/components/offline/clear-offline-cache";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveInternalPath, START_PATH_COOKIE } from "@/lib/home-path";
import { isLoginError, LOGIN_ERROR_MESSAGES } from "@/lib/login-errors";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;

  const cookieStore = await cookies();
  const next = resolveInternalPath(callbackUrl, cookieStore.get(START_PATH_COOKIE)?.value);

  return (
    <div className="flex h-app flex-col items-center justify-center gap-8 bg-surface-container-low p-4">
      <ClearOfflineCache />

      <Wordmark size={40} className="type-headline-small" />

      <Card className="w-full max-w-sm bg-surface-container-high">
        <CardHeader>
          <CardTitle>ログイン</CardTitle>
          <CardDescription>
            Google CalendarとNotionのタスクを1つのカレンダーで確認できます。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isLoginError(error) && (
            <p
              role="alert"
              className="type-body-small rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container"
            >
              {LOGIN_ERROR_MESSAGES[error]}
            </p>
          )}

          {/* スマートフォンでも押しやすい高さにする。既定のボタン高さ(32px)はタップ対象として小さい。 */}
          <Button asChild className="h-11 w-full text-base">
            {/* OAuthは外部サイトへリダイレクトするため、オフライン再送対象のNext.jsクライアント遷移を使わない。 */}
            <a href={`/auth/signin?next=${encodeURIComponent(next)}`}>
              Googleでログイン
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
