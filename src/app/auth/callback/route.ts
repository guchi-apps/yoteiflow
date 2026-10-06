import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { isUserAllowed } from "@/lib/access/client";
import { CALENDAR_VIEW_COOKIE } from "@/lib/calendar-view-memory";
import { encryptSecret } from "@/lib/crypto/secret-cipher";
import { fetchVerifiedGoogleIdentity, GoogleIdentityError } from "@/lib/auth/google-identity";
import { linkUser } from "@/lib/auth/link-user";
import { userLinkStore } from "@/lib/auth/user-link-store";
import { resolveInternalPath, safeInternalPath, START_PATH_COOKIE } from "@/lib/home-path";
import { issueHandoff } from "@/lib/native-auth/handoff";
import {
  nativeLoginCodeUrl,
  nativeLoginErrorUrl,
  type NativeLoginError,
} from "@/lib/native-auth/native-app";
import { handoffStore } from "@/lib/native-auth/stores";
import { isValidChallenge } from "@/lib/native-auth/tokens";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";
import { signOutThisApp } from "@/lib/supabase/sign-out";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getRequestOrigin(request);
  const code = searchParams.get("code");
  const next = resolveInternalPath(
    searchParams.get("next"),
    request.cookies.get(START_PATH_COOKIE)?.value,
  );

  // iOSアプリの認証シート（issue #908）。戻り先はアプリのスキームで、アプリへ返すのは
  // 一度限りの引き継ぎコードだけ。遷移先（next・起動画面）とカレンダー記憶の破棄は、
  // WKWebViewのCookieが届く /auth/native/consume で行う（このシートはエフェメラルでCookieを持たない）。
  const challenge = searchParams.get("challenge");
  const native = searchParams.get("native") === "1" && isValidChallenge(challenge);

  if (!code) {
    return NextResponse.redirect(
      native ? nativeLoginErrorUrl("auth_failed") : `${origin}/login?error=auth_failed`,
    );
  }

  const supabase = await createClient();
  const fail = async (stage: string, error: NativeLoginError = "callback_failed", detail?: string) => {
    // トークン・認可コード・メールは出さない。どの段階で止まったかだけを残す（issue #1113）
    console.error(`[dayspan] ログインの完了処理に失敗: stage=${stage}${detail ? ` detail=${detail}` : ""}`);
    // セッションを残すと、/login の「ログイン済みなら戻す」と保護ページの往復になりうる。
    // 破棄するのはこのアプリのこの端末のセッションだけ（共有Supabaseユーザーは消さない）。
    try {
      await signOutThisApp(supabase);
    } catch {
      // ログアウト自体の失敗でも、白画面にせず再ログインの入口を返す
    }
    return NextResponse.redirect(native ? nativeLoginErrorUrl(error) : `${origin}/login?error=${error}`);
  };

  let stage = "code_exchange";
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error || !data.user) {
      return NextResponse.redirect(
        native ? nativeLoginErrorUrl("auth_failed") : `${origin}/login?error=auth_failed`,
      );
    }

    const { user } = data;

    // 初期リリースは許可されたユーザーのみ利用可能（docs/spec.md §3）。
    // 許可外のアカウントはDaySpan側のユーザーを作らず、Supabaseのセッションも破棄する。
    stage = "access_decision";
    if (!(await isUserAllowed(user))) {
      await signOutThisApp(supabase);
      return NextResponse.redirect(
        native ? nativeLoginErrorUrl("not_allowed") : `${origin}/login?error=not_allowed`,
      );
    }

    // 名前・画像は表示にしか使わない。本人の確かめ（認証IDの付け替え）には user_metadata を使わない。
    const metadata = user.user_metadata as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === "string" && value ? value : null);

    stage = "user_link";
    const linked = await linkUser({
      store: userLinkStore,
      authUserId: user.id,
      profile: {
        email: user.email ?? null,
        name: text(metadata.full_name) ?? text(metadata.name),
        image: text(metadata.avatar_url),
      },
      googleSubjects: googleSubjectsOf(user.identities),
      verifyGoogle: async () => {
        stage = "google_identity";
        const identity = await fetchVerifiedGoogleIdentity(data.session?.provider_token);
        stage = "user_link";
        return identity;
      },
    });

    if (!linked.ok) {
      return await fail(stage, "account_conflict", linked.reason);
    }
    if (linked.outcome === "relinked") {
      // 付け替えは障害対応の追跡に要るため、IDだけ残す（メールは出さない）
      console.info(`[dayspan] 認証IDが変わった既存ユーザーを付け替え: user=${linked.userId}`);
    }

    stage = "session_handoff";
    if (native && challenge) {
      const session = data.session;
      if (!session) {
        return NextResponse.redirect(nativeLoginErrorUrl("auth_failed"));
      }

      const nextParam = searchParams.get("next");
      const handoffCode = await issueHandoff({
        store: handoffStore,
        challenge,
        sessionCipher: encryptSecret(
          JSON.stringify({
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
          }),
        ),
        next: nextParam ? safeInternalPath(nextParam) : null,
        now: new Date(),
      });

      const nativeResponse = NextResponse.redirect(nativeLoginCodeUrl(handoffCode));
      // シートのCookieはシートの終了で捨てられるが、念のためここでも消す。サーバー側の
      // セッションは失効させない（引き継ぎ先のWKWebViewが同じセッションを使うため）。
      for (const { name } of request.cookies.getAll()) {
        if (name.startsWith("sb-")) nativeResponse.cookies.delete(name);
      }
      return nativeResponse;
    }

    const response = NextResponse.redirect(`${origin}${next}`);

    // ログインを求められた＝セッションが途切れた体験。ブラウジングコンテキスト自体は
    // 変わらないため起動判定（resetCalendarMemoryOnLaunch）には掛からず、以前見ていた
    // 月の記憶がそのまま残ってしまう（issue #486）。ログイン成功時も起動時と同様に捨てる。
    response.cookies.delete(CALENDAR_VIEW_COOKIE);

    return response;
  } catch (error) {
    const detail = error instanceof GoogleIdentityError ? error.message : errorCode(error);
    return await fail(stage, "callback_failed", detail);
  }
}

/** Supabaseがこの認証IDに結び付けたGoogleのID。identity_data はプロバイダが返した値で、利用者は書き換えられない。 */
function googleSubjectsOf(identities: User["identities"]): string[] {
  return (identities ?? [])
    .filter((identity) => identity.provider === "google")
    .flatMap((identity) => [identity.id, identity.identity_data?.sub])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

/** Prismaの例外は本文に値（メール等）を含みうるため、コードだけを取り出す。 */
function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code: unknown };
    if (typeof code === "string" && /^[A-Z0-9_]{1,16}$/.test(code)) return code;
  }
  return error instanceof Error ? error.name : "unknown";
}
