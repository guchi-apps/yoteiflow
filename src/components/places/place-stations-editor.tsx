"use client";

import { ArrowUp, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MAX_PLACE_STATIONS, normalizeStationMinutes, type PlaceStation } from "@/lib/station-name";

/** 編集中の1行。徒歩は打っている途中の文字列のまま持ち、保存時に検証する。 */
export type StationRow = { key: number; name: string; minutes: string };

let nextKey = 0;
export const newStationRow = (station?: PlaceStation): StationRow => ({
  key: nextKey++,
  name: station?.name ?? "",
  minutes: station?.minutes == null ? "" : String(station.minutes),
});

/**
 * 編集中の行を保存できる一覧へ直す。駅名が空の行は落とす。徒歩が0〜180の整数でない行があれば
 * `error` を返す（黙って捨てると、入れた徒歩が保存されなかった理由が読めない）。
 */
export function rowsToStations(rows: StationRow[]): { stations: PlaceStation[] } | { error: string } {
  const stations: PlaceStation[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    const text = row.minutes.trim();
    const minutes = text === "" ? null : normalizeStationMinutes(Number(text));
    if (text !== "" && (minutes === null || !Number.isInteger(Number(text)))) {
      return { error: "駅までの徒歩は0〜180分の整数で入力してください。" };
    }
    stations.push({ name, minutes });
  }
  return { stations };
}

/**
 * 最寄り駅の一覧の編集（issue #1607）。1行＝駅名＋徒歩（分）で、上の駅ほど優先する。
 * 移動の入力でYahoo!乗換案内を開くとき、駅が2つ以上あれば乗る駅を選べ、初期は一番上の駅になる。
 *
 * 駅名の候補（issue #1356）は呼び出し側が取って渡す。フォーカスしている行の下にだけ出す。
 */
export function PlaceStationsEditor({
  rows,
  onChange,
  candidates,
  focusedKey,
  onFocusRow,
}: {
  rows: StationRow[];
  onChange: (rows: StationRow[]) => void;
  candidates: { name: string; distanceM: number }[];
  focusedKey: number | null;
  onFocusRow: (key: number | null) => void;
}) {
  const update = (key: number, patch: Partial<StationRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: number) => onChange(rows.filter((row) => row.key !== key));
  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...rows];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  };
  const taken = new Set(rows.map((row) => row.name.trim()));

  return (
    <div className="flex flex-col gap-2">
      <p className="type-label-large text-on-surface">最寄り駅</p>
      {rows.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-outline-variant">
          {rows.map((row, index) => {
            const typed = row.name.trim();
            const visible =
              focusedKey === row.key
                ? candidates.filter(
                    (candidate) => !taken.has(candidate.name) && candidate.name.includes(typed.replace(/駅$/, "")),
                  )
                : [];
            return (
              <li key={row.key} className="border-t border-outline-variant first:border-t-0">
                <div className="flex items-center gap-1.5 px-2 py-2">
                  {index === 0 && rows.length > 1 && (
                    <span className="type-label-small hidden shrink-0 rounded-sm bg-secondary-container px-1.5 py-0.5 text-on-secondary-container sm:inline">
                      優先
                    </span>
                  )}
                  <input
                    aria-label={`最寄り駅 ${index + 1}の駅名`}
                    placeholder="駅名"
                    value={row.name}
                    onChange={(event) => update(row.key, { name: event.target.value })}
                    onFocus={() => onFocusRow(row.key)}
                    onBlur={() => onFocusRow(null)}
                    className="type-body-medium min-w-0 flex-1 rounded-xs bg-surface-container-highest px-2.5 py-1.5 text-on-surface outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <label className="flex shrink-0 items-center gap-1 rounded-xs bg-surface-container-highest px-2 py-1.5">
                    <span className="type-body-small text-on-surface-variant">徒歩</span>
                    <input
                      aria-label={`${typed || `最寄り駅 ${index + 1}`}までの徒歩（分）`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={180}
                      placeholder="—"
                      value={row.minutes}
                      onChange={(event) => update(row.key, { minutes: event.target.value })}
                      className="type-body-medium w-10 bg-transparent text-right text-on-surface outline-none"
                    />
                    <span className="type-body-small text-on-surface-variant">分</span>
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${typed || `最寄り駅 ${index + 1}`}を上へ`}
                    disabled={index === 0}
                    className={index === 0 ? "invisible" : undefined}
                    onClick={() => moveUp(index)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${typed || `最寄り駅 ${index + 1}`}を外す`}
                    onClick={() => remove(row.key)}
                  >
                    <X />
                  </Button>
                </div>
                {visible.length > 0 && (
                  <ul className="mx-2 mb-2 overflow-hidden rounded-lg border border-outline-variant">
                    {visible.map((candidate) => (
                      <li key={candidate.name} className="border-t border-outline-variant first:border-t-0">
                        <button
                          type="button"
                          // blurより先に選択を確定させる（候補が消えて押せなくなるのを防ぐ）。
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => update(row.key, { name: candidate.name })}
                          className="type-body-medium flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-container"
                        >
                          <span>{candidate.name}</span>
                          <span className="type-body-small text-on-surface-variant">約{candidate.distanceM}m</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length < MAX_PLACE_STATIONS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onChange([...rows, newStationRow()])}
        >
          <Plus />
          駅を追加
        </Button>
      )}
      <p className="type-body-small text-on-surface-variant">
        「梅田」と入れると「梅田駅」で保存します。上の駅ほど優先し、電車の移動でYahoo!乗換案内を開くときは最初に一番上の駅を選んだ状態になります（駅が2つ以上あれば乗る駅を選べます）。徒歩は、予定の場所がその駅から離れているぶん検索時刻をずらすのに使います。駅が空のときは地点（無ければ住所）で探します。
      </p>
    </div>
  );
}
