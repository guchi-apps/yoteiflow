import { requireInternalTasksApiKey, resolveInternalUserId } from "@/lib/internal-auth";
import { getNotionConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import type { PropertyMap } from "@/services/notion/task-database";
import { operationStore, parseTaskAction, requestHash, taskGateway } from "@/services/internal/tasks";
import { assertIdempotencyKey, runActionOperation } from "@/services/internal/task-operations";

import { json, operationResponse, taskError } from "../../route";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const unauthorized = await requireInternalTasksApiKey(request);
  if (unauthorized) return unauthorized;
  let raw: Record<string, unknown>;
  try { raw = (await request.json()) as Record<string, unknown>; } catch { return json({ error: "invalid_json_body" }, 400); }
  try {
    const userId = await resolveInternalUserId(request);
    if (!userId) return json({ error: "target_user_not_resolvable" }, 500);
    const connection = await getNotionConnection(userId);
    if (!connection) return json({ error: "not_connected" }, 404);
    const { taskId } = await params;
    const action = parseTaskAction(raw.action);
    if ((action === "skip" || action === "unskip") && !(connection.propertyMap as PropertyMap | null)?.outcome) {
      return json({ error: "unsupported_field:outcome" }, 400);
    }
    const key = request.headers.get("idempotency-key") ?? "";
    assertIdempotencyKey(key);
    const outcome = await runActionOperation(
      { store: operationStore, gateway: taskGateway(createNotionClient(connection), connection), now: () => new Date() },
      { userId, idempotencyKey: key, taskId, requestHash: requestHash(raw) },
      action,
      raw.version,
    );
    return operationResponse(outcome, 200, "内部タスクの状態変更");
  } catch (error) { return taskError(error, "内部タスクの状態変更"); }
}
