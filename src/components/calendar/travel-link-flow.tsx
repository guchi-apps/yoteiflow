"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CalendarEventItem, TravelItem } from "@/types/calendar";

import { isoToLocalInput } from "./datetime-fields";
import { EventPickerDialog, type PickedItem } from "./event-picker-dialog";
import { readErrorMessage } from "./response-error";
import { formatLinkedDate } from "./task-link-label";
import type { TouchedRange } from "./use-calendar-chunks";

/** 移動と予定の紐づけを外す。移動そのものは消さない（issue #1105）。 */
export async function unlinkTravel(travelId: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/travels/${encodeURIComponent(travelId)}/link`, { method: "DELETE" });
    if (!response.ok) return await readErrorMessage(response, "紐づけを外せませんでした。");
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "紐づけを外せませんでした。";
  }
}

export type TravelLinkSide =
  /** 予定の表示画面から、既存の移動を選んで結ぶ。 */
  | { kind: "event"; event: CalendarEventItem }
  /** 移動の表示画面から、既存の予定を選んで結ぶ。 */
  | { kind: "travel"; travel: TravelItem };

/** 終日（日付だけ）はそのまま、時刻ありは設定タイムゾーンの日付にする。 */
function dateKeyOf(iso: string, timeZone: string): string {
  return iso.includes("T") ? isoToLocalInput(iso, timeZone).slice(0, 10) : iso.slice(0, 10);
}

/**
 * 既存の予定と移動を後から結ぶ（issue #1105）。相手を選ぶ（`EventPickerDialog`）→確認、の2段。
 * 往路・復路は選ばせない（issue #1137。予定との前後は日時から判断する）。選んだ時点では保存せず、確認のOKで `PUT /api/travels/[id]/link` を呼ぶ。
 */
export function TravelLinkFlow({
  side,
  timeZone,
  weekStartsOn = 0,
  onCancel,
  onLinked,
}: {
  side: TravelLinkSide;
  timeZone: string;
  weekStartsOn?: number;
  onCancel: () => void;
  onLinked: (touched: TouchedRange[] | null) => void;
}) {
  const [picked, setPicked] = useState<PickedItem | null>(null);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!picked) {
    return (
      <EventPickerDialog
        timeZone={timeZone}
        weekStartsOn={weekStartsOn}
        initialDate={dateKeyOf(side.kind === "event" ? side.event.start : side.travel.start, timeZone)}
        kinds={side.kind === "event" ? "travel" : "event"}
        title={side.kind === "event" ? "紐づける移動を選ぶ" : "紐づける予定を選ぶ"}
        description={
          side.kind === "event"
            ? "この予定に結ぶ移動を押してください。"
            : "この移動に結ぶ予定を押してください。"
        }
        onCancel={onCancel}
        onSelect={(item) => {
          setPicked(item);
        }}
      />
    );
  }

  const travel = side.kind === "travel" ? side.travel : picked.travel;
  const event =
    side.kind === "event"
      ? { id: side.event.id, calendarId: side.event.calendarId, title: side.event.title, start: side.event.start, end: side.event.end }
      : { id: picked.eventId, calendarId: picked.calendarId, title: picked.title, start: picked.start, end: picked.end };

  // 移動がすでに別の予定へ結ばれているときは付け替えになる。

  const replacing = Boolean(travel?.linkedEventId && travel.linkedEventId !== event.id);

  const close = () => {
    setOpen(false);
    setTimeout(onCancel, 150);
  };

  const confirm = async () => {
    if (!travel || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/travels/${encodeURIComponent(travel.id)}/link`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // 予定の時刻は、持ち物の期限を予定前の移動へ自動で付けるかの判断にだけ使う。
        body: JSON.stringify({
          calendarId: event.calendarId,
          eventId: event.id,
          eventStart: event.start,
          eventEnd: event.end,
          eventAllDay: !event.start.includes("T"),
        }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "紐づけできませんでした。"));
        return;
      }
      const touched: TouchedRange[] = [
        { start: travel.start, end: travel.end },
        { start: event.start, end: event.end },
      ];
      setOpen(false);
      setTimeout(() => onLinked(touched), 150);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "紐づけできませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>この予定と移動を紐づけますか</DialogTitle>
          <DialogDescription className="sr-only">予定と移動を結びます。</DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-0.5 rounded-lg bg-surface-container-high px-3 py-2">
            <span className="text-xs text-on-surface-variant">予定</span>
            <b className="clip-nowrap text-sm">{event.title}</b>
            <span className="text-xs text-on-surface-variant">{formatLinkedDate(event.start, timeZone)}</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-lg bg-surface-container-high px-3 py-2">
            <span className="text-xs text-on-surface-variant">移動</span>
            <b className="clip-nowrap text-sm">{travel?.title}</b>
            <span className="text-xs text-on-surface-variant">
              {travel ? `${formatLinkedDate(travel.start, timeZone)} 〜 ${formatLinkedDate(travel.end, timeZone)}` : ""}
            </span>
          </div>

          {replacing && (
            <p className="text-sm text-on-surface-variant">
              この移動はいま別の予定に紐づいています。結ぶと、そちらとの紐づけは外れます。
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={busy}>
            やめる
          </Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? "保存中…" : "紐づける"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
