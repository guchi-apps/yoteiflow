"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CalendarSettingsResult } from "@/services/google-calendar/settings";

/** 祝日カレンダーを選ぶ欄で「指定しない」を表す値。Radixのセレクトは空文字を値にできない。 */
const NONE_VALUE = "__none__";

/**
 * 祝日として扱うカレンダーを選ぶ（issue #699）。
 *
 * 「日本の祝日」等の公開カレンダーは読み取り専用（accessRole: reader）で購読されるのが
 * 通常のため、書き込み可能なカレンダーだけを集める一覧（活動記録・移動の保存先と同じ
 * `WritableCalendar`）には出てこない。ここでは表示オン（visible）のカレンダー全体から選ぶ。
 *
 * 選んだカレンダーの予定は、カレンダー画面の終日エリアで他の予定より上に表示される。
 */
export function HolidayCalendarSection({
  result,
  holidayCalendarId,
}: {
  result: CalendarSettingsResult;
  holidayCalendarId: string | null;
}) {
  const router = useRouter();
  const [calendarId, setCalendarId] = useState(holidayCalendarId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (result.status !== "ok") return null;

  // 祝日カレンダーは読み取り専用で購読されるのが通常のため、使用（writeEnabled）は
  // 問わず、表示（visible）しているカレンダーから選ばせる。
  const visibleCalendars = result.calendars.filter((calendar) => calendar.visible);

  const change = async (value: string) => {
    const next = value === NONE_VALUE ? null : value;

    // 応答を待ってから欄を動かすと、選んだのに変わらない時間ができる。先に反映し、失敗したら戻す。
    const previous = calendarId;
    setCalendarId(next);
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/holiday-calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: next }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? "祝日カレンダーを変更できませんでした。");
        setCalendarId(previous);
        return;
      }

      router.refresh();
    } catch {
      setError("祝日カレンダーを変更できませんでした。");
      setCalendarId(previous);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        {error && (
          <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
            {error}
          </p>
        )}

        <div className="flex min-h-10 items-center justify-between gap-3">
          <Label htmlFor="holiday-calendar">祝日カレンダー</Label>
          <Select
            value={calendarId ?? NONE_VALUE}
            disabled={busy || visibleCalendars.length === 0}
            onValueChange={change}
          >
            <SelectTrigger id="holiday-calendar" variant="flat" className="max-w-[60%] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>指定しない</SelectItem>
              {visibleCalendars.map((calendar) => (
                <SelectItem key={calendar.calendarId} value={calendar.calendarId}>
                  {calendar.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="type-body-small text-on-surface-variant">
          選んだカレンダーの予定は、カレンダー画面の終日の並びで他の予定より上に表示されます。
          「日本の祝日」等、表示をオンにしているカレンダーから選べます。
        </p>
      </CardContent>
    </Card>
  );
}
