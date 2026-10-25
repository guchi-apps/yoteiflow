import { safeInternalPath } from "@/lib/home-path";

/**
 * 未ログインで保護ページを開いたときに、ログイン後の戻り先（`/login?callbackUrl=`）へ入れる値。
 *
 * 以前はパスだけを入れており、`/calendar?date=2026-11-09` のリンクから入るとログイン後に日付が
 * 落ちて今日のカレンダーになっていた（issue #1366）。クエリも残す。値はこの後の `/login`・
 * `/auth/signin`・`/auth/callback` で `resolveInternalPath()` を通るため外部へは飛ばないが、
 * ここでも安全でない形（`//evil.com` など）ならパスだけ・それも駄目なら起点へ落とす。
 */
export function loginCallbackPath(pathname: string, search: string): string {
  return safeInternalPath(`${pathname}${search}`) ?? safeInternalPath(pathname) ?? "/";
}
