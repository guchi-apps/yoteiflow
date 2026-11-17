/**
 * OpenStreetMapのNominatimで、地点 ⇄ 住所を引く（docs/spec.md §9）。
 *
 * **必ずサーバー側から呼ぶ。** Nominatimは呼び出し元を名乗るUser-Agentを要求するが、
 * ブラウザのfetchではUser-Agentを差し替えられない。APIキーは要らないが、
 * 1秒に1回を超える連続呼び出しは禁じられているため、画面側では地図が止まってから1回だけ呼ぶ。
 *
 * 取得できなくても場所の登録は通す（緯度経度を住所として登録する）。住所は登録を助ける
 * ためのもので、これが無いと登録できないという性質のものではない。
 */

import { composeJapaneseAddress, type JapaneseAddressParts } from "./japanese-address";

const NOMINATIM_API = "https://nominatim.openstreetmap.org";

/** 呼び出し元を名乗る。Nominatimの利用規約が求めており、名乗らないと遮断されうる。 */
const USER_AGENT = "DaySpan/1.0 (+https://github.com/guchi-apps/yoteiflow)";

/** 返答が遅いときに画面を待たせ続けない。住所は無くても登録は通せる。 */
const TIMEOUT_MS = 8000;

export type GeocodedPlace = {
  /** 施設名・交差点名など。地点に名前が無いこともある。 */
  name: string | null;
  /** 組み立てた住所。読めなければnull。 */
  address: string | null;
  /**
   * 日本の地点のときだけ、住所の部品をそのまま添える。
   *
   * Nominatimは街区符号を落とすため、番地まで出すにはOverpassの生タグと突き合わせる
   * （`resolve-point.ts`）。そのとき、Overpass側に欠けている都道府県・市区町村を
   * ここから補う。日本以外はnull（組み立ての順番が国ごとに違い、部品では扱えない）。
   */
  japanese: JapaneseAddressParts | null;
  lat: number;
  lng: number;
};

type NominatimAddress = Record<string, string | undefined>;

type NominatimPlace = {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  address?: NominatimAddress;
};

/**
 * 都道府県を取り出す。
 *
 * 東京23区では `address` に都道府県のキーが入らず、`city` が「渋谷区」から始まる
 * （東京都は `display_name` の中にだけ現れる）。ここを落とすと「渋谷区渋谷二丁目」のように
 * 都道府県の無い住所になるため、無いときは `display_name` の要素から拾う。
 */
function prefectureOf(address: NominatimAddress, displayName: string | undefined): string | undefined {
  const named = address.province ?? address.state;
  if (named) return named;

  return displayName
    ?.split(",")
    .map((part) => part.trim())
    .find((part) => /^.{2,4}[都道府県]$/.test(part));
}

/**
 * Nominatimの `address` を住所の部品へ移す。組み立ては `composeJapaneseAddress()` が行う。
 *
 * `house_number` をそのまま渡すのは、Nominatimが街区符号を落とすため
 * 「21-1」の形で入っていることがあるから。街区符号の無い裸の号は組み立て側で落とす。
 */
function japanesePartsOf(place: NominatimPlace): JapaneseAddressParts {
  const address = place.address ?? {};

  return {
    province: prefectureOf(address, place.display_name),
    city: address.city ?? address.town ?? address.village ?? address.county,
    district: address.city_district,
    suburb: address.suburb,
    quarter: address.quarter,
    neighbourhood: address.neighbourhood,
    houseNumber: address.house_number,
  };
}

function isJapan(place: NominatimPlace): boolean {
  return place.address?.country_code === "jp";
}

function toAddress(place: NominatimPlace): string | null {
  if (!place.address) return place.display_name?.trim() || null;

  if (isJapan(place)) return composeJapaneseAddress(japanesePartsOf(place));

  // 日本以外は組み立ての順番が国ごとに違う。Nominatimの表記をそのまま使う。
  return place.display_name?.trim() || null;
}

async function requestNominatim(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(path, NOMINATIM_API);
  for (const [key, value] of Object.entries({ format: "jsonv2", "accept-language": "ja", ...params })) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Nominatim returned ${response.status}`);
  }

  return response.json();
}

/** 地点から住所と施設名を引く（逆ジオコーディング）。 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodedPlace> {
  const json = (await requestNominatim("/reverse", {
    lat: String(lat),
    lon: String(lng),
    // 建物・施設の粒度。これより細かくすると番地だけが返り、施設名が落ちる。
    zoom: "18",
  })) as NominatimPlace & { error?: string };

  // 海上など該当が無い地点では error だけが返る。失敗ではないので、名前も住所も無い形で返す。
  if (json.error || !json.address) return { name: null, address: null, japanese: null, lat, lng };

  return {
    name: json.name?.trim() || null,
    address: toAddress(json),
    japanese: isJapan(json) ? japanesePartsOf(json) : null,
    lat,
    lng,
  };
}

function toGeocoded(item: NominatimPlace): GeocodedPlace | null {
  if (!item.lat || !item.lon) return null;
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    name: item.name?.trim() || null,
    address: toAddress(item),
    japanese: isJapan(item) ? japanesePartsOf(item) : null,
    lat,
    lng,
  };
}

/** 地名・施設名から候補を複数件引く（名前の入力候補用。issue #1676）。 */
export async function searchPlaces(query: string, limit: number): Promise<GeocodedPlace[]> {
  const json = (await requestNominatim("/search", {
    q: query,
    limit: String(limit),
    addressdetails: "1",
  })) as NominatimPlace[];
  if (!Array.isArray(json)) return [];
  return json.map(toGeocoded).filter((place): place is GeocodedPlace => place !== null);
}

/** 地名・施設名から地点を引く（前方ジオコーディング）。見つからなければnull。 */
export async function searchPlace(query: string): Promise<GeocodedPlace | null> {
  // addressdetails を付けないと `address` が返らず、住所を組み立てられない。
  return (await searchPlaces(query, 1))[0] ?? null;
}
