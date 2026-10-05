import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { removeWorkRecordGenerated, syncWorkRecord } from "@/services/work-sync/sync";
import {
  deleteWorkRecord,
  getWorkRecord,
  updateWorkRecord,
  WorkDateTakenError,
  WorkRecordNotEditableError,
  type WorkWriteInput,
} from "@/services/notion/work-logs";

import { dateTaken, notEditable, validateWorkBody } from "../../shared";

export async function PATCH(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionWorkConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "work_database_not_selected" }, { status: 404 });
  }

  const { pageId } = await params;
  const body = (await request.json()) as WorkWriteInput;
  const invalid = validateWorkBody(body, { requireStartDate: false });
  if (invalid) return invalid;

  try {
    const notion = createNotionClient(connection);
    await updateWorkRecord(notion, connection, pageId, body);
    // 部分更新でも最新の中身から再計算する。同期の失敗は保存の成否と切り離して応答へ載せる。
    const sync = await getWorkRecord(notion, connection, pageId)
      .then((record) => (record ? syncWorkRecord(userId, record) : null))
      .catch(() => null);
    return NextResponse.json({ ok: true, sync });
  } catch (error) {
    if (error instanceof WorkRecordNotEditableError) return notEditable();
    if (error instanceof WorkDateTakenError) return dateTaken();
    return externalApiError("notion", "勤務記録の更新", error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ pageId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionWorkConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "work_database_not_selected" }, { status: 404 });
  }

  const { pageId } = await params;

  try {
    await deleteWorkRecord(createNotionClient(connection), connection, pageId);
    const sync = await removeWorkRecordGenerated(userId, pageId).catch(() => null);
    return NextResponse.json({ ok: true, sync });
  } catch (error) {
    if (error instanceof WorkRecordNotEditableError) return notEditable();
    return externalApiError("notion", "勤務記録の削除", error);
  }
}
