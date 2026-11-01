import { isAutoOffDay } from "@/lib/work-days";
import {
  annualLeaveDays,
  annualLeaveHours,
  formatDays,
  formatLeaveHours,
  type WorkRecordItem,
} from "@/types/work";

/**
 * 年休の取得状況を年度で数える（docs/spec.md §34）。
 *
 * 画面から切り離した純粋な関数として置く。日付は `YYYY-MM-DD` の文字列だけで扱い、実行環境の
 * ローカル時刻には依存させない（サーバーはUTC・ブラウザはJSTで動くため、`Date` のローカル
 * メソッドを使うと同じ年度が両者で違う期間になり、ハイドレーションが一致しない）。
 */

/** YYYY-MM-DD 同士を安全に足し引きするための、UTC固定の日付づくり。 */
function dateKeyOf(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10);
}

/** 開始日から終了日までの日数（両端を含む）。時刻を持たないためUTCで数えて構わない。 */
export function daysBetween(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  return Math.floor((to - from) / 86_400_000) + 1;
}

/** 1日進めた YYYY-MM-DD。 */
function nextDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** 年度の開始月として受け付ける値か（1〜12）。壊れた値は既定の4月として扱う。 */
export const DEFAULT_FISCAL_YEAR_START_MONTH = 4;

export function normalizeStartMonth(month: number | null | undefined): number {
  if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12) {
    return DEFAULT_FISCAL_YEAR_START_MONTH;
  }
  return month;
}

/**
 * その日が属する年度（＝年度の開始年）。
 *
 * 開始月が4月なら 2026-03-31 は 2025年度、2026-04-01 は 2026年度。開始月が1月なら暦年と同じ。
 */
export function fiscalYearOf(dateKey: string, startMonth: number): number {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  return month >= normalizeStartMonth(startMonth) ? year : year - 1;
}

/** 年度の期間。終わりは翌年度の初日の1日前（月ごとの日数を持たずに求められる）。 */
export function fiscalYearRange(
  fiscalYear: number,
  startMonth: number,
): { from: string; to: string } {
  const month = normalizeStartMonth(startMonth);
  const from = dateKeyOf(fiscalYear, month, 1);
  // 翌年度の初日の前日。うるう年もここで自動的に吸収される。
  const nextStart = new Date(Date.UTC(fiscalYear + 1, month - 1, 1));
  nextStart.setUTCDate(nextStart.getUTCDate() - 1);
  return { from, to: nextStart.toISOString().slice(0, 10) };
}

/**
 * 年度の見出し。開始月が1月のときは暦年そのものなので「2026年」と出す
 * （「2026年度（2026/1/1 – 2026/12/31）」は、年度と暦年が同じであることが読み取りにくい）。
 */
export function fiscalYearLabel(fiscalYear: number, startMonth: number): string {
  return normalizeStartMonth(startMonth) === 1 ? `${fiscalYear}年` : `${fiscalYear}年度`;
}

/** 年度に含まれる月（`YYYY-MM`）を開始月から12個。月ごとの内訳の枠になる。 */
export function fiscalYearMonths(fiscalYear: number, startMonth: number): string[] {
  const month = normalizeStartMonth(startMonth);
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(fiscalYear, month - 1 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/**
 * その日が年休を消費するか（計画レビューG1の指摘）。
 *
 * 全休の年休は**期間で1件**として登録できる（docs/spec.md §34）。8/12(水)–8/16(日) を暦日で
 * 5日と数えると、実際に減る3日と食い違い、この画面の主役である残り日数・消化ペース・年度末の
 * 見込みがすべてその分ずれる。期間の中の土日祝はもともと働かない日なので、年休は消費しない。
 *
 * 一方で**単日の登録はその日を名指しで年休にしたもの**なので、土日祝でもそのまま数える。
 * 土曜に出社する人が土曜の年休を入れることはありうる。ここで落とすと、一覧の行に「1日」と
 * 出ているのに合計へ入らない、という食い違いになる。
 *
 * 「働く日かどうか」の判定は勤務の画面（登録が無い日を「休み」と出す）と同じ `isAutoOffDay()`。
 * 画面に「休み」と出ている日が年休の日数には数えられている、という状態を作らないため。
 */
function consumesLeave(record: WorkRecordItem, dateKey: string): boolean {
  if (record.startDate === record.endDate) return true;
  return !isAutoOffDay(dateKey);
}

/**
 * 年休の量。**日と時間を混ぜずに持つ**（issue #537）。
 *
 * 全休・半休は日、時間休は時間。1つの数へ丸めると、所定労働時間が7時間45分の職場では
 * 0.5日が3時間52分30秒になり、時間へ足し込んだ時点で割り切れない数字が画面に並ぶ。
 * 分けて持てば、どちらの単位も入力したままの形で読める。
 */
export type LeaveAmount = {
  /** 全休・半休ぶんの日数（0.5刻み）。 */
  days: number;
  /** 時間休ぶんの時間数。 */
  hours: number;
};

export const EMPTY_LEAVE_AMOUNT: LeaveAmount = { days: 0, hours: 0 };

/** 帯・消化ペースの比率に使う、日へそろえた量。目盛りの上の位置を決めるためだけに使う。 */
export function leaveAmountInDays(amount: LeaveAmount, minutesPerDay: number): number {
  return amount.days + (amount.hours * 60) / minutesPerDay;
}

/** 量が入っているか。0のときは日だけを出し、いままでと同じ見え方にするための判定。 */
export function hasLeaveAmount(amount: LeaveAmount): boolean {
  return amount.days !== 0 || amount.hours !== 0;
}

export type AnnualLeaveMonth = {
  /** YYYY-MM */
  monthKey: string;
  taken: LeaveAmount;
  planned: LeaveAmount;
};

export type AnnualLeaveSummary = {
  /** 今日までに取った量（半休は0.5日、時間休は時間）。 */
  taken: LeaveAmount;
  /** 明日以降に入れてある量。 */
  planned: LeaveAmount;
  months: AnnualLeaveMonth[];
  /** 年度に重なる年休の記録。日付の新しい順（一覧はこの順で出す）。 */
  records: WorkRecordItem[];
};

/**
 * 年度ぶんの年休を数える。
 *
 * 数え方は勤務画面の月の集計（`Tally()`）と同じで、**日ごとに** `annualLeaveDays()` を足す。
 * 期間の全休（夏季休暇など）は1件でも日数ぶんになり、半休は0.5日、時間休は日数を持たず時間の
 * 側へ足される（issue #537）。記録の期間が年度からはみ出す場合は、年度の中に入っている日だけを
 * 数える（年度をまたぐ記録を丸ごと片方の年度へ入れると、両方の年度の合計が実際に休んだ日数と
 * 合わなくなる）。
 *
 * 今日より後の日を `planned` に分けるのは、まだ休んでいない日を「使った」として扱わないため。
 * 今日をまたぐ期間の記録は、前半を `taken`・後半を `planned` に振り分ける。
 */
export function summarizeAnnualLeave(
  records: WorkRecordItem[],
  range: { from: string; to: string },
  todayKey: string,
): AnnualLeaveSummary {
  const monthly = new Map<string, AnnualLeaveMonth>();
  const taken: LeaveAmount = { days: 0, hours: 0 };
  const planned: LeaveAmount = { days: 0, hours: 0 };

  for (const record of records) {
    if (!record.annualLeave) continue;
    // 時間休は日数を持たず、時間の側へ足す（issue #537）。
    const perDay = annualLeaveDays(record.annualLeave);
    const perDayHours = annualLeaveHours(record.annualLeave) ?? 0;
    // 年度の中に入っている日だけを数える。
    const start = record.startDate > range.from ? record.startDate : range.from;
    const end = record.endDate < range.to ? record.endDate : range.to;

    for (let dateKey = start; dateKey <= end; dateKey = nextDateKey(dateKey)) {
      if (!consumesLeave(record, dateKey)) continue;
      const monthKey = dateKey.slice(0, 7);
      const month: AnnualLeaveMonth = monthly.get(monthKey) ?? {
        monthKey,
        taken: { days: 0, hours: 0 },
        planned: { days: 0, hours: 0 },
      };
      const [total, bucket] =
        dateKey <= todayKey ? ([taken, month.taken] as const) : ([planned, month.planned] as const);
      total.days += perDay;
      total.hours += perDayHours;
      bucket.days += perDay;
      bucket.hours += perDayHours;
      monthly.set(monthKey, month);
    }
  }

  const startMonth = Number(range.from.slice(5, 7));
  const fiscalYear = Number(range.from.slice(0, 4));
  const months = fiscalYearMonths(fiscalYear, startMonth).map(
    (monthKey) =>
      monthly.get(monthKey) ?? {
        monthKey,
        taken: { days: 0, hours: 0 },
        planned: { days: 0, hours: 0 },
      },
  );

  return {
    taken,
    planned,
    months,
    records: [...records].sort((a, b) => b.startDate.localeCompare(a.startDate)),
  };
}

/**
 * 見込みを出すのに要る経過日数。
 *
 * 年度が始まったばかりだと、1件取っただけで「年度末に80日取得」のような数字になる。
 * 1か月ぶん経ってから出す。
 */
const PROJECTION_MIN_ELAPSED_DAYS = 30;

export type AnnualLeavePace = {
  /** 年度の日数（365 か 366）。 */
  totalRangeDays: number;
  /** 年度の初日から今日までの日数。年度が始まる前は0。 */
  elapsedDays: number;
  elapsedRatio: number;
  /** 経過ぶんに合わせるなら今日までに取っているはずの日数。 */
  expected: number;
  /** 取得済み − 想定。正なら早め、負ならゆっくり。 */
  diff: number;
  /** このペースのまま行った場合の年度末の取得日数。経過が短いうちは null。 */
  projectedTaken: number | null;
};

/**
 * 消化のペース。年度が始まっていない（経過0日）ときは null を返し、画面では区画ごと出さない。
 *
 * 「想定」は付与日数を年度の日数で割った直線のペース。年休の取りどきは実際には偏る（夏季・
 * 年末）ので、これは目標ではなく目安として出す。
 */
export function annualLeavePace({
  totalDays,
  taken,
  range,
  todayKey,
}: {
  /** 付与＋繰越の合計。 */
  totalDays: number;
  taken: number;
  range: { from: string; to: string };
  todayKey: string;
}): AnnualLeavePace | null {
  if (todayKey < range.from) return null;

  const totalRangeDays = daysBetween(range.from, range.to);
  const endKey = todayKey < range.to ? todayKey : range.to;
  const elapsedDays = daysBetween(range.from, endKey);
  const elapsedRatio = elapsedDays / totalRangeDays;
  const expected = totalDays * elapsedRatio;

  return {
    totalRangeDays,
    elapsedDays,
    elapsedRatio,
    expected,
    diff: taken - expected,
    projectedTaken:
      elapsedDays >= PROJECTION_MIN_ELAPSED_DAYS ? (taken / elapsedDays) * totalRangeDays : null,
  };
}

/**
 * 一覧の1件がどれだけか（日と時間）。
 *
 * 年度の外へはみ出したぶんと、期間の中の土日祝は数えない（`summarizeAnnualLeave()` と同じ
 * 数え方）。行の量と合計が食い違わないよう、判定を二重に持たずここも1日ずつ見る。
 */
export function recordAmountInRange(
  record: WorkRecordItem,
  range: { from: string; to: string },
): LeaveAmount {
  if (!record.annualLeave) return { ...EMPTY_LEAVE_AMOUNT };
  const start = record.startDate > range.from ? record.startDate : range.from;
  const end = record.endDate < range.to ? record.endDate : range.to;
  if (start > end) return { ...EMPTY_LEAVE_AMOUNT };

  const perDay = annualLeaveDays(record.annualLeave);
  const perDayHours = annualLeaveHours(record.annualLeave) ?? 0;
  const amount: LeaveAmount = { days: 0, hours: 0 };
  for (let dateKey = start; dateKey <= end; dateKey = nextDateKey(dateKey)) {
    if (!consumesLeave(record, dateKey)) continue;
    amount.days += perDay;
    amount.hours += perDayHours;
  }
  return amount;
}

/**
 * その記録が今日より後だけの予定か。一覧を「予定」と「取得済み」に分けるのに使う。
 *
 * 今日にかかっている期間の記録は「取得済み」に入れる（もう休み始めているため）。日数の内訳では
 * 今日以前と以後に分かれるが、一覧の行はひとつしか置けないので開始日で決める。
 */
export function isPlannedRecord(record: WorkRecordItem, todayKey: string): boolean {
  return record.startDate > todayKey;
}

/**
 * 付与＋繰越から、取得済みと予定を引いた残り（issue #1484）。
 *
 * 年休画面とヘッダーのチップが同じ数字を出すため、ここに1つだけ置く。日は日どうしで引き、
 * 時間休のぶんは時間のまま別に引く（issue #537）。日数そのものがマイナス（付与より多く
 * 取っている）なら符号を反転して「超過」の量として返す。日数は残っていて時間ぶんだけ超える
 * 状態は、残りと同じ形（`{ days: 0.5, hours: -5 }`）のまま返す。
 */
export function remainingLeave(
  totalDays: number,
  taken: LeaveAmount,
  planned: LeaveAmount,
): LeaveAmount {
  const usedDays = taken.days + planned.days;
  const usedHours = taken.hours + planned.hours;
  return totalDays - usedDays < 0
    ? { days: usedDays - totalDays, hours: usedHours }
    : { days: totalDays - usedDays, hours: -usedHours };
}

/** 小数の丸め。0.5日単位で持っている値と混ぜても、表示だけが細かくならないようにする。 */
export function roundLeave(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 年休の量を「日 ＋ 時間」の形で出す（issue #537）。
 *
 * 全休・半休は日、時間休は時間で、1つの数へ丸めない。残りのように引き算で出す量では
 * 時間が負になるので、そのときは「－」でつなぐ。時間休を1件も入れていない年度は日だけが出る。
 */
export function formatLeaveAmount(amount: LeaveAmount): string {
  const days = roundLeave(amount.days);
  const hours = roundLeave(amount.hours);
  if (hours === 0) return `${formatDays(days)}日`;
  // 時間だけの量は「0日 ＋ 3時間」ではなく時間だけを出す。引き算で出す残りは 0 日でも
  // 「0日 － 3時間」と出す（何も残っていないのではなく足りない）。
  if (days === 0 && hours > 0) return formatLeaveHours(hours);
  return `${formatDays(days)}日 ${hours < 0 ? "－" : "＋"} ${formatLeaveHours(Math.abs(hours))}`;
}
