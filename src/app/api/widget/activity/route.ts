import { resolveWidgetUserId, widgetJson } from "@/app/api/widget/shared";
import { isWidgetFreshRequest } from "@/lib/widget-fresh";
import { buildActivityWidgetSummary } from "@/services/activity/summary";

/**
 * iPhoneウィジェットが読む活動記録（docs/spec.md §28）。
 *
 * `Parameter` が空、または `activity` の枠がここを読む。配布済みの台本もこのパスを直接
 * 読んでいるため、面が増えてもここは変えない。
 *
 * 認証はウィジェット専用トークンのみ（api/widget/shared.ts）。
 */
export async function GET(request: Request) {
  const auth = await resolveWidgetUserId(request);
  if (!auth.ok) return auth.response;

  return widgetJson(await buildActivityWidgetSummary(auth.userId, { fresh: isWidgetFreshRequest(request.headers) }));
}
