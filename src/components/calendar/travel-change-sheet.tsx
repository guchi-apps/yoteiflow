"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { applyDuration, dropGeneratedNote, type FixedSide } from "@/lib/travel-change";
import { cn } from "@/lib/utils";
import { TRAVEL_MODE_LABELS, TRAVEL_MODES, type TravelItem, type TravelMode } from "@/types/calendar";

import { isoToLocalInput, localInputToIso } from "./datetime-fields";
import { patchTravelTimes } from "./travel-time-patch";
import type { TouchedRange } from "./use-calendar-chunks";

type RouteOptions = {
  routes: { mode: TravelMode; minutes: number; isDefault: boolean }[];
  trains: { id: string; label: string; departMinutes: number; durationMinutes: number; note: string | null }[];
};

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * 移動の変更シート（issue #1466）。詳細ダイアログから、編集画面を開かずに移動方法と所要時間を直す。
 * 登録済みの所要時間・電車は設定 ▸ 勤務のもの。Yahoo!/Googleマップで調べるときは編集画面へ渡す。
 */
export function TravelChangeSheet({
  travel,
  timeZone,
  onCancel,
  onSaved,
  onSearch,
}: {
  travel: TravelItem;
  timeZone: string;
  onCancel: () => void;
  onSaved: (touched: TouchedRange[] | null) => void;
  /** 編集画面を、選んだ移動方法で開く（Yahoo!乗換案内・Googleマップで調べる）。 */
  onSearch: (mode: TravelMode) => void;
}) {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<TravelMode>(travel.mode);
  const [start, setStart] = useState(travel.start);
  const [end, setEnd] = useState(travel.end);
  const [note, setNote] = useState<string | null>(travel.note);
  const [fixed, setFixed] = useState<FixedSide>("arrive");
  const [options, setOptions] = useState<RouteOptions | null>(null);
  const [trainId, setTrainId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/travels/${encodeURIComponent(travel.id)}/route-options`)
      .then((response) => (response.ok ? (response.json() as Promise<RouteOptions>) : null))
      .then((value) => alive && setOptions(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [travel.id]);

  const minutes = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
  const registered = useMemo(
    () => new Map((options?.routes ?? []).map((row) => [row.mode, row.minutes])),
    [options],
  );

  const setMinutes = (next: number) => {
    const value = Math.min(1440, Math.max(1, Math.round(next)));
    const range = applyDuration(fixed, start, end, value);
    setStart(range.start);
    setEnd(range.end);
    setTrainId(null);
    setTouched(true);
  };

  const pickMode = (next: TravelMode) => {
    setMode(next);
    setTouched(true);
    setTrainId(null);
    const known = registered.get(next);
    if (known) {
      const range = applyDuration(fixed, start, end, known);
      setStart(range.start);
      setEnd(range.end);
    }
  };

  const pickTrain = (train: RouteOptions["trains"][number]) => {
    const date = isoToLocalInput(travel.start, timeZone).slice(0, 10);
    const base = localInputToIso(`${date}T00:00`, timeZone);
    const startMs = new Date(base).getTime() + train.departMinutes * 60_000;
    setStart(new Date(startMs).toISOString());
    setEnd(new Date(startMs + train.durationMinutes * 60_000).toISOString());
    setNote(train.note);
    setTrainId(train.id);
    setTouched(true);
  };

  const time = (iso: string) => isoToLocalInput(iso, timeZone).slice(11);

  const save = async () => {
    setSaving(true);
    setError(null);
    const message = await patchTravelTimes(travel, start, end, {
      mode,
      // 手段を変えたら自動生成の定型メモは外す。電車を選んだときはその経路テキストが入る
      note: dropGeneratedNote(note),
      estimateSource: "MANUAL",
      estimated: false,
    });
    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    setOpen(false);
    const first = travel.start < start ? travel.start : start;
    const last = travel.end > end ? travel.end : end;
    setTimeout(() => onSaved([{ start: first, end: last }]), 150);
  };

  const close = () => {
    setOpen(false);
    setTimeout(onCancel, 150);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>移動を変える</DialogTitle>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3 text-sm">
          <div>
            <p className="mb-1 text-xs text-on-surface-variant">移動方法</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="移動方法">
              {TRAVEL_MODES.map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  role="radio"
                  aria-checked={option === mode}
                  variant={option === mode ? "secondary" : "outline"}
                  className={cn(option === mode && "bg-travel-container text-on-travel-container")}
                  onClick={() => pickMode(option)}
                >
                  {TRAVEL_MODE_LABELS[option]}
                  {registered.get(option) ? ` ${registered.get(option)}分` : ""}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-xs text-on-surface-variant">分は設定 ▸ 勤務の既定の移動から。未登録は手で入れます。</p>
          </div>

          {mode === "PUBLIC_TRANSIT" && (options?.trains.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-xs text-on-surface-variant">登録済みの電車（設定 ▸ 勤務）</p>
              <div className="flex flex-wrap gap-1.5">
                {options!.trains.map((train) => (
                  <Button
                    key={train.id}
                    type="button"
                    size="sm"
                    variant={trainId === train.id ? "secondary" : "outline"}
                    onClick={() => pickTrain(train)}
                  >
                    {hhmm(train.departMinutes)}→{hhmm(train.departMinutes + train.durationMinutes)} {train.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {(mode === "PUBLIC_TRANSIT" || mode === "CAR") && (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onSearch(mode)}>
              {mode === "PUBLIC_TRANSIT" ? "Yahoo!乗換案内で別の経路を選ぶ" : "Googleマップで調べる"}
            </Button>
          )}

          <div>
            <p className="mb-1 text-xs text-on-surface-variant">所要時間</p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" aria-label="5分短く" onClick={() => setMinutes(minutes - 5)}>
                −5
              </Button>
              <label className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1440}
                  value={minutes}
                  onChange={(event) => event.target.value && setMinutes(Number(event.target.value))}
                  className="w-16 rounded-xs border border-outline-variant bg-transparent px-2 py-1 text-center text-base"
                  aria-label="所要時間（分）"
                />
                分
              </label>
              <Button type="button" variant="outline" size="sm" aria-label="5分長く" onClick={() => setMinutes(minutes + 5)}>
                ＋5
              </Button>
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs text-on-surface-variant">固定する側</p>
            <div className="flex gap-1.5" role="radiogroup" aria-label="固定する側">
              {(["arrive", "depart"] as const).map((side) => (
                <Button
                  key={side}
                  type="button"
                  size="sm"
                  role="radio"
                  aria-checked={fixed === side}
                  variant={fixed === side ? "secondary" : "outline"}
                  onClick={() => setFixed(side)}
                >
                  {side === "arrive" ? `到着 ${time(end)}` : `出発 ${time(start)}`}
                </Button>
              ))}
            </div>
          </div>

          <p className="text-on-surface-variant">
            結果: {time(start)} – {time(end)}
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <Button type="button" disabled={saving || !touched} onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          閉じる
        </Button>
      </DialogContent>
    </Dialog>
  );
}
