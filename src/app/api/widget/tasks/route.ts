import { resolveWidgetUserId, widgetJson } from "@/app/api/widget/shared";
import { isWidgetFreshRequest } from "@/lib/widget-fresh";
import { buildWidgetTasks } from "@/services/widget/tasks";

/**
 * iPhoneウィジェットが読むタスク（docs/spec.md §28）。
 *
 * ウィジェットを編集の `Parameter` に `tasks` を入れた枠がここを読む。分類と並び順は
 * タスク画面と同じ関数を通すため、件数が画面の見出しと食い違わない。
 */
export async function GET(request: Request) {
  const auth = await resolveWidgetUserId(request);
  if (!auth.ok) return auth.response;

  return widgetJson(await buildWidgetTasks(auth.userId, { fresh: isWidgetFreshRequest(request.headers) }));
}
