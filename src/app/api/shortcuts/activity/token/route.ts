import { isApnsEnvironment } from "@/lib/apns/send";
import {
  resolveActivityStopUserId,
  shortcutError,
  shortcutJson,
} from "@/app/api/shortcuts/shared";
import {
  isValidLiveActivityToken,
  saveLiveActivityToken,
} from "@/services/live-activity/devices";
import { syncRegisteredLiveActivityToken } from "@/services/live-activity/notify";

type Body = { token?: string; environment?: string; title?: unknown; startedAtEpoch?: unknown };

/**
 * アプリが受け取ったactivity push tokenを登録する（issue #971）。
 *
 * push-to-startで裏起動されたアプリにはWebViewが無く、Cookieのセッションでは呼べない。
 * そのため停止専用トークンをBearerにして、アプリがURLSessionで直接送る。
 *
 * 登録が停止より遅れた端末は、停止の end を受け取れていない。保存したあと今の記録と突き合わせ、
 * 記録中でなければそのトークンへ end を、表示中の記録（`title`・`startedAtEpoch`。古いアプリは
 * 添えない）が食い違えば update を送る（issue #1280）。
 */
export async function POST(request: Request) {
  const auth = await resolveActivityStopUserId(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Body | null;
  const token = body?.token?.trim();
  if (!token || !isValidLiveActivityToken(token)) {
    return shortcutError(400, "invalid_token", "トークンが読めませんでした。");
  }
  if (!isApnsEnvironment(body?.environment)) {
    return shortcutError(400, "invalid_environment", "environment が読めませんでした。");
  }

  const target = { token, environment: body.environment };
  await saveLiveActivityToken(auth.userId, target);
  const shown =
    typeof body.title === "string" &&
    typeof body.startedAtEpoch === "number" &&
    Number.isFinite(body.startedAtEpoch)
      ? { title: body.title, startedAtEpoch: body.startedAtEpoch }
      : null;
  await syncRegisteredLiveActivityToken(auth.userId, target, shown);
  return shortcutJson({ ok: true, message: "登録しました。" });
}
