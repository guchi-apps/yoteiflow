"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import type { WorkAutoSettings } from "@/services/work-sync/settings";
import {
  TRAVEL_MODES,
  TRAVEL_MODE_LABELS,
  type TravelMode,
  type WritableCalendar,
} from "@/types/calendar";

export type WorkRouteRow = {
  id: string;
  origin: string;
  destination: string;
  mode: TravelMode;
  minutes: number;
};

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
 * 移動の既定値は「出発地 → 行き先」の組ごとに持つ。往路と復路は別の行なので、所要時間が
 * 違ってもそれぞれ置ける。ここの値はあくまで既定で、特定の日の移動を直しても更新しない。
 */
export function WorkAutoSection({
  settings,
  routes: initialRoutes,
  calendars,
  placeNames,
}: {
  settings: WorkAutoSettings;
  routes: WorkRouteRow[];
  calendars: WritableCalendar[];
  /** 勤務場所の選択肢。在宅扱いの指定と、移動の行き先の候補に使う。 */
  placeNames: string[];
}) {
  const [value, setValue] = useState(settings);
  const [routes, setRoutes] = useState(initialRoutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [destination, setDestination] = useState("");
  const [outMinutes, setOutMinutes] = useState("");
  const [backMinutes, setBackMinutes] = useState("");
  const [mode, setMode] = useState<TravelMode>("PUBLIC_TRANSIT");

  const home = value.homeOrigin;

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

  const putRoute = async (origin: string, to: string, minutes: number) => {
    const response = await fetch("/api/settings/work-routes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, destination: to, mode, minutes }),
    });
    const body = (await response.json().catch(() => null)) as {
      route?: WorkRouteRow;
      message?: string;
    } | null;
    if (!response.ok || !body?.route) throw new Error(body?.message ?? "保存できませんでした。");
    const saved = body.route;
    setRoutes((current) => [
      ...current.filter((route) => route.id !== saved.id),
      saved,
    ]);
  };

  const addRoute = async () => {
    const to = destination.trim();
    const out = Number(outMinutes);
    const back = backMinutes === "" ? out : Number(backMinutes);
    if (!home || !to || !(out > 0) || !(back > 0)) {
      setError("行き先と、往路・復路の所要時間（分）を入力してください。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await putRoute(home, to, out);
      await putRoute(to, home, back);
      setDestination("");
      setOutMinutes("");
      setBackMinutes("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const removeRoute = async (id: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/settings/work-routes?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (response.ok) setRoutes((current) => current.filter((route) => route.id !== id));
      else setError("削除できませんでした。");
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

        {placeNames.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label>在宅として扱う勤務場所</Label>
            <div className="flex flex-wrap gap-2">
              {placeNames.map((name) => {
                const selected = value.remotePlaces.includes(name);
                return (
                  <Button
                    key={name}
                    type="button"
                    size="sm"
                    variant={selected ? "secondary" : "outline"}
                    className={cn("rounded-full")}
                    disabled={busy}
                    aria-pressed={selected}
                    onClick={() =>
                      send({
                        remotePlaces: selected
                          ? value.remotePlaces.filter((place) => place !== name)
                          : [...value.remotePlaces, name],
                      })
                    }
                  >
                    {name}
                  </Button>
                );
              })}
            </div>
            <p className="type-body-small text-on-surface-variant">
              在宅の日は勤務予定だけを作り、通勤の移動は作りません。
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <Label>勤務先・出張先への既定の移動</Label>
          {home ? (
            <p className="type-body-small text-on-surface-variant">
              出発地は、設定の「移動」の既定の出発地（{home}）です。往路と復路は別々の所要時間を持てます。
              移動時間が未設定の行き先には、移動を作りません。
            </p>
          ) : (
            <p className="type-body-small text-on-surface-variant">
              先に
              <Link href="/settings/travel" className="underline">
                設定の「移動」
              </Link>
              で既定の出発地を入れてください。
            </p>
          )}

          {routes.length > 0 && (
            <ul className="flex flex-col gap-1">
              {routes.map((route) => (
                <li
                  key={route.id}
                  className="type-body-medium flex items-center justify-between gap-2 rounded-lg bg-surface-container px-3 py-2"
                >
                  <span className="min-w-0 truncate">
                    {route.origin} → {route.destination}（{TRAVEL_MODE_LABELS[route.mode]}・
                    {route.minutes}分）
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => removeRoute(route.id)}
                  >
                    削除
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {home && (
            <div className="flex flex-col gap-2">
              <Input
                aria-label="勤務先・出張先"
                placeholder="勤務先・出張先（例: 栗東・門真）"
                list="work-route-destinations"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              />
              <datalist id="work-route-destinations">
                {placeNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  aria-label="往路の所要時間（分）"
                  placeholder="往路（分）"
                  inputMode="numeric"
                  value={outMinutes}
                  onChange={(event) => setOutMinutes(event.target.value)}
                />
                <Input
                  aria-label="復路の所要時間（分）"
                  placeholder="復路（分・空なら往路と同じ）"
                  inputMode="numeric"
                  value={backMinutes}
                  onChange={(event) => setBackMinutes(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {TRAVEL_MODES.map((candidate) => (
                  <Button
                    key={candidate}
                    type="button"
                    size="sm"
                    variant={candidate === mode ? "secondary" : "outline"}
                    className="rounded-full"
                    aria-pressed={candidate === mode}
                    onClick={() => setMode(candidate)}
                  >
                    {TRAVEL_MODE_LABELS[candidate]}
                  </Button>
                ))}
              </div>
              <Button type="button" disabled={busy} onClick={addRoute}>
                追加・置き換え
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
