import { resolveWidgetUserId, widgetJson } from "@/app/api/widget/shared";
import { isWidgetFreshRequest } from "@/lib/widget-fresh";
import { buildWidgetShopping } from "@/services/widget/shopping";

/**
 * iPhoneウィジェットが読む買い物リスト（docs/spec.md §28・§36）。
 *
 * ウィジェットを編集の `Parameter` に `shopping` を入れた枠がここを読む。出すのは未購入の
 * ものだけで、書き込み（購入済みの切り替え）はできない。
 */
export async function GET(request: Request) {
  const auth = await resolveWidgetUserId(request);
  if (!auth.ok) return auth.response;

  return widgetJson(await buildWidgetShopping(auth.userId, { fresh: isWidgetFreshRequest(request.headers) }));
}
