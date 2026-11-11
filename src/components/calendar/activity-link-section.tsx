"use client";

import { ChevronRight, Link2, Unlink } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import type { ActivityLinkItem, CalendarEventItem } from "@/types/calendar";

import { isoToLocalInput } from "./datetime-fields";
import { EventPickerDialog } from "./event-picker-dialog";
import { readErrorMessage } from "./response-error";

/** 時間帯の表示。サーバーの写しはISO。 */
function span(link: ActivityLinkItem, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const time = new Intl.DateTimeFormat("ja-JP", { timeZone, hour: "2-digit", minute: "2-digit" });
  return `${fmt.format(new Date(link.recordStart))}–${time.format(new Date(link.recordEnd))}`;
}

/**
 * 活動記録と予定の紐づけ（issue #1514・docs/spec.md §27）。
 *
 * - 活動記録の詳細: 紐づけ先の予定を出し、選ぶ・外すができる（記録1件につき予定は1件）
 * - 予定の詳細: この予定に紐づいた活動記録を一覧で出す（操作は記録側から）
 * 両側の項目名・時間帯はサーバーが写しを持つため、取得範囲の外でも出せる。
 */
export function ActivityLinkSection({
  event,
  timeZone,
  weekStartsOn,
  isActivity,
  readOnly,
  onChanged,
  onOpenEvent,
}: {
  event: CalendarEventItem;
  timeZone: string;
  weekStartsOn: number;
  isActivity: boolean;
  readOnly: boolean;
  /** 紐づけが変わったとき。開いている予定へ反映して取り直してもらう。 */
  onChanged: (links: ActivityLinkItem[]) => void;
  /** 相手の予定が手元にあれば開く。無ければ false（行は押せない表示にする）。 */
  onOpenEvent: (eventId: string) => boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const links = event.activityLinks ?? [];

  if (isActivity) {
    const link = links.find((item) => item.recordEventId === event.id) ?? null;
    if (event.allDay) return null;

    const pick = async (planned: { calendarId: string; eventId: string; title: string }) => {
      setPicking(false);
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/activity-links", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordCalendarId: event.calendarId,
            recordEventId: event.id,
            recordTitle: event.title,
            recordStart: event.start,
            recordEnd: event.end,
            plannedCalendarId: planned.calendarId,
            plannedEventId: planned.eventId,
            plannedTitle: planned.title,
          }),
        });
        if (!response.ok) {
          setError(await readErrorMessage(response, "紐づけを保存できませんでした。"));
          return;
        }
        const { linkId } = (await response.json()) as { linkId: string };
        onChanged([
          {
            id: linkId,
            recordCalendarId: event.calendarId,
            recordEventId: event.id,
            recordTitle: event.title,
            recordStart: event.start,
            recordEnd: event.end,
            plannedCalendarId: planned.calendarId,
            plannedEventId: planned.eventId,
            plannedTitle: planned.title,
          },
        ]);
      } catch {
        setError("通信できませんでした。");
      } finally {
        setBusy(false);
      }
    };

    const unlink = async () => {
      if (!link) return;
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(`/api/activity-links/${link.id}`, { method: "DELETE" });
        if (!response.ok) {
          setError(await readErrorMessage(response, "紐づけを外せませんでした。"));
          return;
        }
        onChanged([]);
      } catch {
        setError("通信できませんでした。");
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1 text-xs text-on-surface-variant">
          <Link2 className="size-3.5" />
          紐づいた予定
        </div>
        {link ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onOpenEvent(link.plannedEventId)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-outline-variant py-1.5 pr-2.5 pl-2 text-left text-xs text-on-surface"
            >
              <span className="min-w-0 flex-1 truncate">{link.plannedTitle || "（無題の予定）"}</span>
              <ChevronRight className="size-4 shrink-0 opacity-70" />
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="予定との紐づけを外す"
              disabled={readOnly || busy}
              onClick={unlink}
            >
              <Unlink className="size-4" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={readOnly || busy}
            onClick={() => setPicking(true)}
          >
            予定と紐づける…
          </Button>
        )}
        {link && !readOnly && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPicking(true)}>
            別の予定に付け替える…
          </Button>
        )}
        {readOnly && <p className="text-xs text-on-surface-variant">{OFFLINE_WRITE_MESSAGE}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {picking && (
          <EventPickerDialog
            timeZone={timeZone}
            weekStartsOn={weekStartsOn}
            kinds="event"
            title="紐づける予定を選ぶ"
            description="この活動記録がどの予定の実績かを選びます。"
            initialDate={isoToLocalInput(event.start, timeZone).slice(0, 10)}
            onCancel={() => setPicking(false)}
            onSelect={(item) =>
              void pick({ calendarId: item.calendarId, eventId: item.eventId, title: item.title })
            }
          />
        )}
      </div>
    );
  }

  // 予定側: この予定に紐づく活動記録の一覧。
  const records = links.filter((item) => item.plannedEventId === event.id);
  if (records.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 text-xs text-on-surface-variant">
        <Link2 className="size-3.5" />
        この予定の活動記録
      </div>
      {records.map((record) => (
        <button
          key={record.id}
          type="button"
          onClick={() => onOpenEvent(record.recordEventId)}
          className="flex items-center gap-2 rounded-md border border-outline-variant py-1.5 pr-2.5 pl-2 text-left text-xs text-on-surface"
        >
          <span className="min-w-0 flex-1 truncate">
            {record.recordTitle}
            <span className="opacity-75">（{span(record, timeZone)}）</span>
          </span>
          <ChevronRight className="size-4 shrink-0 opacity-70" />
        </button>
      ))}
    </div>
  );
}
