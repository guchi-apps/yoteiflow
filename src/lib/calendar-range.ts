// 表示期間の計算。タイムゾーンの解釈は表示側（ブラウザのローカル時刻）に寄せ、
// ここでは「どの日付を並べるか」だけを決める。

export type CalendarView = "month" | "day1" | "day3" | "day7";

export const CALENDAR_VIEWS: CalendarView[] = ["month", "day1", "day3", "day7"];

export function parseView(value: string | undefined): CalendarView {
  return CALENDAR_VIEWS.includes(value as CalendarView) ? (value as CalendarView) : "month";
}

/** YYYY-MM-DD を素の日付として扱う。タイムゾーンの影響を受けないようUTC正午で保持する。 */
export function parseDateKey(value: string | undefined): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00Z`);
  }
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12));
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `YYYY-MM-DD` の形をしていて、かつ実在する日付か。
 *
 * 形だけを見て通すと、2026-13-45 は日付を組み立てる段でRangeErrorになる。2026-02-30 は
 * もっと悪く、例外にならず3月2日へ繰り上がって、頼んだ覚えのない日として扱われる。
 * 組み立て直した文字列と突き合わせればどちらも同じ判定で弾ける
 * （サーバー間参照用APIの入力検査。docs/internal-api.md）。
 */
export function isRealDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = parseDateKey(value);
  if (Number.isNaN(parsed.getTime())) return false;

  return toDateKey(parsed) === value;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** 日付キーどうしの日数差（endKey − startKey）。UTC正午で扱い、タイムゾーンによる日付ずれを避ける。 */
export function dateKeyDiffDays(startKey: string, endKey: string): number {
  return Math.round((parseDateKey(endKey).getTime() - parseDateKey(startKey).getTime()) / 86_400_000);
}

/**
 * 基準日を含む週の開始曜日（weekStartsOn: 0=日曜）の日へそろえる。
 * 週表示（7日）の先頭列を、今日ではなく設定した週の開始曜日にするために使う（issue #1498）。
 */
export function alignToWeekStart(date: Date, weekStartsOn: number): Date {
  const offset = (date.getUTCDay() - weekStartsOn + 7) % 7;
  return addDays(date, -offset);
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/** 表示するカレンダーの日付を並べる。月表示は週の区切りに合わせて6週分を返す。 */
export function getVisibleDays(
  view: CalendarView,
  anchor: Date,
  weekStartsOn: number,
): { days: string[]; weeks: string[][] } {
  if (view !== "month") {
    const length = view === "day1" ? 1 : view === "day3" ? 3 : 7;
    const days = Array.from({ length }, (_, i) => toDateKey(addDays(anchor, i)));
    return { days, weeks: [days] };
  }

  const firstOfMonth = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12),
  );
  const offset = (firstOfMonth.getUTCDay() - weekStartsOn + 7) % 7;
  const gridStart = addDays(firstOfMonth, -offset);

  // 月によって5週で収まる場合と6週必要な場合があるが、週数が変わると行の高さが揺れるため
  // 常に6週で固定する。
  const weeks: string[][] = [];
  for (let week = 0; week < 6; week += 1) {
    weeks.push(Array.from({ length: 7 }, (_, i) => toDateKey(addDays(gridStart, week * 7 + i))));
  }

  return { days: weeks.flat(), weeks };
}

/**
 * 外部APIへ渡す取得期間。表示端の日をローカル時刻で解釈したときに欠けないよう、
 * 前後1日ずつ余裕を持たせる。
 */
export function getFetchRange(days: string[]): { timeMin: string; timeMax: string } {
  const first = new Date(`${days[0]}T00:00:00Z`);
  const last = new Date(`${days[days.length - 1]}T00:00:00Z`);

  return {
    timeMin: addDays(first, -1).toISOString(),
    timeMax: addDays(last, 2).toISOString(),
  };
}

export function shiftAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  if (view === "month") return addMonths(anchor, direction);
  const step = view === "day1" ? 1 : view === "day3" ? 3 : 7;
  return addDays(anchor, step * direction);
}

/**
 * 日表示（1日・3日・週）の取得期間。表示中の期間だけでなく、前後1期間ぶんも含める。
 *
 * 左右スワイプは指の動きに追従して隣の期間を見せるため、まだ表示していない日の予定が
 * 手元に無いと、動かした先が空欄のまま出てしまう。外部APIへの往復は1回のままなので、
 * 期間を広げる代わりに滑らかさを得る。
 */
export function getSwipeFetchRange(
  view: CalendarView,
  anchor: Date,
  weekStartsOn: number,
): { timeMin: string; timeMax: string } {
  const previous = getVisibleDays(view, shiftAnchor(view, anchor, -1), weekStartsOn).days;
  const next = getVisibleDays(view, shiftAnchor(view, anchor, 1), weekStartsOn).days;

  return getFetchRange([previous[0], next[next.length - 1]]);
}

// --- 月表示で保持する範囲 ---
//
// 月表示は前後の月まで地続きに並べる。移動のたびに全部を取り直すと、押すたびに外部APIへの
// 往復が発生して待たされるため、この窓のぶんをクライアントで保持し、窓から外れた月だけを
// 取得・破棄する（docs/spec.md §20 の自動更新間隔で鮮度を保つ）。

/** 見ている月の前後、いくつの月を保持するか。 */
export const MONTHS_AROUND = 3;

/**
 * 月表示でスクロールできる範囲。保持する窓（MONTHS_AROUND）よりずっと広く取る。
 *
 * 窓を張り直すと週の並びの長さが変わり、その上にあった週の位置も動くため、見ていた場所へ
 * scrollTop を書き戻す必要が出る。書き戻しは指でなぞっている最中や惰性で流れている最中には
 * 効かない（スクロール位置はブラウザ側が持っており、代入が上書きされる）ため、書き戻しが
 * そもそも要らない形にする。窓の外側をあらかじめ余白として確保しておけば、窓を張り直しても
 * 各週の位置は動かず、スクロールの最中でも安全に張り直せる。
 *
 * 前後20年ぶん。指でここまで動かすには百回以上の操作が要るため、実際には端に当たらない。
 */
export const VIRTUAL_MONTHS_AROUND = 240;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** YYYY-MM を、その月の1日（UTC正午）として扱う。 */
export function parseMonthKey(monthKey: string): Date {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return new Date(Date.UTC(year, month - 1, 1, 12));
}

export function toMonthKey(date: Date): string {
  return toDateKey(date).slice(0, 7);
}

/** YYYY-MM を月単位でずらす。 */
export function shiftMonthKey(monthKey: string, delta: number): string {
  return toMonthKey(addMonths(parseMonthKey(monthKey), delta));
}

/** 何ヶ月離れているか（符号つき）。 */
export function monthDistance(from: string, to: string): number {
  const years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  return years * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
}

/**
 * 週の並びが触れる月すべて。古い順に並ぶ。
 *
 * 端の週は前後の月にかかる（月初の週は前月の日を含む）。中心から前後何ヶ月、と数えて
 * しまうとその端の日のデータが範囲から漏れ、画面に出ているのに空欄になる。
 */
export function monthsOfWeeks(weeks: string[][]): string[] {
  const months = new Set<string>();

  for (const week of weeks) {
    for (const dateKey of week) months.add(dateKey.slice(0, 7));
  }

  return [...months].sort();
}

/** 月の集合を、外部APIへ渡す取得期間に変換する。 */
export function getMonthsFetchRange(months: string[]): { timeMin: string; timeMax: string } {
  const sorted = [...months].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  // 月末は「翌月の0日」で求める。
  const lastDay = toDateKey(
    new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0, 12)),
  );

  return getFetchRange([`${first}-01`, lastDay]);
}

/**
 * 月表示を上下に連続スクロールさせるための週の並び。
 * 月ごとに切り替えるのではなく、前後の月まで地続きに並べて途切れなく読めるようにする。
 */
export function getContinuousMonthWeeks(
  anchor: Date,
  weekStartsOn: number,
  monthsAround = MONTHS_AROUND,
): { weeks: string[][]; days: string[] } {
  const { first, weekCount } = continuousMonthRange(anchor, weekStartsOn, monthsAround);

  const weeks = Array.from({ length: weekCount }, (_, week) =>
    Array.from({ length: 7 }, (_, i) => toDateKey(addDays(first, week * 7 + i))),
  );

  return { weeks, days: weeks.flat() };
}

/**
 * 週の並びの外枠だけ。日付は作らず、先頭週と週数だけを返す。
 *
 * スクロールできる範囲（VIRTUAL_MONTHS_AROUND）は年単位の長さになるため、
 * 実際に描く窓の外側まで日付を並べるとその都度何千個もの文字列を作ることになる。
 */
export function getContinuousMonthSpan(
  anchor: Date,
  weekStartsOn: number,
  monthsAround = MONTHS_AROUND,
): { firstWeekKey: string; weekCount: number } {
  const { first, weekCount } = continuousMonthRange(anchor, weekStartsOn, monthsAround);
  return { firstWeekKey: toDateKey(first), weekCount };
}

/** 週の先頭日どうしが何週離れているか（符号つき）。 */
export function weeksBetween(fromWeekKey: string, toWeekKey: string): number {
  return Math.round(
    (parseDateKey(toWeekKey).getTime() - parseDateKey(fromWeekKey).getTime()) / WEEK_MS,
  );
}

function continuousMonthRange(
  anchor: Date,
  weekStartsOn: number,
  monthsAround: number,
): { first: Date; weekCount: number } {
  const firstMonth = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - monthsAround, 1, 12),
  );
  // 月末は「翌月の0日」で求める。
  const lastMonthEnd = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + monthsAround + 1, 0, 12),
  );

  const offset = (firstMonth.getUTCDay() - weekStartsOn + 7) % 7;
  const first = addDays(firstMonth, -offset);

  return {
    first,
    weekCount: Math.floor((lastMonthEnd.getTime() - first.getTime()) / WEEK_MS) + 1,
  };
}

/** その週がどの月に属するとみなすか。週の中日（4日目）の月を採る。 */
export function weekMonthKey(week: string[]): string {
  return week[3].slice(0, 7);
}
