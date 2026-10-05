import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { listWorkRecordsInRange } from "@/services/notion/work-logs";
import { loadPlacesForSync, syncWorkRecord } from "@/services/work-sync/sync";

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 月ぶんの勤務記録から勤務予定・移動を作り直す（docs/spec.md §46）。
 *
 * 同期の契機は勤務記録の作成・更新・削除だけで、Notionを直接編集した分は追従しない。
 * その取りこぼしを拾う手動の入口。手動で直した生成物は上書きしない。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionWorkConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "work_database_not_selected" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { month?: string };
  const month = body.month ?? "";
  if (!MONTH_KEY.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  const lastDay = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();

  let records;
  try {
    records = await listWorkRecordsInRange(createNotionClient(connection), connection, {
      from: `${month}-01`,
      to: `${month}-${String(lastDay).padStart(2, "0")}`,
    });
  } catch (error) {
    return externalApiError("notion", "勤務記録の取得", error);
  }

  const total = { created: 0, updated: 0, deleted: 0, manual: 0, errors: [] as string[] };
  const missing = new Map<string, { origin: string | null; destination: string }>();
  let disabled = false;
  // 場所DBは記録ごとではなく1回だけ読む（Notionへの往復を月の件数ぶん積まない）。
  const syncPlaces = await loadPlacesForSync(userId);
  for (const record of records) {
    const result = await syncWorkRecord(userId, record, syncPlaces);
    if (result.status === "disabled") {
      disabled = true;
      break;
    }
    total.created += result.created;
    total.updated += result.updated;
    total.deleted += result.deleted;
    total.manual += result.manual;
    total.errors.push(...result.errors);
    for (const route of result.missingRoutes) {
      missing.set(`${route.origin}\n${route.destination}`, route);
    }
  }

  return NextResponse.json({
    status: disabled ? "disabled" : "synced",
    ...total,
    missingRoutes: [...missing.values()],
  });
}
