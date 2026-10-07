import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { saveRecordOverride } from "@/services/work-sync/config";
import { removeWorkRecordGenerated, syncWorkRecord } from "@/services/work-sync/sync";
import {
  deleteWorkRecord,
  getWorkRecord,
  updateWorkRecord,
  workCapabilities,
  WorkDateTakenError,
  WorkRecordNotEditableError,
  WorkSegmentsInvalidError,
} from "@/services/notion/work-logs";

import {
  checkWorkSync,
  dateTaken,
  invalidSegments,
  notEditable,
  segmentsUnsupported,
  splitWorkSync,
  validateWorkBody,
  type WorkRequestBody,
} from "../../shared";

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
  const raw = (await request.json()) as WorkRequestBody;
  const { input: body, override, error: badSync } = splitWorkSync(raw);
  if (badSync) return badSync;
  const invalid = validateWorkBody(body, { requireStartDate: false });
  if (invalid) return invalid;
  const unsupported = segmentsUnsupported(body, workCapabilities(connection).segments);
  if (unsupported) return unsupported;

  try {
    const notion = createNotionClient(connection);
    if (override) {
      const base = await getWorkRecord(notion, connection, pageId);
      const incomplete = await checkWorkSync(userId, base, body, override);
      if (incomplete) return incomplete;
    }
    const { segmentsCleared } = await updateWorkRecord(notion, connection, pageId, body);
    if (override) await saveRecordOverride(userId, pageId, override);
    // 部分更新でも最新の中身から再計算する。同期の失敗は保存の成否と切り離して応答へ載せる。
    const sync = await getWorkRecord(notion, connection, pageId)
      .then((record) => (record ? syncWorkRecord(userId, record) : null))
      .catch(() => null);
    // 記録本体の変更で時間帯の内訳と食い違い、内訳を空にしたときは画面で知らせる（issue #1155）。
    return NextResponse.json({ ok: true, sync, segmentsCleared });
  } catch (error) {
    if (error instanceof WorkRecordNotEditableError) return notEditable();
    if (error instanceof WorkDateTakenError) return dateTaken();
    if (error instanceof WorkSegmentsInvalidError) return invalidSegments(error.message);
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
