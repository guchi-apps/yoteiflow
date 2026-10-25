import { NextResponse } from "next/server";

import { requireInternalEventsApiKey, resolveInternalUserId } from "@/lib/internal-auth";
import { resolveGoogleAccountForCalendar } from "@/services/calendar/write-context";
import { getEvent } from "@/services/google-calendar/events";
import { operationStore } from "@/services/internal/tasks";
import { InternalTaskConflictError, InternalTaskInputError } from "@/services/internal/task-contract";
import { assertIdempotencyKey } from "@/services/internal/task-operations";
import {
  InternalTravelDuplicateError,
  InternalTravelInputError,
  parseInternalTravelCreate,
  runTravelCreate,
  toWriteInput,
  type TravelGateway,
} from "@/services/internal/travels";
import {
  createTravelRecord,
  exportCreatedTravel,
  findSameTravelId,
  getTravel,
} from "@/services/travel/plans";

export const dynamic = "force-dynamic";

const gateway: TravelGateway = {
  findSameTravelId: (userId, input) => findSameTravelId(userId, input),
  async verifyLink(userId, calendarId, eventId) {
    const target = await resolveGoogleAccountForCalendar(userId, calendarId);
    if (!target.ok) throw new InternalTravelInputError("linked_calendar_not_writable");
    try {
      await getEvent(target.account, calendarId, eventId);
    } catch {
      throw new InternalTravelInputError("linked_event_not_found");
    }
  },
  save: (userId, input) => createTravelRecord(userId, toWriteInput(input)),
  load: (userId, travelId) => getTravel(userId, travelId),
  export: (userId, plan) => exportCreatedTravel(userId, plan),
};

/**
 * 移動を1件作る（issue #1432・docs/internal-api.md）。
 * 認証は予定の書き込み鍵。`Idempotency-Key` 必須で、同じキーの再送は二重に作らない。
 * 本文（メモ等）と鍵はログへ出さない。
 */
export async function POST(request: Request) {
  const unauthorized = await requireInternalEventsApiKey(request);
  if (unauthorized) return unauthorized;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid_json_body", executed: false }, 400);
  }

  try {
    const key = request.headers.get("idempotency-key") ?? "";
    assertIdempotencyKey(key);
    const input = parseInternalTravelCreate(raw);
    const userId = await resolveInternalUserId(request);
    if (!userId) return json({ error: "target_user_not_resolvable" }, 500);

    const outcome = await runTravelCreate(
      { store: operationStore, gateway, now: () => new Date() },
      { userId, idempotencyKey: key },
      input,
    );

    switch (outcome.kind) {
      case "succeeded":
        return json({ ...outcome.result, replayed: outcome.replayed }, outcome.replayed ? 200 : 201);
      case "in_progress":
        return NextResponse.json(
          { error: "operation_in_progress", executed: "unknown", retryWithSameKey: true, retryAfterSeconds: outcome.retryAfterSeconds },
          { status: 409, headers: { "Cache-Control": "no-store", "Retry-After": String(outcome.retryAfterSeconds) } },
        );
      case "not_executed":
        return notExecuted(outcome.error);
      case "unknown":
        console.error("[dayspan] internal travel create result unknown:", errorName(outcome.error));
        return json({ error: "result_unknown", executed: "unknown", retryWithSameKey: true }, 502);
    }
  } catch (error) {
    return notExecuted(error);
  }
}

function notExecuted(error: unknown): NextResponse {
  if (error instanceof InternalTravelDuplicateError) {
    return json({ error: "duplicate_travel", executed: false, existingTravelId: error.existingTravelId, confirmWith: "confirmDuplicate" }, 409);
  }
  if (error instanceof InternalTravelInputError) {
    return json({ error: error.code, message: error.message, executed: false }, error.code === "linked_event_not_found" ? 404 : 400);
  }
  if (error instanceof InternalTaskConflictError) return json({ error: error.message, executed: false }, 409);
  if (error instanceof InternalTaskInputError) return json({ error: error.message, executed: false }, 400);
  console.error("[dayspan] internal travel create failed:", errorName(error));
  return json({ error: "internal_error", executed: "unknown", retryWithSameKey: true }, 500);
}

/** 例外の本文には入力（メモ等）が混ざりうるため、名前だけをログへ出す。 */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "error";
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
