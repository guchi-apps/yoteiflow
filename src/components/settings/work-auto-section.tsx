"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { WorkAutoSettings } from "@/services/work-sync/settings";
import type { WritableCalendar } from "@/types/calendar";

const DEFAULT_CALENDAR_VALUE = "__default__";

const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const fromTime = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};

/**
 * 勤務記録からの勤務予定・移動の自動生成（docs/spec.md §46）。
 *
 * ここは全体の設定（共通の勤務時間・書き出し先）。勤務場所ごとの既定値は、勤務場所の詳細
 * （work-places-panel.tsx・issue #1405）にある。
 */
export function WorkAutoSection({
  settings,
  calendars,
}: {
  settings: WorkAutoSettings;
  calendars: WritableCalendar[];
}) {
  const [value, setValue] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (patch: Partial<WorkAutoSettings>) => {
    const previous = value;
    setValue({ ...value, ...patch });
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/work-auto", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) {
        setError((body?.message as string) ?? "設定を保存できませんでした。");
        setValue(previous);
      }
    } catch {
      setError("設定を保存できませんでした。");
      setValue(previous);
    } finally {
      setBusy(false);
    }
  };

  const timeField = (
    id: string,
    label: string,
    key: "startMinutes" | "endMinutes" | "lunchStartMinutes" | "lunchEndMinutes",
  ) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="time"
        value={toTime(value[key])}
        disabled={busy}
        onChange={(event) => {
          const next = fromTime(event.target.value);
          if (next !== null && next !== value[key]) void send({ [key]: next });
        }}
      />
    </div>
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        {error && (
          <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
            {error}
          </p>
        )}

        <label className="flex min-h-11 items-center justify-between gap-4">
          <span className="flex flex-col">
            <span className="type-body-large">勤務予定・移動を自動で作る</span>
            <span className="type-body-small text-on-surface-variant">
              勤務記録を保存すると、勤務時間の予定と、出社・出張の往路・復路の移動をカレンダーへ作り、
              記録の変更に合わせて直します。手で作った予定・移動、手で直した自動作成分は変えません。
            </span>
          </span>
          <Switch
            checked={value.enabled}
            disabled={busy}
            onCheckedChange={(checked) => send({ enabled: checked })}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          {timeField("work-start", "勤務開始", "startMinutes")}
          {timeField("work-end", "勤務終了", "endMinutes")}
          {timeField("work-lunch-start", "昼休み開始", "lunchStartMinutes")}
          {timeField("work-lunch-end", "昼休み終了", "lunchEndMinutes")}
        </div>
        <p className="type-body-small text-on-surface-variant">
          午前半休は昼休み終了から、午後半休は昼休み開始までを勤務時間にします。時間休は終了側から
          その時間を引きます。年休（全休）・休みの日は作りません。
        </p>

        <div className="flex flex-col gap-2">
          <Label htmlFor="work-calendar">勤務予定の書き出し先</Label>
          <Select
            value={value.calendarId ?? DEFAULT_CALENDAR_VALUE}
            disabled={busy || calendars.length === 0}
            onValueChange={(next) =>
              send({ calendarId: next === DEFAULT_CALENDAR_VALUE ? null : next })
            }
          >
            <SelectTrigger id="work-calendar" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_CALENDAR_VALUE}>既定の保存先</SelectItem>
              {calendars.map((calendar) => (
                <SelectItem key={calendar.calendarId} value={calendar.calendarId}>
                  {calendar.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="type-body-small text-on-surface-variant">
            移動の書き出し先は、設定の「移動」で選んだカレンダーです。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
