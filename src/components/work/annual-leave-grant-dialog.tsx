"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Clock, Hash, Repeat } from "lucide-react";
import { useOffline } from "next/offline";

import { readErrorMessage } from "@/components/calendar/response-error";
import { ItemFormActions } from "@/components/calendar/item-form-actions";
import { TimeWheels } from "@/components/calendar/date-time-picker";
import { FormRow } from "@/components/calendar/event-form-row";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fiscalYearLabel, normalizeStartMonth } from "@/lib/annual-leave";
import { joinTime } from "@/lib/date-time-picker";
import { cn } from "@/lib/utils";
import { DEFAULT_WORK_MINUTES_PER_DAY } from "@/types/work";

/**
 * 年休の付与日数・繰越・年度の開始月・1日の所定労働時間を直す（docs/spec.md §34）。
 *
 * 設定画面ではなく、見ている年度の画面から開く。付与日数は年度ごとに違い、直したくなるのは
 * その年度を見ているときだから。開始月と所定労働時間は全年度に効くので、そう書き添える。
 */
export function AnnualLeaveGrantDialog({
  fiscalYear,
  startMonth,
  grantedDays,
  carriedOverDays,
  workMinutesPerDay = DEFAULT_WORK_MINUTES_PER_DAY,
  onClose,
}: {
  fiscalYear: number;
  startMonth: number;
  /** その年度の付与日数。まだ入れていない年度は null（欄は空で開く）。 */
  grantedDays: number | null;
  carriedOverDays: number;
  /** 1日の所定労働時間（分）。時間休が1日ぶんの何割かを決める（issue #537）。 */
  workMinutesPerDay?: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const offline = useOffline();

  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [granted, setGranted] = useState(grantedDays === null ? "" : String(grantedDays));
  const [carried, setCarried] = useState(carriedOverDays === 0 ? "" : String(carriedOverDays));
  const [month, setMonth] = useState(String(startMonth));
  // 所定労働時間は時と分に分けて持つ。1つの欄にすると 7.75 のような小数を打たせることになる
  // （日時の入力を日付と時刻の欄に分けているのと同じ理由・issue #537）。
  const [workHours, setWorkHours] = useState(String(Math.floor(workMinutesPerDay / 60)));
  const [workMinutes, setWorkMinutes] = useState(String(workMinutesPerDay % 60));
  const [workTimeOpen, setWorkTimeOpen] = useState(false);

  const close = () => {
    setOpen(false);
    onClose();
  };

  const save = async () => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    // 空欄は0として扱う（繰越が無い年度でわざわざ0を打たせない）。0.5刻みの判定は
    // サーバー側にも置いてあり、ここはその場で理由を出すためのもの。
    const grantedDaysValue = granted.trim() === "" ? 0 : Number(granted);
    const carriedDaysValue = carried.trim() === "" ? 0 : Number(carried);
    const monthValue = Number(month);
    // 分の欄を空にしただけで保存できなくならないよう、空欄は0として扱う（繰越と同じ）。
    const workMinutesValue =
      Number(workHours || 0) * 60 + Number(workMinutes.trim() === "" ? 0 : workMinutes);

    if (!isDays(grantedDaysValue) || !isDays(carriedDaysValue)) {
      setError("付与日数・繰越日数は0〜400の範囲で、0.5日単位で入力してください。");
      return;
    }
    if (!Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12) {
      setError("年度の開始月は1〜12で入力してください。");
      return;
    }
    if (
      !Number.isInteger(workMinutesValue) ||
      workMinutesValue < 60 ||
      workMinutesValue > 1440
    ) {
      setError("1日の所定労働時間は1時間〜24時間の範囲で入力してください。");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/work/leave-grant", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fiscalYear,
          grantedDays: grantedDaysValue,
          carriedOverDays: carriedDaysValue,
          fiscalYearStartMonth: monthValue,
          workMinutesPerDay: workMinutesValue,
        }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "付与日数を保存できませんでした。"));
        return;
      }
      // 開始月を変えると年度の期間そのものが動くため、URLの年度はそのままに取り直す。
      startTransition(() => router.refresh());
      close();
    } catch {
      setError("付与日数を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const label = fiscalYearLabel(fiscalYear, normalizeStartMonth(Number(month)));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-y-auto">
        <DialogTitle>{label}の年休</DialogTitle>
        <DialogDescription className="sr-only">
          付与日数・繰越日数・1日の所定労働時間と年度の開始月を設定します。
        </DialogDescription>

        {error && (
          <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
            {error}
          </p>
        )}

        {/* 予定の入力と同じアイコン付きの行＋区切り線にそろえる（issue #1771）。 */}
        <div className="flex min-w-0 flex-col">
          <FormRow icon={<Hash />} divider={false}>
            <Input
              id="leave-granted"
              label="この年度に付与された日数"
              variant="flat"
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              value={granted}
              onChange={(event) => setGranted(event.target.value)}
            />
          </FormRow>

          <FormRow icon={<Repeat />}>
            <Input
              id="leave-carried"
              label="前年度からの繰越"
              variant="flat"
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              value={carried}
              onChange={(event) => setCarried(event.target.value)}
            />
          </FormRow>

          {/* 時間休が何日ぶんかを決める値（issue #537）。小数を打たせないよう、時と分の
              ホイールで選ばせる（予定の通知の「何時間何分前」と同じ部品）。 */}
          <FormRow icon={<Clock />}>
            <button
              type="button"
              aria-expanded={workTimeOpen}
              onClick={() => setWorkTimeOpen((v) => !v)}
              className="flex min-h-10 w-full flex-col justify-center text-left"
            >
              <span className="text-xs leading-4 text-muted-foreground">1日の所定労働時間</span>
              <span className={cn("text-sm tabular-nums", workTimeOpen && "text-primary")}>
                {Number(workHours) || 0}時間 {Number(workMinutes) || 0}分
              </span>
            </button>
            {workTimeOpen && (
              <TimeWheels
                units
                maxHour={24}
                time={joinTime(Number(workHours) || 0, Number(workMinutes) || 0)}
                onChange={(next) => {
                  setWorkHours(String(Number(next.slice(0, 2))));
                  setWorkMinutes(String(Number(next.slice(3, 5))));
                }}
              />
            )}
            <p className="type-body-small pb-1 text-on-surface-variant">
              時間休が何日ぶんかを決めます。すべての年度に効きます。
            </p>
          </FormRow>

          <FormRow icon={<CalendarDays />}>
            <Input
              id="leave-start-month"
              label="年度の開始月"
              variant="flat"
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              max="12"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
            <p className="type-body-small pb-1 text-on-surface-variant">
              開始月はすべての年度に効きます。変えると、これまでに入れた付与日数が指す期間も一緒に動きます。
            </p>
          </FormRow>
        </div>

        <ItemFormActions saveDisabled={busy || offline} onSave={save} />
      </DialogContent>
    </Dialog>
  );
}

/** 付与・繰越として受け付ける日数か。半休が0.5日なので0.5刻みまで受ける。 */
function isDays(value: number): boolean {
  return (
    Number.isFinite(value) && value >= 0 && value <= 400 && Math.round(value * 2) === value * 2
  );
}
