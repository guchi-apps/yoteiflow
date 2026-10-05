import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import {
  createWorkRecord,
  WorkDateTakenError,
  type WorkWriteInput,
} from "@/services/notion/work-logs";
import { syncWorkRecord } from "@/services/work-sync/sync";
import { HOLIDAY_TITLE } from "@/types/work";

import { dateTaken, validateWorkBody } from "../shared";

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

  const body = (await request.json()) as WorkWriteInput;
  const invalid = validateWorkBody(body, { requireStartDate: true });
  if (invalid) return invalid;

  try {
    const created = await createWorkRecord(createNotionClient(connection), connection, {
      ...body,
      startDate: body.startDate!,
      // タイトルを送ってこない経路（API・将来のMCP）でも、Notionの一覧で開かずに読める名前にする。
      title: body.title?.trim() || defaultWorkTitle(body),
    });
    // 勤務予定・移動の同期の失敗は、勤務記録の保存の成否とは切り離して応答へ載せる。
    const sync = await syncWorkRecord(userId, created).catch(() => null);
    return NextResponse.json({ record: created, sync });
  } catch (error) {
    if (error instanceof WorkDateTakenError) return dateTaken();
    return externalApiError("notion", "勤務記録の作成", error);
  }
}
