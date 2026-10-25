"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Settings2 } from "lucide-react";

import { SettingsShell } from "@/components/settings/settings-shell";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  annualLeavePace,
  fiscalYearLabel,
  fiscalYearRange,
  isPlannedRecord,
  leaveAmountInDays,
  recordAmountInRange,
  summarizeAnnualLeave,
  type AnnualLeaveMonth,
  type LeaveAmount,
} from "@/lib/annual-leave";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WORK_MINUTES_PER_DAY,
  formatDays,
  formatLeaveHours,
  type WorkRecordItem,
} from "@/types/work";

import { AnnualLeaveGrantDialog } from "./annual-leave-grant-dialog";

/**
 * 年度ごとの年休の取得状況（docs/spec.md §34）。
 *
 * 見るのは3つ。**あと何日使えるか**（付与＋繰越から取得済みと予定を引いたもの）、**いまの
 * ペース**（年度の経過に対して取れているか）、**どこに入れてあるか**（月ごとと一覧）。
 * 登録・修正はこの画面では行わず、一覧の行から勤務画面（`/work`）へ渡す。入力の入口を
 * 2か所に増やさないため。
 */
export function AnnualLeaveScreen({
  fiscalYear,
  startMonth,
  todayKey,
  records,
  grantedDays,
  carriedOverDays,
  workMinutesPerDay = DEFAULT_WORK_MINUTES_PER_DAY,
  loadError = null,
}: {
  /** 年度の開始年。4月開始なら 2026 = 2026-04-01〜2027-03-31。 */
  fiscalYear: number;
  startMonth: number;
  todayKey: string;
  /** 年度に重なる年休の記録。 */
  records: WorkRecordItem[];
  /** その年度の付与日数。まだ入れていない年度は null。 */
  grantedDays: number | null;
  carriedOverDays: number;
  /** 1日の所定労働時間（分）。帯と消化ペースの比率だけに使う（issue #537）。 */
  workMinutesPerDay?: number;
  /** Notionから読めなかったときの理由。画面は開いたまま、何が起きたかだけを伝える。 */
  loadError?: string | null;
}) {
  useReconnectRefresh();
  // オフラインでもこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  useWarmOfflinePage("/work/leave");

  const [editing, setEditing] = useState(false);

  const range = useMemo(() => fiscalYearRange(fiscalYear, startMonth), [fiscalYear, startMonth]);
  const summary = useMemo(
    () => summarizeAnnualLeave(records, range, todayKey),
    [records, range, todayKey],
  );

  const total = grantedDays === null ? null : grantedDays + carriedOverDays;
  // 帯・消化ペース・超過かどうかの判定は、日へそろえた合計で一本化する（計画レビューG1の指摘）。
  // 日数だけで超過を決めると、合計20日・全休20日＋3時間休1回の年度が「0日 － 3時間 残り」と
  // 出るのに帯には超過の線が立ち、同じ画面の中で食い違う。
  const takenInDays = leaveAmountInDays(summary.taken, workMinutesPerDay);
  const plannedInDays = leaveAmountInDays(summary.planned, workMinutesPerDay);
  const over = total !== null && takenInDays + plannedInDays > total;

  // 残りは日と時間を混ぜずに出す（issue #537）。日は日どうしで引き、時間休のぶんは
  // 「－ 3時間」として並べる。1つの数へ丸めると、所定7時間45分の職場では0.5日が
  // 3時間52分30秒になり、割り切れない数字が画面に並ぶ。
  const usedDays = summary.taken.days + summary.planned.days;
  const usedHours = summary.taken.hours + summary.planned.hours;
  // 日数そのものがマイナス（付与より多く取っている）なら符号を反転して「4.5日 ＋ 3時間 超過」と
  // 出す。日数は残っていて時間ぶんだけ超えている状態（「0.5日 － 5時間」）は、残りと同じ形の
  // ままで「超過」と呼ぶ。ここで日へ丸めると、0.5日＝3時間52分30秒の端数が数字に出る。
  // 付与日数を入れていない年度（`total === null`）ではこの区画ごと出さないため、0で持つ。
  const remaining: LeaveAmount =
    total === null
      ? { days: 0, hours: 0 }
      : total - usedDays < 0
        ? { days: usedDays - total, hours: usedHours }
        : { days: total - usedDays, hours: -usedHours };
  const pace =
    total === null
      ? null
      : annualLeavePace({ totalDays: total, taken: takenInDays, range, todayKey });

  const label = fiscalYearLabel(fiscalYear, startMonth);
  // 予定は近い順（次に来るものが先）、取得済みは新しい順。同じ一覧でも、探している向きが逆。
  const planned = summary.records
    .filter((record) => isPlannedRecord(record, todayKey))
    .reverse();
  const taken = summary.records.filter((record) => !isPlannedRecord(record, todayKey));

  return (
    // 広い画面ではカードを2列に並べる（issue #636）。残り・消化ペースを1段目、月ごと・一覧を
    // 2段目に置き、年度の数字をスクロールせずに見比べられるようにする。
    <SettingsShell title="年休" wide columns>
      {loadError && (
        <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container @3xl/main:col-span-2">
          {loadError}
        </p>
      )}

      {/* 年度切替。勤務画面の月切替（issue #510）と同じ形にする。右端は付与日数の設定。 */}
      <div className="flex items-center justify-between gap-1 @3xl/main:col-span-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/work/leave?year=${fiscalYear - 1}`} aria-label="前の年度">
            <ChevronLeft className="size-4" />
          </Link>
        </Button>
        <div className="flex flex-col items-center leading-tight">
          <span className="type-title-medium tabular-nums">{label}</span>
          <span className="type-label-small tabular-nums text-on-surface-variant">
            {shortDate(range.from)} – {shortDate(range.to)}
          </span>
        </div>
        <div className="flex items-center">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/work/leave?year=${fiscalYear + 1}`} aria-label="次の年度">
              <ChevronRight className="size-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="付与日数の設定"
            onClick={() => setEditing(true)}
          >
            <Settings2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* 使える日数と、そのうちどこまで使ったか。 */}
      {total === null || total <= 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="type-body-medium">
              {label}の付与日数がまだ入っていません。入れると、残り日数と消化ペースが出ます。
            </p>
            <Button onClick={() => setEditing(true)}>付与日数を入れる</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "type-headline-small font-bold tabular-nums",
                  over && "text-error",
                )}
              >
                {formatLeaveAmount(remaining)}
              </span>
              <span className={cn("type-title-medium", over && "text-error")}>
                {over ? "超過" : "残り"}
              </span>
              <span className="type-body-small ml-auto tabular-nums text-on-surface-variant">
                うち予定 {formatLeaveAmount(summary.planned)}
              </span>
            </div>

            <Meter
              total={total}
              taken={takenInDays}
              planned={plannedInDays}
              label={
                over
                  ? `合計${formatDays(total)}日に対して、取得済み${formatLeaveAmount(summary.taken)}・予定${formatLeaveAmount(summary.planned)}で${formatLeaveAmount(remaining)}の超過`
                  : `合計${formatDays(total)}日のうち、取得済み${formatLeaveAmount(summary.taken)}・予定${formatLeaveAmount(summary.planned)}・残り${formatLeaveAmount(remaining)}`
              }
            />

            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <LegendItem
                className="size-2.5 bg-tertiary"
                amount={summary.taken}
                name="取得済み"
              />
              <LegendItem
                className="slot-leave-planned size-2.5"
                amount={summary.planned}
                name="予定"
              />
              {over ? (
                // 帯の中で合計の位置に立てた線と同じ印にする（塗りの区画は無いため）。
                <LegendItem
                  className="h-2.5 w-0.5 bg-error"
                  amount={remaining}
                  name="超過"
                />
              ) : (
                <LegendItem
                  className="size-2.5 bg-surface-container-highest"
                  amount={remaining}
                  name="残り"
                />
              )}
            </div>

            <div className="type-body-small flex items-baseline justify-between gap-2 border-t border-outline-variant pt-2.5 text-on-surface-variant">
              <span className="tabular-nums">
                付与 <b className="text-on-surface">{formatDays(grantedDays ?? 0)}</b>
                {carriedOverDays > 0 && (
                  <>
                    {" ＋ 繰越 "}
                    <b className="text-on-surface">{formatDays(carriedOverDays)}</b>
                  </>
                )}
              </span>
              <span className="tabular-nums">
                合計 <b className="text-on-surface">{formatDays(total)}</b> 日
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 消化ペース。年度が始まる前は数える経過が無いため、区画ごと出さない。 */}
      {pace && total !== null && total > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="type-title-small text-on-surface-variant">消化ペース</h2>

            {/* 差が半日に満たないときに「0.2日 早め」と出しても、押す手が変わるほどの差ではない。
                半休1回ぶん（0.5日）を境に、数字を出すかどうかを分ける。 */}
            {Math.abs(round(pace.diff)) < 0.5 ? (
              <div className="type-title-large font-bold">想定どおりのペース</div>
            ) : (
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "type-title-large font-bold tabular-nums",
                    pace.diff < 0 ? "text-tertiary" : "text-travel",
                  )}
                >
                  {formatDays(Math.abs(round(pace.diff)))}日
                </span>
                <span className="type-body-medium">{pace.diff < 0 ? "ゆっくり" : "早め"}</span>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <PaceRow name="年度の経過" ratio={pace.elapsedRatio} className="bg-outline" />
              <PaceRow name="取得" ratio={takenInDays / total} className="bg-tertiary" />
            </div>

            <p className="type-body-small text-on-surface-variant">
              経過ぶんに合わせるなら今日までに{" "}
              <b className="tabular-nums text-on-surface">{formatDays(round(pace.expected))}</b> 日。
              {/* 年度末の見込みは、実績のペースをそのまま年度末まで延ばしたもの。使い切る側へ
                  振り切っている年度で「0日残ります」とだけ出すと、いつ足りなくなるのかが伝わらない。 */}
              {pace.projectedTaken !== null &&
                (pace.projectedTaken > total ? (
                  <>このままのペースだと年度末を待たずに使い切ります。</>
                ) : (
                  <>
                    このままのペースだと年度末に{" "}
                    <b className="tabular-nums text-on-surface">
                      {formatDays(round(total - pace.projectedTaken))}
                    </b>{" "}
                    日残ります。
                  </>
                ))}
              {/* 入れてある予定は、ペースの見込みとは別に確定している。両方を1文に混ぜない。 */}
              {plannedInDays > 0 &&
                (over ? (
                  <>
                    入れてある予定まで含めると{" "}
                    <b className="tabular-nums text-error">
                      {formatLeaveAmount(remaining)}
                    </b>{" "}
                    ぶん超えます。
                  </>
                ) : (
                  <>
                    入れてある予定まで含めると残りは{" "}
                    <b className="tabular-nums text-on-surface">
                      {formatLeaveAmount(remaining)}
                    </b>{" "}
                    です。
                  </>
                ))}
            </p>
          </CardContent>
        </Card>
      )}

      {/* 月ごとの取得。どの月に寄っているかを見るためのもの。 */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="type-title-small text-on-surface-variant">月ごとの取得</h2>
          <MonthlyBars
            months={summary.months}
            todayMonth={todayKey.slice(0, 7)}
            minutesPerDay={workMinutesPerDay}
          />
        </CardContent>
      </Card>

      {/* 年休の一覧。押すとその月の勤務画面へ移る（入力の入口を2か所に増やさない）。 */}
      <Card>
        <CardContent className="flex flex-col gap-2">
          <h2 className="type-title-small text-on-surface-variant">{label}の年休</h2>

          {summary.records.length === 0 ? (
            <p className="type-body-small text-on-surface-variant">
              {label}の年休はまだありません。
              <Link href="/work" className="ml-1 underline">
                勤務
              </Link>
              の画面から登録できます。
            </p>
          ) : (
            <>
              <RecordGroup name="予定" records={planned} range={range} amount={summary.planned} />
              <RecordGroup
                name="取得済み"
                records={taken}
                range={range}
                amount={summary.taken}
              />
            </>
          )}
        </CardContent>
      </Card>

      {editing && (
        <AnnualLeaveGrantDialog
          fiscalYear={fiscalYear}
          startMonth={startMonth}
          grantedDays={grantedDays}
          carriedOverDays={carriedOverDays}
          workMinutesPerDay={workMinutesPerDay}
          onClose={() => setEditing(false)}
        />
      )}
    </SettingsShell>
  );
}

/**
 * 取得済み・予定・残りの積み上げ。
 *
 * 予定を取得済みと同じ塗りにしないのは、まだ休んでいない日だから。保存前の枠に縞を使う
 * 語彙（`slot-range-stripes`）をそのまま借り、色ではなく地の違いでも分かるようにする。
 */
function Meter({
  total,
  taken,
  planned,
  label,
}: {
  total: number;
  /** 帯の幅を決める、日へそろえた量（時間休のぶんも含む）。 */
  taken: number;
  planned: number;
  /** 読み上げ。幅は日へそろえるが、読み上げには画面に出ている「日 ＋ 時間」をそのまま渡す。 */
  label: string;
}) {
  const used = taken + planned;
  // 付与より多く取っている年度では、帯の目盛りを使ったぶんまで伸ばす。合計で切ると、
  // 超えているぶんが帯からはみ出して幅の比が読めなくなる。
  const scale = Math.max(total, used);
  const pct = (value: number) => `${Math.max((value / scale) * 100, 0)}%`;
  const leftDays = Math.max(total - used, 0);

  return (
    <div className="relative flex h-3.5 gap-0.5" role="img" aria-label={label}>
      {taken > 0 && <span className="rounded-sm bg-tertiary" style={{ width: pct(taken) }} />}
      {planned > 0 && (
        <span className="slot-leave-planned rounded-sm" style={{ width: pct(planned) }} />
      )}
      {leftDays > 0 && (
        <span
          className="rounded-sm bg-surface-container-highest"
          style={{ width: pct(leftDays) }}
        />
      )}
      {/* 使えるぶんがどこで終わるか。超えている年度では、この線から右が超過ぶんになる。 */}
      {used > total && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 rounded-full bg-error"
          style={{ left: pct(total) }}
        />
      )}
    </div>
  );
}

function LegendItem({
  className,
  amount,
  name,
}: {
  className: string;
  amount: LeaveAmount;
  name: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <i className={cn("rounded-sm", className)} aria-hidden="true" />
      <b className="type-body-medium tabular-nums">{formatLeaveAmount(amount)}</b>
      <span className="type-body-small text-on-surface-variant">{name}</span>
    </span>
  );
}

/** 経過と取得を同じ目盛りの上に並べる。上下で見比べれば、差が数字を読まなくても分かる。 */
function PaceRow({
  name,
  ratio,
  className,
}: {
  name: string;
  ratio: number;
  className: string;
}) {
  const pct = Math.max(Math.min(ratio * 100, 100), 0);
  return (
    <div className="flex items-center gap-2">
      <span className="type-body-small w-20 shrink-0 text-on-surface-variant">{name}</span>
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-container-highest">
        <span className={cn("block h-full rounded-full", className)} style={{ width: `${pct}%` }} />
      </span>
      <span className="type-label-medium w-10 shrink-0 text-right tabular-nums">
        {Math.round(pct)}%
      </span>
    </div>
  );
}

/**
 * 月ごとの棒。目盛りはその年度でいちばん多い月に合わせる（最低5日ぶん）。
 *
 * 高さは日へそろえて積むが、ラベルは日と時間を2行に分けて出す（issue #537）。1列に残るのは
 * 27px程度で「1日3時間」は1行に入らない。高さは2行ぶんで固定し、時間だけの月・日だけの月でも
 * グラフの高さが動かないようにする。
 */
function MonthlyBars({
  months,
  todayMonth,
  minutesPerDay,
}: {
  months: AnnualLeaveMonth[];
  todayMonth: string;
  minutesPerDay: number;
}) {
  const sumOf = (month: AnnualLeaveMonth): LeaveAmount => ({
    days: month.taken.days + month.planned.days,
    hours: month.taken.hours + month.planned.hours,
  });
  const inDays = (amount: LeaveAmount) => leaveAmountInDays(amount, minutesPerDay);
  const max = Math.max(5, ...months.map((month) => inDays(sumOf(month))));

  return (
    <div className="grid grid-cols-12 items-end gap-[3px]">
      {months.map((month) => {
        const sum = sumOf(month);
        const takenDays = inDays(month.taken);
        const plannedDays = inDays(month.planned);
        return (
          <div key={month.monthKey} className="flex min-w-0 flex-col items-center gap-[3px]">
            <span className="type-label-small flex h-8 flex-col items-center leading-4 tabular-nums">
              {sum.days > 0 && <span>{formatDays(sum.days)}日</span>}
              {sum.hours > 0 && <span>{formatLeaveHours(sum.hours)}</span>}
            </span>
            <span className="flex h-16 w-full flex-col justify-end gap-0.5">
              {plannedDays > 0 && (
                <span
                  className="slot-leave-planned block w-full rounded-sm"
                  style={{ height: `${(plannedDays / max) * 100}%` }}
                />
              )}
              {takenDays > 0 && (
                <span
                  className="block w-full rounded-sm bg-tertiary"
                  style={{ height: `${(takenDays / max) * 100}%` }}
                />
              )}
            </span>
            <span
              className={cn(
                "type-label-small tabular-nums",
                month.monthKey === todayMonth ? "text-on-surface" : "text-on-surface-variant",
              )}
            >
              {Number(month.monthKey.slice(5, 7))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 予定・取得済みそれぞれの一覧。0件の区分は見出しごと出さない。 */
function RecordGroup({
  name,
  records,
  range,
  amount,
}: {
  name: string;
  records: WorkRecordItem[];
  range: { from: string; to: string };
  amount: LeaveAmount;
}) {
  if (records.length === 0) return null;

  return (
    <div className="flex flex-col">
      <div className="type-label-medium flex items-baseline gap-2 pt-2 text-on-surface-variant">
        <span>{name}</span>
        <span className="ml-auto tabular-nums">
          {records.length}件 / {formatLeaveAmount(amount)}
        </span>
      </div>

      {records.map((record) => (
        <Link
          key={record.id}
          href={`/work?month=${record.startDate.slice(0, 7)}`}
          className="flex items-center gap-2.5 border-b border-outline-variant py-2.5 last:border-b-0 hover:bg-on-surface/8"
        >
          <span className="type-body-small w-24 shrink-0 tabular-nums text-on-surface-variant">
            {spanLabel(record)}
          </span>
          <span className="type-body-medium min-w-0 flex-1 truncate font-medium text-tertiary">
            年休（{record.annualLeave}）
            {record.place && `・${record.place}`}
          </span>
          <span className="type-body-small shrink-0 tabular-nums text-on-surface-variant">
            {formatLeaveAmount(recordAmountInRange(record, range))}
          </span>
          {/* 未申請はこの画面でも印だけ出す。片付けるのは勤務画面（押した先）。 */}
          {!record.preApplied && (
            <span className="type-label-small shrink-0 rounded-sm bg-error-container px-2 py-0.5 text-on-error-container">
              未申請
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

// --- 表示のための小さな関数 ---

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 年休の量を「日 ＋ 時間」の形で出す（issue #537）。
 *
 * 全休・半休は日、時間休は時間で、1つの数へ丸めない。所定7時間45分の職場では0.5日が
 * 3時間52分30秒になり、足し合わせた時点で割り切れない数字が並ぶため。残りのように引き算で
 * 出す量では時間が負になるので、そのときは「－」でつなぐ。
 *
 * 時間休を1件も入れていない年度は日だけが出る（これまでの見え方と1文字も変わらない）。
 */
function formatLeaveAmount(amount: LeaveAmount): string {
  const days = round(amount.days);
  const hours = round(amount.hours);
  if (hours === 0) return `${formatDays(days)}日`;
  // 時間だけの量（時間休1件の行・時間休しか無い月）は「0日 ＋ 3時間」ではなく時間だけを出す。
  // 引き算で出す残りは 0 日でも「0日 － 3時間」と出す（何も残っていないのではなく足りない）。
  if (days === 0 && hours > 0) return formatLeaveHours(hours);
  return `${formatDays(days)}日 ${hours < 0 ? "－" : "＋"} ${formatLeaveHours(Math.abs(hours))}`;
}

/** 小数の丸め。0.5日単位で持っている値と混ぜても、表示だけが細かくならないようにする。 */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function shortDate(dateKey: string): string {
  return `${dateKey.slice(0, 4)}/${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;
}

/** 一覧の日付。単日は曜日まで、期間は開始と終了の日付だけ（曜日まで入れると折り返す）。 */
function spanLabel(record: WorkRecordItem): string {
  const short = (dateKey: string) =>
    `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;
  if (record.startDate !== record.endDate) {
    return `${short(record.startDate)} – ${short(record.endDate)}`;
  }
  const weekday = WEEKDAYS[new Date(`${record.startDate}T00:00:00Z`).getUTCDay()];
  return `${short(record.startDate)}(${weekday})`;
}
