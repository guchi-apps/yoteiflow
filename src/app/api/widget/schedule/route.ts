import { resolveWidgetUserId, widgetJson } from "@/app/api/widget/shared";
import { isWidgetFreshRequest } from "@/lib/widget-fresh";
import { buildWidgetSchedule } from "@/services/widget/schedule";

/**
 * iPhoneウィジェットが読む今日の予定（docs/spec.md §28）。
 *
 * ウィジェットを編集の `Parameter` に `schedule` を入れた枠がここを読む。面ごとにパスを
 * 分けているのは、1つにまとめると買い物リストを見るためだけの更新でもGoogle Calendarへ
 * 問い合わせることになるため（docs/spec.md §20）。
 */
export async function GET(request: Request) {
  const auth = await resolveWidgetUserId(request);
  if (!auth.ok) return auth.response;

  return widgetJson(await buildWidgetSchedule(auth.userId, { fresh: isWidgetFreshRequest(request.headers) }));
}
