/**
 * 結果に `task` があれば、トップレベルへ `taskId` を添える（issue #1508。作成直後に紐づけを保存する呼び出し元向け）。
 * 冪等記録に保存する形は変えず、新旧どちらの記録でもここで補う。
 */
export function withTaskId(result: unknown): unknown {
  if (!result || typeof result !== "object" || "taskId" in result) return result;
  const task = (result as { task?: { id?: unknown } }).task;
  return typeof task?.id === "string" ? { taskId: task.id, ...result } : result;
}
