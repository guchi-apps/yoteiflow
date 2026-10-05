import { NextResponse } from "next/server";

import { externalApiError, externalApiMessage } from "@/lib/api-error";
import { requireInternalApiKey, requireInternalTasksApiKey, resolveInternalUserId } from "@/lib/internal-auth";
import { getNotionConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { TaskNotEditableError } from "@/services/notion/tasks";
import {
  assertWritableFields,
  InternalTaskConflictError,
  InternalTaskInputError,
  listInternalTasks,
  operationStore,
  parseInternalTaskWrite,
  requestHash,
  taskGateway,
} from "@/services/internal/tasks";
import { assertIdempotencyKey, runCreateOperation, type OperationOutcome } from "@/services/internal/task-operations";

export const dynamic = "force-dynamic";
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const unauthorized = await requireInternalApiKey(request);
  if (unauthorized) return unauthorized;
  const params = new URL(request.url).searchParams;
  const status = params.get("status") ?? "open";
  const dateField = params.get("dateField") ?? "due";
  const limit = Number(params.get("limit") ?? "50");
  if (!(["open", "completed", "skipped"] as string[]).includes(status) || !(["due", "planned", "none"] as string[]).includes(dateField))
    return json({ error: "invalid_filter" }, 400);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return json({ error: "invalid_limit" }, 400);
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to))
    return json({ error: "invalid_date_range" }, 400);

  try {
    const userId = await resolveInternalUserId(request);
    if (!userId) return json({ error: "target_user_not_resolvable" }, 500);
    const connection = await getNotionConnection(userId);
    if (!connection) return json({ generatedAt: new Date().toISOString(), source: "not_configured", tasks: [], nextCursor: null, hasMore: false }, 200);
    const result = await listInternalTasks(createNotionClient(connection), connection, {
      status: status as "open" | "completed" | "skipped",
      dateField: dateField as "due" | "planned" | "none",
      from,
      to,
      limit,
      cursor: params.get("cursor") ?? undefined,
    });
    return json({ generatedAt: new Date().toISOString(), source: "ready", ...result }, 200);
  } catch (error) {
    return externalApiError("notion", "内部タスクの取得", error);
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireInternalTasksApiKey(request);
  if (unauthorized) return unauthorized;
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: "invalid_json_body" }, 400); }
  try {
    const userId = await resolveInternalUserId(request);
    if (!userId) return json({ error: "target_user_not_resolvable" }, 500);
    const connection = await getNotionConnection(userId);
    if (!connection) return json({ error: "not_connected" }, 404);
    const input = parseInternalTaskWrite(raw, { create: true });
    assertWritableFields(connection, input);
    const key = request.headers.get("idempotency-key") ?? "";
    assertIdempotencyKey(key);
    const outcome = await runCreateOperation(
      { store: operationStore, gateway: taskGateway(createNotionClient(connection), connection), now: () => new Date() },
      { userId, idempotencyKey: key, requestHash: requestHash(input) },
      input,
    );
    return operationResponse(outcome, 201, "内部タスクの作成");
  } catch (error) { return taskError(error, "内部タスクの作成"); }
}

/**
 * 冪等キー付きの操作の結果を応答にする。失敗は「未実行」（`executed: false`。内容を直して
 * 同じキーでも新しいキーでも再試行してよい）と「結果未確定」（`executed: "unknown"`。
 * 同じキー・同じ内容で再送すると照合・回復する）に分けて返す（issue #1082）。
 */
export function operationResponse(outcome: OperationOutcome<unknown>, successStatus: number, operation: string): NextResponse {
  switch (outcome.kind) {
    case "succeeded":
      return json(outcome.result, outcome.replayed ? 200 : successStatus);
    case "in_progress":
      return retryLater({ error: "operation_in_progress", executed: "unknown", retryWithSameKey: true }, outcome.retryAfterSeconds);
    case "pending":
      return retryLater({ error: "result_unknown", executed: "unknown", retryWithSameKey: true }, outcome.retryAfterSeconds);
    case "not_executed":
      return json({ ...errorBody(outcome.error, operation), executed: false }, errorStatus(outcome.error));
    case "unknown":
      return json(
        { error: "result_unknown", executed: "unknown", retryWithSameKey: true, message: externalApiMessage("notion", operation, outcome.error) },
        502,
      );
  }
}

function retryLater(body: object, retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { ...body, retryAfterSeconds },
    { status: 409, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) } },
  );
}

function errorStatus(error: unknown): number {
  if (error instanceof InternalTaskInputError) return 400;
  if (error instanceof InternalTaskConflictError) return 409;
  if (error instanceof TaskNotEditableError) return 403;
  return 502;
}

function errorBody(error: unknown, operation: string): Record<string, string> {
  if (error instanceof InternalTaskInputError || error instanceof InternalTaskConflictError) return { error: error.message };
  if (error instanceof TaskNotEditableError) return { error: "not_editable" };
  return { error: "notion_request_failed", message: externalApiMessage("notion", operation, error) };
}

export function taskError(error: unknown, operation: string): NextResponse {
  if (error instanceof InternalTaskInputError || error instanceof InternalTaskConflictError || error instanceof TaskNotEditableError)
    return json(errorBody(error, operation), errorStatus(error));
  return externalApiError("notion", operation, error);
}

export function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
