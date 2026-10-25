import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createLoadTimer, serverTimingHeader, type LoadTimer } from "@/lib/load-timing";
import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import {
  getMonthsFetchRange,
  getSwipeFetchRange,
  isRealDateKey,
  monthDistance,
  parseDateKey,
} from "@/lib/calendar-range";
import { loadCalendarData } from "@/services/calendar/load";

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

// 1回の要求で取りにいける月の幅（先頭と末尾の差）の上限。窓の幅を超える指定は
// 想定していないため、誤った要求で外部APIを大量に叩かないよう頭打ちにする。
// 件数ではなく差で見るのは、months=2020-01,2026-12 のように件数は少なくても
// getMonthsFetchRange() が先頭と末尾から組む範囲が広がりうるため。
const MAX_MONTHS = 12;

const RANGE_VIEWS = new Set(["day1", "day3", "day7"]);

/**
 * 指定した月、または指定した表示形式・日付の予定とタスクを返す。
 *
 * 月表示は前後の月まで地続きに保持し、窓から外れた月だけをここで取りにいく
 * （`months=` パラメータ）。日・3日・週表示は表示形式の切り替え・日付の移動のたびに
 * 表示中の期間だけをここで取りにいく（`view=`+`date=` パラメータ。`getSwipeFetchRange` と
 * 同じ範囲で、サーバーコンポーネント（`page.tsx`）が最初に描く範囲と一致する）。
 * どちらもページ全体を描き直すと開いているダイアログが閉じてしまうため、
 * サーバーコンポーネントの再レンダリングではなくこのAPIを使う（issue #697）。
 */
export async function GET(request: Request) {
  // 取得元ごとの所要時間を Server-Timing で返す（issue #1431）。開発者ツールの「タイミング」で、
  // 応答の待ち時間のうちNotion・Google・DBが占めた分と、それ以外（回線・認証）を見分けられる。
  const timer = createLoadTimer();
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const uiSetting = await db.uiSetting.findUnique({ where: { userId } });
  const todayKey = createCalendarDateUtils(uiSetting?.timeZone ?? "Asia/Tokyo").todayKey();
  const viewParam = params.get("view");
  const dateParam = params.get("date");

  if (viewParam !== null || dateParam !== null) {
    if (!viewParam || !RANGE_VIEWS.has(viewParam) || !dateParam || !isRealDateKey(dateParam)) {
      return NextResponse.json({ error: "view and date are required" }, { status: 400 });
    }

    // weekStartsOn は日・3日・週表示の範囲計算では使われない（月表示のグリッド整列にしか
    // 影響しない。src/lib/calendar-range.ts の getVisibleDays を参照）ため、ここでは渡さない。
    const range = getSwipeFetchRange(
      viewParam as "day1" | "day3" | "day7",
      parseDateKey(dateParam),
      0,
    );
    const data = await loadCalendarData(userId, range, { todayKey, timer });

    return withServerTiming(NextResponse.json(data), timer);
  }

  const months = (params.get("months") ?? "").split(",").filter((month) => MONTH_KEY.test(month));

  const sortedMonths = [...months].sort();
  const span =
    sortedMonths.length === 0
      ? 0
      : monthDistance(sortedMonths[0], sortedMonths[sortedMonths.length - 1]);

  if (sortedMonths.length === 0 || span >= MAX_MONTHS) {
    return NextResponse.json({ error: "months is required" }, { status: 400 });
  }

  // loadCalendarData は Google / Notion の失敗を errors に載せて返すため、ここでは投げない。
  const data = await loadCalendarData(userId, getMonthsFetchRange(months), { todayKey, timer });

  return withServerTiming(NextResponse.json(data), timer);
}

function withServerTiming(response: NextResponse, timer: LoadTimer): NextResponse {
  response.headers.set("Server-Timing", serverTimingHeader(timer.spans(), timer.elapsed()));
  return response;
}
