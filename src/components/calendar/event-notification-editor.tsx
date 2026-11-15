"use client";

import { useState } from "react";
import { Bell, BellOff, Plus, Trash2 } from "lucide-react";

import {
  eventLeadLabel,
  leadMinutesToWheelTime,
  nextLeadMinutesToAdd,
  normalizeLeadMinutes,
  wheelTimeToLeadMinutes,
} from "@/lib/event-notification";
import { cn } from "@/lib/utils";
import type { EventNotificationOverride } from "@/types/calendar";
import { FormRow } from "./event-form-row";
import { TimeWheels } from "./date-time-picker";

/**
 * 予定・移動の通知設定を行の中で編集する（issue #1569。旧: ポップアップの
 * EventNotificationDialog）。通知は「何分前」の並びで、各行の分数を押すと時・分の
 * ホイールが開き、右端のゴミ箱で消す。0件になれば通知オフ（null）として返す。
 *
 * APIは呼ばず、選んだ値を呼び出し側へ返すだけ。実際の保存は編集画面の「保存」で送る。
 */
export function EventNotificationEditor({
  value,
  onChange,
  disabled = false,
  hint,
}: {
  value: EventNotificationOverride | null;
  onChange: (next: EventNotificationOverride | null) => void;
  disabled?: boolean;
  /** 行の下に出す補足（繰り返し予定で押せない理由・基準の説明など）。 */
  hint?: string;
}) {
  // 編集中は入れた順のまま並べ、ホイールを閉じたとき・追加・削除のときに昇順へ直す
  // （分数を回している最中に行が入れ替わると、どれを触っているか分からなくなるため）。
  const [items, setItems] = useState<number[]>(() =>
    value?.enabled ? value.leadMinutes : [],
  );
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const emit = (next: number[]) => {
    const normalized = normalizeLeadMinutes(next);
    onChange(normalized.length > 0 ? { enabled: true, leadMinutes: normalized } : null);
  };

  const commit = (next: number[], opened: number | null) => {
    setItems(next);
    setOpenIndex(opened);
    emit(next);
  };

  const sortedItems = (list: number[]) => [...list].sort((a, b) => a - b);

  const start = () => commit([10], null);

  const add = () => {
    const sorted = sortedItems(items);
    const next = [...sorted, nextLeadMinutesToAdd(sorted)];
    commit(next, next.length - 1);
  };

  const remove = (index: number) => {
    commit(
      items.filter((_, i) => i !== index),
      null,
    );
  };

  const toggleWheel = (index: number) => {
    if (openIndex === index) {
      // 閉じるときに昇順へ直す。
      setItems(sortedItems(items));
      setOpenIndex(null);
    } else {
      setItems(sortedItems(items));
      // 並べ替え後の位置で開く。
      setOpenIndex(sortedItems(items).indexOf(items[index]));
    }
  };

  const setMinutes = (index: number, time: string) => {
    commit(
      items.map((minutes, i) => (i === index ? wheelTimeToLeadMinutes(time) : minutes)),
      index,
    );
  };

  const enabled = items.length > 0;

  return (
    <FormRow icon={enabled ? <Bell /> : <BellOff />}>
      {!enabled ? (
        <button
          type="button"
          disabled={disabled}
          onClick={start}
          className="flex min-h-11 w-full items-center text-left text-sm text-muted-foreground disabled:opacity-38"
        >
          通知
        </button>
      ) : (
        <div className="flex flex-col">
          {items.map((minutes, index) => (
            <div key={index} className="flex flex-col">
              <div className="flex min-h-11 items-center gap-3">
                <button
                  type="button"
                  aria-expanded={openIndex === index}
                  onClick={() => toggleWheel(index)}
                  className={cn(
                    "-ml-1 rounded-md px-1 py-1 text-left text-sm text-foreground",
                    openIndex === index && "bg-primary-container",
                  )}
                >
                  {eventLeadLabel(minutes)}
                </button>
                <button
                  type="button"
                  aria-label={`${eventLeadLabel(minutes)}の通知を削除`}
                  onClick={() => remove(index)}
                  className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high"
                >
                  <Trash2 className="size-5" />
                </button>
              </div>
              {openIndex === index && (
                <div className="mb-1 rounded-xl bg-surface-container">
                  <p className="pt-2 text-center text-base font-bold text-primary">
                    {minutes === 0 ? "予定の時刻ちょうどに通知" : `${eventLeadLabel(minutes)}に通知`}
                  </p>
                  <TimeWheels
                    time={leadMinutesToWheelTime(minutes)}
                    onChange={(time) => setMinutes(index, time)}
                    rows={5}
                    units
                  />
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={add}
            className="flex min-h-11 items-center gap-1.5 text-sm text-primary disabled:opacity-38"
          >
            <Plus className="size-4" />
            通知を追加
          </button>
        </div>
      )}
      {hint && <p className="type-label-small text-on-surface-variant">{hint}</p>}
    </FormRow>
  );
}
