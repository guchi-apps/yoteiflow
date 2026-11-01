"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { useApiResource } from "@/components/offline/use-api-resource";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  fiscalYearLabel,
  fiscalYearRange,
  formatLeaveAmount,
  isPlannedRecord,
  leaveAmountInDays,
  recordAmountInRange,
  remainingLeave,
  summarizeAnnualLeave,
} from "@/lib/annual-leave";
import { formatDays, type AnnualLeaveSummaryData } from "@/types/work";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * ヘッダー右上の年休の残り日数と、押すと開く取得状況（issue #1484）。
 *
 * 数字は年休画面（`/work/leave`）と同じ関数で求める。年休の列が無いDBでは取得が404になり、
 * チップごと出さない。付与日数をまだ入れていない年度は「未設定」と出す（残りは求められない）。
 * 詳細に出す記録は年度の全件のうち、次に来る予定と直近の取得済みだけ。全件は年休画面で見る。
 */
export function AnnualLeaveChip({
  disabled = false,
  reloadKey = 0,
}: {
  disabled?: boolean;
  /** 増えるたびに取り直す。年休の登録・付与日数の保存のあとに、月の一覧と数字が食い違わないように。 */
  reloadKey?: number;
}) {
  const resource = useApiResource<AnnualLeaveSummaryData>(
    "/api/work/leave-summary",
    "年休の取得状況を取得できませんでした。",
  );
  const [open, setOpen] = useState(false);
  const { reload } = resource;
  const lastKey = useRef(reloadKey);
  useEffect(() => {
    if (lastKey.current === reloadKey) return;
    lastKey.current = reloadKey;
    reload();
  }, [reloadKey, reload]);
  const data = resource.data;

  const view = useMemo(() => {
    if (!data) return null;
    const range = fiscalYearRange(data.fiscalYear, data.startMonth);
    const summary = summarizeAnnualLeave(data.records, range, data.todayKey);
    const total = data.grantedDays === null ? null : data.grantedDays + data.carriedOverDays;
    const takenInDays = leaveAmountInDays(summary.taken, data.workMinutesPerDay);
    const plannedInDays = leaveAmountInDays(summary.planned, data.workMinutesPerDay);
    const remaining = total === null ? null : remainingLeave(total, summary.taken, summary.planned);
    const over = total !== null && takenInDays + plannedInDays > total;
    const planned = summary.records
      .filter((record) => isPlannedRecord(record, data.todayKey))
      .reverse()
      .slice(0, 3);
    const taken = summary.records
      .filter((record) => !isPlannedRecord(record, data.todayKey))
      .slice(0, 3);
    return { range, summary, total, takenInDays, plannedInDays, remaining, over, planned, taken };
  }, [data]);

  // 取得できていない間（初回・年休の列が無いDB・失敗）は何も出さない。ヘッダーの幅を取らない。
  if (!data || !view) return null;

  const chipText =
    view.remaining === null
      ? "未設定"
      : view.over
        ? `超過 ${formatLeaveAmount(view.remaining)}`
        : formatLeaveAmount(view.remaining);

  return (
    <>
      <Button
        variant="ghost"
        className="h-10 shrink-0 gap-1.5 bg-primary-container px-3 text-on-primary-container hover:bg-primary-container md:h-9"
        aria-label={`年休の残り ${chipText}。取得状況を開く`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span className="type-label-small hidden opacity-80 sm:inline">年休</span>
        <span
          className={`type-label-large font-bold tabular-nums ${view.over ? "text-error" : ""}`}
        >
          {chipText}
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent position="bottom" className="gap-3">
          <DialogHeader>
            <DialogTitle>年休の取得状況</DialogTitle>
          </DialogHeader>
          <p className="type-body-small text-on-surface-variant">
            {fiscalYearLabel(data.fiscalYear, data.startMonth)}
          </p>

          {view.total === null || view.remaining === null ? (
            <p className="type-body-medium">
              この年度の付与日数がまだ入っていません。年休の画面で入れると、残り日数が出ます。
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <b
                  className={`type-display-small tabular-nums ${view.over ? "text-error" : "text-primary"}`}
                >
                  {formatLeaveAmount(view.remaining)}
                </b>
                <span className="type-body-medium text-on-surface-variant">
                  {view.over ? "超過" : "残り"}
                </span>
              </div>
              <Bar
                total={view.total}
                taken={view.takenInDays}
                planned={view.plannedInDays}
                label={`合計${formatDays(view.total)}日のうち、取得済み${formatLeaveAmount(view.summary.taken)}・予定${formatLeaveAmount(view.summary.planned)}`}
              />
              <div className="type-body-small flex flex-wrap gap-x-4 gap-y-1 text-on-surface-variant">
                <span>
                  取得済み{" "}
                  <b className="text-on-surface tabular-nums">
                    {formatLeaveAmount(view.summary.taken)}
                  </b>
                </span>
                <span>
                  予定{" "}
                  <b className="text-on-surface tabular-nums">
                    {formatLeaveAmount(view.summary.planned)}
                  </b>
                </span>
                <span>
                  合計 <b className="text-on-surface tabular-nums">{formatDays(view.total)}日</b>
                  {data.carriedOverDays > 0 && `（繰越${formatDays(data.carriedOverDays)}日）`}
                </span>
              </div>
            </>
          )}

          {(view.planned.length > 0 || view.taken.length > 0) && (
            <ul className="type-body-small divide-y divide-outline-variant">
              {[
                ...view.planned.map((record) => ({ record, planned: true })),
                ...view.taken.map((record) => ({ record, planned: false })),
              ].map(({ record, planned }) => (
                <li key={record.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate">
                    {spanLabel(record.startDate, record.endDate)} {record.annualLeave}
                    {planned && <span className="text-on-surface-variant">（予定）</span>}
                  </span>
                  <span className="shrink-0 text-on-surface-variant tabular-nums">
                    {formatLeaveAmount(recordAmountInRange(record, view.range))}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Button variant="outline" asChild className="w-full">
            <Link href={`/work/leave?year=${data.fiscalYear}`}>年休の取得状況を開く</Link>
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Bar({
  total,
  taken,
  planned,
  label,
}: {
  total: number;
  taken: number;
  planned: number;
  label: string;
}) {
  const scale = Math.max(total, taken + planned, 1);
  const pct = (value: number) => `${Math.max((value / scale) * 100, 0)}%`;
  return (
    <div className="flex h-3 gap-0.5" role="img" aria-label={label}>
      {taken > 0 && <span className="rounded-sm bg-tertiary" style={{ width: pct(taken) }} />}
      {planned > 0 && (
        <span className="slot-leave-planned rounded-sm" style={{ width: pct(planned) }} />
      )}
      {total - taken - planned > 0 && (
        <span
          className="rounded-sm bg-surface-container-highest"
          style={{ width: pct(total - taken - planned) }}
        />
      )}
    </div>
  );
}

function spanLabel(startDate: string, endDate: string): string {
  const short = (dateKey: string) =>
    `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;
  if (startDate !== endDate) return `${short(startDate)} – ${short(endDate)}`;
  const weekday = WEEKDAYS[new Date(`${startDate}T00:00:00Z`).getUTCDay()];
  return `${short(startDate)}(${weekday})`;
}
