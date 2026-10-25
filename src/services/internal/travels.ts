import { createHash } from "node:crypto";

import type { TravelPlan } from "@prisma/client";

import { isTravelMode, type TravelMode } from "@/types/calendar";
import type { TravelExportResult } from "@/services/travel/google-sync";
import type { TravelWriteInput } from "@/services/travel/plans";
import { validateTravelInput } from "@/services/travel/travel-validation";
import { InternalTaskConflictError } from "@/services/internal/task-contract";
import {
  claimOperation,
  IN_PROGRESS_RETRY_SECONDS,
  OPERATION_STATES,
  type OperationOutcome,
  type OperationStore,
} from "@/services/internal/task-operations";

/**
 * AIDEから移動を1件作る内部API（`POST /api/internal/travels`・issue #1432）の中身。
 *
 * 冪等記録は `InternalTaskOperation` を流用する（`operation: "travel-create"`・マイグレーション無し）。
 * 流用するのは `claimOperation`・`OperationStore` だけで、タスク専用の実行（`runCreateOperation`）は
 * 使わない。保存（DB）→ travelId の記録 → Google書き出し の順に進み、どこで止まっても同じキーの
 * 再送が続きから実行する（保存済みなら作り直さず、書き出しだけをやり直す）。
 */

export const TRAVEL_CREATE_OPERATION = "travel-create";

/** 入力が不正（未実行）。`code` は応答の `error` にそのまま出す。 */
export class InternalTravelInputError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/** 既存の移動と同一内容。`confirmDuplicate: true` を付けた再送でだけ作る。 */
export class InternalTravelDuplicateError extends Error {
  existingTravelId: string;
  constructor(existingTravelId: string) {
    super("duplicate_travel");
    this.existingTravelId = existingTravelId;
  }
}

export type InternalTravelCreateInput = {
  origin: string;
  destination: string;
  via: string[] | null;
  mode: TravelMode;
  /** UTCのISO 8601へ正規化済み */
  departAt: string;
  arriveAt: string;
  note: string | null;
  linkedEventId: string | null;
  linkedCalendarId: string | null;
  confirmDuplicate: boolean;
};

const ALLOWED_KEYS = new Set([
  "origin",
  "destination",
  "via",
  "mode",
  "departAt",
  "arriveAt",
  "note",
  "linkedEventId",
  "linkedCalendarId",
  "confirmDuplicate",
]);

const MAX_PLACE = 200;
const MAX_NOTE = 10_000;
const MAX_VIA = 10;
/** タイムゾーン（`Z` か `±hh:mm`）を必ず含む日時。無いとサーバーのUTCで解釈され9時間ずれる。 */
const OFFSET_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new InternalTravelInputError("invalid_request", `${field} is required`);
  if (value.length > max) throw new InternalTravelInputError("invalid_request", `${field} is too long`);
  return value.trim();
}

function datetime(value: unknown, field: string): string {
  if (typeof value !== "string" || !OFFSET_DATETIME.test(value)) {
    throw new InternalTravelInputError("invalid_datetime", `${field} must be ISO 8601 with a timezone offset (e.g. 2026-11-01T09:30:00+09:00)`);
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new InternalTravelInputError("invalid_datetime", `${field} is not a real date`);
  return new Date(time).toISOString();
}

/** リクエスト本文を許可項目だけに絞って検証し、保存用の形へ正規化する。 */
export function parseInternalTravelCreate(raw: unknown): InternalTravelCreateInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InternalTravelInputError("invalid_request", "body must be an object");
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) throw new InternalTravelInputError("unsupported_field", `unsupported field: ${key}`);
  }

  let via: string[] | null = null;
  if (body.via != null) {
    if (!Array.isArray(body.via) || body.via.length > MAX_VIA) throw new InternalTravelInputError("invalid_request", "via must be an array");
    via = body.via.map((v) => text(v, "via", MAX_PLACE));
  }
  if (!isTravelMode(body.mode)) throw new InternalTravelInputError("invalid_request", "mode is invalid");
  if (body.note != null && typeof body.note !== "string") throw new InternalTravelInputError("invalid_request", "note must be a string");
  if (typeof body.note === "string" && body.note.length > MAX_NOTE) throw new InternalTravelInputError("invalid_request", "note is too long");
  for (const key of ["linkedEventId", "linkedCalendarId"] as const) {
    if (body[key] != null && (typeof body[key] !== "string" || !(body[key] as string).trim())) {
      throw new InternalTravelInputError("invalid_request", `${key} must be a non-empty string`);
    }
  }
  if (body.confirmDuplicate != null && typeof body.confirmDuplicate !== "boolean") {
    throw new InternalTravelInputError("invalid_request", "confirmDuplicate must be a boolean");
  }

  const input: InternalTravelCreateInput = {
    origin: text(body.origin, "origin", MAX_PLACE),
    destination: text(body.destination, "destination", MAX_PLACE),
    via: via && via.length > 0 ? via : null,
    mode: body.mode,
    departAt: datetime(body.departAt, "departAt"),
    arriveAt: datetime(body.arriveAt, "arriveAt"),
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
    linkedEventId: (body.linkedEventId as string | undefined)?.trim() ?? null,
    linkedCalendarId: (body.linkedCalendarId as string | undefined)?.trim() ?? null,
    confirmDuplicate: body.confirmDuplicate === true,
  };

  if (Date.parse(input.arriveAt) <= Date.parse(input.departAt)) {
    throw new InternalTravelInputError("invalid_datetime", "arriveAt must be after departAt");
  }
  if (input.linkedEventId && !input.linkedCalendarId) {
    throw new InternalTravelInputError("invalid_request", "linkedEventId requires linkedCalendarId");
  }
  if (input.linkedCalendarId && !input.linkedEventId) {
    throw new InternalTravelInputError("invalid_request", "linkedCalendarId requires linkedEventId");
  }
  // UIと同じ検証を通す（画面を通らない経路でも同じ条件で断る）。
  const invalid = validateTravelInput(toWriteInput(input));
  if (invalid) throw new InternalTravelInputError("invalid_request", invalid);
  return input;
}

export function toWriteInput(input: InternalTravelCreateInput): TravelWriteInput {
  return {
    origin: input.origin,
    destination: input.destination,
    via: input.via,
    mode: input.mode,
    departAt: input.departAt,
    arriveAt: input.arriveAt,
    note: input.note,
    estimateSource: "MANUAL",
    linkedEventId: input.linkedEventId,
    linkedCalendarId: input.linkedCalendarId,
  };
}

/** 同一リクエストかを見分ける指紋。正規化後の入力なので、日時の書き方の違い（+09:00 と Z）は同じになる。 */
export function travelRequestHash(input: InternalTravelCreateInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** 応答に載せる結果。保存の成否とGoogle書き出しの成否は別に持つ。 */
export type TravelCreateResult = {
  saved: true;
  travelId: string;
  googleExport: TravelExportResult;
};

export interface TravelGateway {
  /** 同一内容の既存移動のID（なければ null） */
  findSameTravelId(userId: string, input: InternalTravelCreateInput): Promise<string | null>;
  /** 紐づけ先の予定が、そのユーザーの書き込み可能なカレンダーに実在するかを確かめる。だめなら `InternalTravelInputError` */
  verifyLink(userId: string, calendarId: string, eventId: string): Promise<void>;
  save(userId: string, input: InternalTravelCreateInput): Promise<TravelPlan>;
  load(userId: string, travelId: string): Promise<TravelPlan | null>;
  export(userId: string, plan: TravelPlan): Promise<TravelExportResult>;
}

type Deps = { store: OperationStore; gateway: TravelGateway; now: () => Date };

type Progress = { writeAttemptedAt?: string; savedTravelId?: string };

export type TravelOutcome =
  | { kind: "succeeded"; result: TravelCreateResult; replayed: boolean }
  | Exclude<OperationOutcome<never>, { kind: "succeeded" } | { kind: "reconciliation_required" }>;

/**
 * 移動を1件作る。
 * - 同じキー・同じ内容の再送: 保存済みIDを返す。Google書き出しが失敗のままなら書き出しだけやり直す
 * - 同じキーで内容が違う: `InternalTaskConflictError("idempotency_key_reused")`
 * - 別キーで同一内容の既存あり: `confirmDuplicate` が無ければ `InternalTravelDuplicateError`
 * - DB保存で失敗した（保存されたか不明）: `unknown`。同じキーの再送で、同一内容が既にあればそれを採る
 */
export async function runTravelCreate(
  deps: Deps,
  identity: { userId: string; idempotencyKey: string },
  input: InternalTravelCreateInput,
): Promise<TravelOutcome> {
  const { store, gateway, now } = deps;
  const { userId } = identity;
  const claim = await claimOperation(
    store,
    { ...identity, operation: TRAVEL_CREATE_OPERATION, taskId: null, requestHash: travelRequestHash(input) },
    now(),
  );

  if (claim.kind === "in_progress") return claim;
  if (claim.kind === "succeeded") {
    const stored = claim.result as TravelCreateResult;
    if (stored.googleExport.status !== "failed") return { kind: "succeeded", result: stored, replayed: true };
    // 書き出しに失敗していた回の再送は、書き出しだけをやり直す（移動は作り直さない）。
    const plan = await gateway.load(userId, stored.travelId);
    if (!plan) return { kind: "succeeded", result: stored, replayed: true };
    // Google予定の作成を試みた後の失敗（作成の成否・ID保存の成否が不明）で、移動にイベントIDが無いときは
    // 再実行すると createEvent が重複した予定を作る。自動で書き出し直さず失敗のまま返す。
    const failed = stored.googleExport;
    let target = plan;
    if (failed.status === "failed" && failed.createUncertain && !plan.googleEventId) {
      // 作成済みのIDが分かっていれば控え直す（updateになるので重複しない）。分からなければ失敗のまま返す。
      if (!failed.createdEventId || !failed.createdCalendarId) {
        return { kind: "succeeded", result: stored, replayed: true };
      }
      target = { ...plan, googleEventId: failed.createdEventId, googleCalendarId: failed.createdCalendarId };
    }
    const googleExport = await gateway.export(userId, target);
    const result: TravelCreateResult = { ...stored, googleExport };
    await store.update(await recordId(store, identity), { result: result as object });
    return { kind: "succeeded", result, replayed: true };
  }

  const record = claim.record;
  const progress: Progress = claim.progress;
  try {
    let plan: TravelPlan | null = null;
    if (progress.savedTravelId) plan = await gateway.load(userId, progress.savedTravelId);

    if (!plan) {
      // 保存を始めたまま結果が分からない回の再送は、その試行の時刻以降に作られた同一内容の移動だけを採る
      // （二重に作らない）。それより前からある同一内容は利用者の別の移動なので採らず、通常の重複確認へ進む。
      if (claim.recovering && progress.writeAttemptedAt) {
        const candidateId = await gateway.findSameTravelId(userId, input);
        const candidate = candidateId ? await gateway.load(userId, candidateId) : null;
        if (candidate && candidate.createdAt.getTime() >= Date.parse(progress.writeAttemptedAt)) plan = candidate;
      }
      if (!plan) {
        if (!input.confirmDuplicate) {
          const existing = await gateway.findSameTravelId(userId, input);
          if (existing) throw new InternalTravelDuplicateError(existing);
        }
        if (input.linkedEventId && input.linkedCalendarId) {
          await gateway.verifyLink(userId, input.linkedCalendarId, input.linkedEventId);
        }
        await store.update(record.id, { result: { progress: { writeAttemptedAt: now().toISOString() } } });
        try {
          plan = await gateway.save(userId, input);
        } catch (error) {
          await store.update(record.id, { state: OPERATION_STATES.unknown });
          return { kind: "unknown", error };
        }
      }
    }
    if (!plan) throw new Error("travel_not_found_after_save");

    await store.update(record.id, { result: { progress: { ...progress, savedTravelId: plan.id } } });
    const googleExport = await gateway.export(userId, plan);
    const result: TravelCreateResult = { saved: true, travelId: plan.id, googleExport };
    await store.update(record.id, { state: OPERATION_STATES.succeeded, result: result as object });
    return { kind: "succeeded", result, replayed: false };
  } catch (error) {
    if (error instanceof InternalTravelInputError || error instanceof InternalTravelDuplicateError) {
      await store.update(record.id, { state: OPERATION_STATES.notExecuted, result: { error: error.message } });
      return { kind: "not_executed", error };
    }
    // 保存済み（travelIdを記録済み）かもしれない失敗。同じキーの再送が続きから実行する。
    await store.update(record.id, { state: OPERATION_STATES.unknown });
    return { kind: "unknown", error };
  }
}

async function recordId(store: OperationStore, identity: { userId: string; idempotencyKey: string }): Promise<string> {
  const record = await store.find(identity.userId, identity.idempotencyKey);
  if (!record) throw new Error("operation_record_missing");
  return record.id;
}

export { IN_PROGRESS_RETRY_SECONDS, InternalTaskConflictError };
