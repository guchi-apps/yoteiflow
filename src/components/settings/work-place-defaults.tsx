"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fromTime, toTime } from "@/lib/work-sync/form";
import { TRAVEL_MODES, TRAVEL_MODE_LABELS, type TravelMode } from "@/types/calendar";

export type WorkRouteRow = {
  id: string;
  origin: string;
  destination: string;
  mode: TravelMode;
  minutes: number;
};

export type WorkPlaceDefaultRow = {
  key: string;
  isTrip: boolean;
  workEnabled: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
  outboundEnabled: boolean;
  returnEnabled: boolean;
};

type Entry = { key: string; isTrip: boolean };

type EntryForm = {
  workEnabled: boolean;
  start: string;
  end: string;
  outEnabled: boolean;
  backEnabled: boolean;
  outMinutes: string;
  backMinutes: string;
  mode: TravelMode;
};

/**
 * 勤務先・出張先ごとの既定値（issue #1099・docs/spec.md §46）。
 *
 * 勤務時間・往路・復路のカレンダー反映の有無と、勤務開始・終了、往路・復路の所要時間を持つ。
 * 勤務入力で選ぶと、ここの値が初期表示になる。ここを変えても、保存済みの勤務記録・予定は
 * 変えない（記録ごとの値を優先し、すでに作った予定にも触れない）。時刻を空にすると共通設定を使う。
 * 移動の出発地は設定の「移動」の既定の出発地。在宅として扱う勤務先は移動を作らない。
 */
export function WorkPlaceDefaults({
  placeNames,
  tripPlaces,
  remotePlaces,
  defaults: initialDefaults,
  routes: initialRoutes,
  home,
  commonStart,
  commonEnd,
}: {
  placeNames: string[];
  tripPlaces: string[];
  remotePlaces: string[];
  defaults: WorkPlaceDefaultRow[];
  routes: WorkRouteRow[];
  home: string | null;
  commonStart: number;
  commonEnd: number;
}) {
  const [defaults, setDefaults] = useState(initialDefaults);
  const [routes, setRoutes] = useState(initialRoutes);
  const [extra, setExtra] = useState<Entry[]>([]);
  const [newTrip, setNewTrip] = useState("");

  const entries: Entry[] = [];
  const seen = new Set<string>();
  const add = (entry: Entry) => {
    const id = `${entry.isTrip ? "T" : "W"}\n${entry.key}`;
    if (!entry.key || seen.has(id)) return;
    seen.add(id);
    entries.push(entry);
  };
  placeNames.forEach((key) => add({ key, isTrip: tripPlaces.includes(key) }));
  defaults.forEach((row) => add({ key: row.key, isTrip: row.isTrip }));
  routes.forEach((route) => {
    if (route.origin === home) add({ key: route.destination, isTrip: !placeNames.includes(route.destination) });
  });
  extra.forEach(add);

  return (
    <div className="flex flex-col gap-3">
      <Label>勤務先・出張先ごとの既定値</Label>
      <p className="type-body-small text-on-surface-variant">
        勤務入力で勤務先を選ぶと、ここの値が最初に表示されます。入力画面で変えた値はその日の記録だけに
        保存され、ここの既定値は変わりません。ここを変えても、保存済みの勤務・予定は変わりません。
        時刻を空にすると、上の共通の勤務時間を使います。
      </p>
      {home ? (
        <p className="type-body-small text-on-surface-variant">
          移動の出発地は、設定の「移動」の既定の出発地（{home}）です。往路・復路で異なる所要時間を設定できます。
          所要時間が空の移動は、入力画面でその都度入れられます。
        </p>
      ) : (
        <p className="type-body-small text-on-surface-variant">
          移動を反映するには、先に
          <Link href="/settings/travel" className="underline">
            設定の「移動」
          </Link>
          で既定の出発地を入れてください。
        </p>
      )}

      {entries.map((entry) => (
        <PlaceCard
          key={`${entry.isTrip}:${entry.key}`}
          entry={entry}
          remote={!entry.isTrip && remotePlaces.includes(entry.key)}
          home={home}
          row={defaults.find((row) => row.key === entry.key && row.isTrip === entry.isTrip) ?? null}
          out={home ? routes.find((r) => r.origin === home && r.destination === entry.key) ?? null : null}
          back={home ? routes.find((r) => r.origin === entry.key && r.destination === home) ?? null : null}
          commonStart={commonStart}
          commonEnd={commonEnd}
          onSavedDefaults={setDefaults}
          onSavedRoutes={(next) =>
            setRoutes((current) => [
              ...current.filter((route) => !next.removed.includes(route.id) && !next.saved.some((s) => s.id === route.id)),
              ...next.saved,
            ])
          }
        />
      ))}

      <div className="flex gap-2">
        <Input
          aria-label="出張先を追加"
          placeholder="出張先を追加（例: 門真）"
          value={newTrip}
          onChange={(event) => setNewTrip(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!newTrip.trim()}
          onClick={() => {
            setExtra((current) => [...current, { key: newTrip.trim(), isTrip: true }]);
            setNewTrip("");
          }}
        >
          追加
        </Button>
      </div>
    </div>
  );
}

function PlaceCard({
  entry,
  remote,
  home,
  row,
  out,
  back,
  commonStart,
  commonEnd,
  onSavedDefaults,
  onSavedRoutes,
}: {
  entry: Entry;
  remote: boolean;
  home: string | null;
  row: WorkPlaceDefaultRow | null;
  out: WorkRouteRow | null;
  back: WorkRouteRow | null;
  commonStart: number;
  commonEnd: number;
  onSavedDefaults: (rows: WorkPlaceDefaultRow[]) => void;
  onSavedRoutes: (change: { saved: WorkRouteRow[]; removed: string[] }) => void;
}) {
  const [form, setForm] = useState<EntryForm>({
    workEnabled: row?.workEnabled ?? true,
    start: row?.startMinutes != null ? toTime(row.startMinutes) : "",
    end: row?.endMinutes != null ? toTime(row.endMinutes) : "",
    outEnabled: row?.outboundEnabled ?? true,
    backEnabled: row?.returnEnabled ?? true,
    outMinutes: out ? String(out.minutes) : "",
    backMinutes: back ? String(back.minutes) : "",
    mode: out?.mode ?? back?.mode ?? "PUBLIC_TRANSIT",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const patch = (next: Partial<EntryForm>) => {
    setForm((current) => ({ ...current, ...next }));
    setMessage(null);
  };

  const save = async () => {
    const start = form.start ? fromTime(form.start) : null;
    const end = form.end ? fromTime(form.end) : null;
    if ((form.start && start === null) || (form.end && end === null)) {
      return setMessage({ text: "時刻が正しくありません。", error: true });
    }
    if ((start === null) !== (end === null)) {
      return setMessage({ text: "勤務開始と終了は、両方入れるか両方空にしてください。", error: true });
    }
    if (start !== null && end !== null && end <= start) {
      return setMessage({ text: "勤務終了は開始より後にしてください。", error: true });
    }
    const minutes = (text: string, label: string) => {
      if (text.trim() === "") return null;
      const value = Number(text);
      if (!Number.isInteger(value) || value < 1 || value > 1440) {
        throw new Error(`${label}の所要時間は1〜1440分で入力してください。`);
      }
      return value;
    };

    setBusy(true);
    setMessage(null);
    try {
      const outMinutes = remote ? null : minutes(form.outMinutes, "往路");
      const backMinutes = remote ? null : minutes(form.backMinutes, "復路");

      const response = await fetch("/api/settings/work-place-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: entry.key,
          isTrip: entry.isTrip,
          workEnabled: form.workEnabled,
          startMinutes: start,
          endMinutes: end,
          outboundEnabled: form.outEnabled,
          returnEnabled: form.backEnabled,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        defaults?: WorkPlaceDefaultRow[];
        message?: string;
      } | null;
      if (!response.ok || !body?.defaults) throw new Error(body?.message ?? "保存できませんでした。");
      onSavedDefaults(body.defaults);

      if (home && !remote) {
        const saved: WorkRouteRow[] = [];
        const removed: string[] = [];
        for (const leg of [
          { origin: home, destination: entry.key, minutes: outMinutes, existing: out },
          { origin: entry.key, destination: home, minutes: backMinutes, existing: back },
        ]) {
          if (leg.minutes === null) {
            if (leg.existing) {
              await fetch(`/api/settings/work-routes?id=${encodeURIComponent(leg.existing.id)}`, {
                method: "DELETE",
              });
              removed.push(leg.existing.id);
            }
            continue;
          }
          const res = await fetch("/api/settings/work-routes", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              origin: leg.origin,
              destination: leg.destination,
              mode: form.mode,
              minutes: leg.minutes,
            }),
          });
          const routeBody = (await res.json().catch(() => null)) as {
            route?: WorkRouteRow;
            message?: string;
          } | null;
          if (!res.ok || !routeBody?.route) {
            throw new Error(routeBody?.message ?? "移動時間を保存できませんでした。");
          }
          saved.push(routeBody.route);
        }
        onSavedRoutes({ saved, removed });
      }
      setMessage({ text: "保存しました。", error: false });
    } catch (caught) {
      setMessage({
        text: caught instanceof Error ? caught.message : "保存できませんでした。",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-outline-variant p-3">
      <p className="type-title-small">
        {entry.key}
        <span className="type-label-small ml-2 text-on-surface-variant">
          {entry.isTrip ? "出張先" : remote ? "在宅（移動なし）" : "勤務先"}
        </span>
      </p>

      <label className="flex items-center gap-3">
        <Switch
          checked={form.workEnabled}
          onCheckedChange={(checked) => patch({ workEnabled: checked })}
        />
        <span className="type-body-medium">勤務時間をカレンダーへ反映</span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`start-${entry.key}`}>勤務開始（空＝共通 {toTime(commonStart)}）</Label>
          <Input
            id={`start-${entry.key}`}
            type="time"
            value={form.start}
            onChange={(event) => patch({ start: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`end-${entry.key}`}>勤務終了（空＝共通 {toTime(commonEnd)}）</Label>
          <Input
            id={`end-${entry.key}`}
            type="time"
            value={form.end}
            onChange={(event) => patch({ end: event.target.value })}
          />
        </div>
      </div>

      {!remote && (
        <>
          {(
            [
              ["往路", "outEnabled", "outMinutes"],
              ["復路", "backEnabled", "backMinutes"],
            ] as const
          ).map(([label, enabledKey, minutesKey]) => (
            <div key={label} className="flex items-center gap-3">
              <Switch
                aria-label={`${label}をカレンダーへ反映`}
                checked={form[enabledKey]}
                onCheckedChange={(checked) => patch({ [enabledKey]: checked })}
              />
              <span className="type-body-medium w-8 shrink-0">{label}</span>
              <Input
                aria-label={`${label}の所要時間（分）`}
                inputMode="numeric"
                placeholder="所要時間（分）"
                disabled={!home}
                value={form[minutesKey]}
                onChange={(event) => patch({ [minutesKey]: event.target.value })}
              />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {TRAVEL_MODES.map((candidate) => (
              <Button
                key={candidate}
                type="button"
                size="sm"
                variant={candidate === form.mode ? "secondary" : "outline"}
                className="rounded-full"
                aria-pressed={candidate === form.mode}
                onClick={() => patch({ mode: candidate })}
              >
                {TRAVEL_MODE_LABELS[candidate]}
              </Button>
            ))}
          </div>
        </>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={busy} onClick={save}>
          保存
        </Button>
        {message && (
          <span
            className={
              message.error
                ? "type-body-small text-error"
                : "type-body-small text-on-surface-variant"
            }
          >
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
