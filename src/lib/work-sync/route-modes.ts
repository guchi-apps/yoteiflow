import type { RouteLookup } from "@/lib/work-sync/plan";
import { TRAVEL_MODES, type TravelMode } from "@/types/calendar";

/**
 * 勤務先の既定の移動を、方法（車・公共交通・徒歩・その他）ごとに扱う純粋関数（issue #1447）。
 * 「出発地 → 行き先」の組ごとに方法別の行を持ち、isDefault の行が既定の方法。
 */

export type RouteModeRow = {
  origin: string;
  destination: string;
  mode: TravelMode;
  minutes: number;
  isDefault: boolean;
  /** 同じ組に既定が複数あるとき、新しい行を採るための値（ミリ秒）。 */
  updatedAt?: number;
};

const modeRank = (mode: TravelMode) => TRAVEL_MODES.indexOf(mode);

/**
 * 組の既定の行。isDefault の行（複数なら更新が新しいもの）、無ければ固定順（車→公共交通→徒歩→その他）の先頭。
 * 並びに依らず同じ答えになる。
 */
export function pickDefaultRoute<T extends RouteModeRow>(rows: T[]): T | null {
  const flagged = rows
    .filter((row) => row.isDefault)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || modeRank(a.mode) - modeRank(b.mode));
  if (flagged.length > 0) return flagged[0];
  return [...rows].sort((a, b) => modeRank(a.mode) - modeRank(b.mode))[0] ?? null;
}

/** 方法を省略すれば既定の方法の行、指定すればその方法の行（無ければ null）を返す。 */
export function buildRouteLookup(rows: RouteModeRow[]): RouteLookup {
  const byPair = new Map<string, RouteModeRow[]>();
  for (const row of rows) {
    const key = `${row.origin}\n${row.destination}`;
    byPair.set(key, [...(byPair.get(key) ?? []), row]);
  }
  return (origin, destination, mode) => {
    const pair = byPair.get(`${origin}\n${destination}`) ?? [];
    const row = mode ? (pair.find((candidate) => candidate.mode === mode) ?? null) : pickDefaultRoute(pair);
    return row ? { minutes: row.minutes, mode: row.mode } : null;
  };
}

/** 基準の電車を決めるのに要る値（`WorkTrainItem` の一部）。 */
export type TransitTrain = { isDefault: boolean; departMinutes: number; durationMinutes: number };

/**
 * 公共交通の所要時間の基準にする電車（issue #1458）。デフォルト（★）の電車、無ければ出発が最も早い電車。
 * 組に電車が無ければ null（その場合は手入力の分を使う）。
 */
export function transitBaseTrain<T extends TransitTrain>(trains: T[]): T | null {
  const byDepart = [...trains].sort((a, b) => a.departMinutes - b.departMinutes);
  return byDepart.find((train) => train.isDefault) ?? byDepart[0] ?? null;
}

/** 基準の電車の所要分 + 徒歩。組に電車が無ければ null。 */
export function transitMinutes(trains: TransitTrain[], walkMinutes: number): number | null {
  const base = transitBaseTrain(trains);
  return base ? base.durationMinutes + Math.max(0, walkMinutes) : null;
}

/** 公共交通の所要分の上限（`WorkRouteDefault` の検証と同じ）。 */
export const MAX_ROUTE_MINUTES = 1440;
