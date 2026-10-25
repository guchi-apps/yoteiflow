"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WorkTrains } from "@/components/settings/work-trains";
import { fromTime, toTime } from "@/lib/work-sync/form";
import type { WorkTrainItem } from "@/lib/work-sync/plan";
import type { WorkPlaceLinkRow } from "@/lib/work-place-link";

import { WorkPlaceLinkFields, type LinkablePlace } from "./work-place-link-fields";
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

export type Entry = { key: string; isTrip: boolean };

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
 * 勤務先・出張先ごとの既定値（issue #1099・docs/spec.md §46）。勤務場所の詳細画面（issue #1405）の一部。
 *
 * 勤務時間・往路・復路のカレンダー反映の有無と、勤務開始・終了、往路・復路の所要時間を持つ。
 * 勤務入力で選ぶと、ここの値が初期表示になる。ここを変えても、保存済みの勤務記録・予定は
 * 変えない（記録ごとの値を優先し、すでに作った予定にも触れない）。時刻を空にすると共通設定を使う。
 * 移動の出発地は設定の「移動」の既定の出発地。在宅として扱う勤務先は移動を作らない。
 */
export function PlaceDefaultFields({
  entry,
  remote,
  home,
  linkablePlaces,
  link,
  onSavedLinks,
  row,
  out,
  back,
  trains,
  commonStart,
  commonEnd,
  onSavedDefaults,
  onSavedRoutes,
}: {
  entry: Entry;
  remote: boolean;
  home: string | null;
  linkablePlaces: LinkablePlace[];
  link: WorkPlaceLinkRow | null;
  onSavedLinks: (links: WorkPlaceLinkRow[]) => void;
  row: WorkPlaceDefaultRow | null;
  out: WorkRouteRow | null;
  back: WorkRouteRow | null;
  trains: WorkTrainItem[];
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
    <div className="flex flex-col gap-3">
      <h3 className="type-title-small">勤務時間</h3>
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
          <h3 className="type-title-small">移動{home ? `（出発地: ${home}）` : ""}</h3>
          {!home && (
            <p className="type-body-small text-on-surface-variant">
              移動を反映するには、先に
              <Link href="/settings/travel" className="underline">
                設定の「移動」
              </Link>
              で既定の出発地を入れてください。
            </p>
          )}
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
                aria-pressed={candidate === form.mode}
                onClick={() => patch({ mode: candidate })}
              >
                {TRAVEL_MODE_LABELS[candidate]}
              </Button>
            ))}
          </div>
        </>
      )}

      {!remote && <WorkTrains trains={trains} home={home} place={entry.key} />}
      {!entry.isTrip && (
        <WorkPlaceLinkFields
          workPlace={entry.key}
          places={linkablePlaces}
          link={link}
          onSaved={onSavedLinks}
        />
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
