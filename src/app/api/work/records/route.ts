import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import {
  createWorkRecord,
  workCapabilities,
  WorkDateTakenError,
  WorkSegmentsInvalidError,
  type WorkWriteInput,
} from "@/services/notion/work-logs";
import { saveRecordOverride } from "@/services/work-sync/config";
import { syncWorkRecord } from "@/services/work-sync/sync";
import { HOLIDAY_TITLE } from "@/types/work";

import {
  checkWorkSync,
  dateTaken,
  invalidSegments,
  segmentsUnsupported,
  splitWorkSync,
  validateWorkBody,
  type WorkRequestBody,
} from "../shared";

/** タイトルが省かれたときの名前。年休は区分まで、通常の勤務は勤務場所をそのまま使う。 */
function defaultWorkTitle(body: WorkWriteInput): string {
  if (body.companyHoliday) return HOLIDAY_TITLE;
  if (body.annualLeave) return `年休（${body.annualLeave}）`;
  return body.place || "勤務";
}

/** 勤務場所・出張・年休・会社休業日を1件作る（docs/spec.md §34）。 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionWorkConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "work_database_not_selected" }, { status: 404 });
  }

  const raw = (await request.json()) as WorkRequestBody;
  const { input: body, override, error: badSync } = splitWorkSync(raw);
  if (badSync) return badSync;
  const invalid = validateWorkBody(body, { requireStartDate: true });
  if (invalid) return invalid;
  const unsupported = segmentsUnsupported(body, workCapabilities(connection).segments);
  if (unsupported) return unsupported;
  if (override) {
    const incomplete = await checkWorkSync(userId, null, body, override);
    if (incomplete) return incomplete;
  }

  try {
    const created = await createWorkRecord(createNotionClient(connection), connection, {
      ...body,
      startDate: body.startDate!,
      // タイトルを送ってこない経路（API・将来のMCP）でも、Notionの一覧で開かずに読める名前にする。
      title: body.title?.trim() || defaultWorkTitle(body),
    });
    // この記録だけの指定は、記録を作れてから保存する（同期はこの値を優先して使う）。
    if (override) await saveRecordOverride(userId, created.id, override);
    // 勤務予定・移動の同期の失敗は、勤務記録の保存の成否とは切り離して応答へ載せる。
    const sync = await syncWorkRecord(userId, created).catch(() => null);
    return NextResponse.json({ record: created, sync });
  } catch (error) {
    if (error instanceof WorkDateTakenError) return dateTaken();
    if (error instanceof WorkSegmentsInvalidError) return invalidSegments(error.message);
    return externalApiError("notion", "勤務記録の作成", error);
  }
}
