import { NextResponse } from "next/server";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { externalApiError } from "@/lib/api-error";
import { fiscalYearOf, fiscalYearRange, normalizeStartMonth } from "@/lib/annual-leave";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import {
  listAnnualLeaveRecords,
  workCapabilities,
  workDatabaseReady,
} from "@/services/notion/work-logs";
import { normalizeWorkMinutes, type AnnualLeaveSummaryData } from "@/types/work";

/**
 * 今年度の年休の取得状況（issue #1484）。勤務画面のヘッダーのチップが読む。
 *
 * 集計は画面側で `summarizeAnnualLeave()` / `remainingLeave()` にかける。年休画面（`/work/leave`）と
 * 同じ関数を通すことで、2つの画面の数字が食い違わない。ここは材料（記録・付与・今日）を返すだけ。
 * 年休だけを `年休 is_not_empty` で絞って取るため、勤務場所の記録まで1年ぶん読むことはない。
 *
 * 年休の列が無い・勤務記録DBが未設定のときは404（チップごと出さない）。Notionが失敗したときは
 * 200で返さない（失敗を保存済みとして再生させないため。`/api/work/month` と同じ）。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionWorkConnection(userId);
  if (!connection || !workDatabaseReady(connection) || !workCapabilities(connection).annualLeave) {
    return NextResponse.json({ error: "annual_leave_not_ready" }, { status: 404 });
  }

  const uiSetting = await db.uiSetting.findUnique({
    where: { userId },
    select: { timeZone: true, fiscalYearStartMonth: true, workMinutesPerDay: true },
  });
  const todayKey = createCalendarDateUtils(uiSetting?.timeZone ?? "Asia/Tokyo").todayKey();
  const startMonth = normalizeStartMonth(uiSetting?.fiscalYearStartMonth);
  const fiscalYear = fiscalYearOf(todayKey, startMonth);

  try {
    const [grant, records] = await Promise.all([
      db.annualLeaveGrant.findUnique({
        where: { userId_fiscalYear: { userId, fiscalYear } },
      }),
      listAnnualLeaveRecords(
        createNotionClient(connection),
        connection,
        fiscalYearRange(fiscalYear, startMonth),
      ),
    ]);

    const data: AnnualLeaveSummaryData = {
      fiscalYear,
      startMonth,
      todayKey,
      records,
      grantedDays: grant?.grantedDays ?? null,
      carriedOverDays: grant?.carriedOverDays ?? 0,
      workMinutesPerDay: normalizeWorkMinutes(uiSetting?.workMinutesPerDay),
    };
    return NextResponse.json(data);
  } catch (error) {
    return externalApiError("notion", "年休の取得", error);
  }
}
