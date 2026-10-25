"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * 勤務画面の月の見出しから開く、表示する月を選ぶシート（issue #1271）。
 *
 * 前へ・次へだけだと、数か月前の勤務場所を確かめるのに同じボタンを何度も押すことになる。
 * 年を送って月を押す2段にし、押したらその月へ移って閉じる。日付の欄（`type="month"`）に
 * しないのは、iOSのホイールでは年と月を両方回す手間が残り、格子のほうが1押しで済むため。
 */
export function MonthPickerDialog({
  open,
  monthKey,
  todayKey,
  onPick,
  onClose,
}: {
  open: boolean;
  /** 表示中の月（YYYY-MM）。開いたときの年と、塗る月に使う。 */
  monthKey: string;
  /** 今日（YYYY-MM-DD）。今月の印と「今月へ」に使う。 */
  todayKey: string;
  onPick: (monthKey: string) => void;
  onClose: () => void;
}) {
  const [year, setYear] = useState(Number(monthKey.slice(0, 4)));
  const thisMonth = todayKey.slice(0, 7);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent position="bottom" className="gap-4 pb-[calc(1.5rem_+_env(safe-area-inset-bottom))]">
        <DialogHeader>
          <DialogTitle>表示する月</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon-sm" aria-label="前の年" onClick={() => setYear(year - 1)}>
            <ChevronLeft />
          </Button>
          <span className="type-title-medium tabular-nums">{year}年</span>
          <Button variant="ghost" size="icon-sm" aria-label="次の年" onClick={() => setYear(year + 1)}>
            <ChevronRight />
          </Button>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 12 }, (_, index) => {
            const key = `${year}-${String(index + 1).padStart(2, "0")}`;
            const selected = key === monthKey;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                aria-current={key === thisMonth ? "date" : undefined}
                onClick={() => onPick(key)}
                className={cn(
                  "type-label-large h-10 rounded-md tabular-nums transition-colors",
                  selected
                    ? "bg-primary font-bold text-primary-foreground"
                    : "text-on-surface hover:bg-on-surface/8",
                  // 今月は選んでいなくても輪郭で分かるようにする（カレンダーの今日の丸と同じ役割）。
                  !selected && key === thisMonth && "ring-1 ring-primary ring-inset",
                )}
              >
                {index + 1}月
              </button>
            );
          })}
        </div>

        {monthKey !== thisMonth && (
          <Button variant="ghost" className="self-center" onClick={() => onPick(thisMonth)}>
            今月へ
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
