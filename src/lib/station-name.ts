/**
 * 最寄り駅の駅名の扱い（docs/spec.md §29・issue #1356）。
 *
 * 保存と表示は「梅田駅」の形にそろえ、Yahoo!乗換案内へ渡す直前だけ末尾の「駅」を外す。
 * 保存値は変えないので、場所DB・画面表示には影響しない。
 */

/** 末尾が「駅」でなければ「駅」を補う。空・空白だけは null（最寄り駅を消す）。 */
export function ensureStationSuffix(value: string | null | undefined): string | null {
  const station = value?.trim();
  if (!station) return null;
  return station.endsWith("駅") ? station : `${station}駅`;
}

/**
 * Yahoo!乗換案内の検索語にする駅名。末尾が「駅」で、外した残りが1文字以上のときだけ外す。
 * 「駅」だけの値や「駅前」のように末尾が駅でない値は触らない。
 */
export function yahooSearchStationName(station: string): string {
  const value = station.trim();
  if (value.length > 1 && value.endsWith("駅")) return value.slice(0, -1);
  return value;
}

/** 場所の最寄り駅の1件（issue #1607）。徒歩は0〜180分の整数、分からなければ null。 */
export type PlaceStation = { name: string; minutes: number | null };

/** 1つの場所に持てる最寄り駅の上限。Notionの rich_text 1欄に収める目安。 */
export const MAX_PLACE_STATIONS = 10;

/** 0〜180の整数だけを徒歩分として扱う。範囲外・小数は読まない。 */
export function normalizeStationMinutes(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 && rounded <= 180 ? rounded : null;
}

// 「高槻駅 20分」「高槻駅（徒歩20分）」「高槻駅 徒歩20分」の末尾の分を読む。
const MINUTES_SUFFIX = /^(.*?)[\s　]*[(（]?[\s　]*(?:徒歩)?[\s　]*(\d{1,3})[\s　]*分[\s　]*[)）]?$/;

/**
 * Notionの「最寄り駅」欄（rich_text）を駅の一覧に読む（docs/spec.md §29・issue #1607）。
 *
 * 1行1駅で、末尾に「20分」があれば徒歩分として読む。Notionで手で書かれた「高槻駅、高槻市駅」の
 * ような読点・カンマ区切りも受ける。**徒歩分の正は行内の値**で、`fallbackMinutes`（「最寄り駅までの
 * 時間」の数値の列＝先頭駅の写し）は先頭の駅に分が書かれていないときだけ補う。従来の1駅だけの
 * データ（駅名だけ＋数値の列）は、そのまま1件として読める。
 * 読むときは「駅」を補わない（保存時だけ補う。手で書かれた「駅前」のような値を書き換えないため）。
 */
export function parseStations(text: string | null | undefined, fallbackMinutes?: number | null): PlaceStation[] {
  if (!text) return [];
  const stations: PlaceStation[] = [];
  for (const raw of text.split(/[\n\r、,，;；]+/)) {
    const piece = raw.trim();
    if (!piece) continue;
    const match = MINUTES_SUFFIX.exec(piece);
    const name = (match ? match[1] : piece).trim();
    if (!name || stations.some((station) => station.name === name)) continue;
    stations.push({ name, minutes: match ? normalizeStationMinutes(Number(match[2])) : null });
  }
  const fallback = normalizeStationMinutes(fallbackMinutes);
  if (stations.length > 0 && stations[0].minutes === null && fallback !== null) {
    stations[0] = { ...stations[0], minutes: fallback };
  }
  return stations;
}

/**
 * 画面・APIから受けた駅の一覧を保存できる形へ揃える。駅名は「駅」を補い、空行と重複を落とし、
 * 上限で切る。
 */
export function normalizeStations(stations: ReadonlyArray<{ name?: unknown; minutes?: unknown }>): PlaceStation[] {
  const result: PlaceStation[] = [];
  for (const station of stations) {
    const name = ensureStationSuffix(typeof station.name === "string" ? station.name : null);
    if (!name || result.some((existing) => existing.name === name)) continue;
    const minutes = typeof station.minutes === "number" ? normalizeStationMinutes(station.minutes) : null;
    result.push({ name, minutes });
    if (result.length >= MAX_PLACE_STATIONS) break;
  }
  return result;
}

/** Notionの「最寄り駅」欄へ書く文字列。1行1駅、分があれば「高槻駅 20分」。空なら空文字。 */
export function formatStations(stations: readonly PlaceStation[]): string {
  return stations.map((station) => (station.minutes === null ? station.name : `${station.name} ${station.minutes}分`)).join("\n");
}

/** 画面の一覧に添える短い表記（「高槻駅・高槻市駅」）。 */
export function stationsLabel(stations: readonly PlaceStation[]): string {
  return stations.map((station) => station.name).join("・");
}

/**
 * 場所の最寄り駅の一覧。`stations` を持たない値（Service Workerに残る古い応答・テストの固定値）は、
 * 従来の `station` / `stationMinutes` を1件として扱う。
 */
export function placeStations(place: {
  station?: string | null;
  stationMinutes?: number | null;
  stations?: PlaceStation[];
}): PlaceStation[] {
  if (place.stations) return place.stations;
  return place.station ? [{ name: place.station, minutes: normalizeStationMinutes(place.stationMinutes) }] : [];
}

/**
 * APIの本文で受けた駅の一覧。配列でなければ null（形の違う要求として断る）。
 * 要素は `{ name, minutes }` だけを読み、それ以外の形は落とす。
 */
export function readStationsBody(value: unknown): PlaceStation[] | null {
  if (!Array.isArray(value)) return null;
  return normalizeStations(
    value.filter((item): item is { name?: unknown; minutes?: unknown } => typeof item === "object" && item !== null),
  );
}

/**
 * 乗る駅・降りる駅の選び方（issue #1607）。`undefined` は既定（先頭の駅）、`null` は「地点で探す」
 * （駅を使わず座標・住所のドアtoドア）、文字列はその駅名。登録に無い駅名は既定へ落ちる。
 */
export type StationChoice = string | null | undefined;

/** 選び方から実際に使う駅。駅を使わないときは null。 */
export function chooseStation(stations: readonly PlaceStation[], choice: StationChoice): PlaceStation | null {
  if (choice === null) return null;
  return stations.find((station) => station.name === choice) ?? stations[0] ?? null;
}
