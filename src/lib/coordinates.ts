/**
 * 緯度経度の受け渡しと、タイル地図で使うWebメルカトルの変換（docs/spec.md §9）。
 *
 * 地図の位置は緯度経度で持ち、ピクセルはそのつど求める。ピクセルで持ち回ると、
 * ズームを変えるたびに保持している値を全部作り直すことになる（時間グリッドの位置を
 * 分で持ち、pxはその都度求めているのと同じ考え方）。
 */

export type LatLng = { lat: number; lng: number };

/** タイル1枚の一辺（px）。OpenStreetMapのラスタタイルは256px。 */
export const TILE_SIZE = 256;

/**
 * Webメルカトルで表せる緯度の限界。これを超えるとyが発散するため、極側はここで止める。
 */
const MAX_LATITUDE = 85.05112878;

/** 場所DBへ書く形。小数6桁あれば0.1m程度まで表せる。 */
export function formatCoordinates(point: LatLng): string {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

/**
 * 場所DBに入っている文字列を座標として読む。
 * 手で書いた行も混ざりうるため、数値2つとして読めないものはnullにして候補から落とす。
 */
export function parseCoordinates(text: string | null | undefined): LatLng | null {
  if (!text) return null;

  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,/\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return { lat, lng };
}

/**
 * 受け取った値を座標として読めるか。
 *
 * APIの本文（`{ lat, lng }`）はブラウザから来るため、形だけでなく範囲も確かめる。
 * parseCoordinates と同じ条件にして、場所DBの文字列から読んだ値と扱いを揃える。
 */
export function isLatLng(value: unknown): value is LatLng {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * クエリの `lat` / `lon` を地点として読む。**両方が値として来ているときだけ**地点にする。
 *
 * `Number(null)` も `Number("")` も 0 になるため、`Number(params.get("lat"))` を
 * そのまま `Number.isFinite()` に掛けると、`lat` も `lon` も付いていない要求まで
 * 「緯度0・経度0」として読めてしまう。`/api/places/geocode` ではこれで `?q=`（地名から
 * 地点を引く）の要求が逆ジオコーディングとして扱われ、Nominatimがギニア湾の海上を
 * 該当なしとして返し、地図が0,0へ飛んでいた（issue #471）。
 */
export function parsePointParams(params: URLSearchParams): LatLng | null {
  const lat = params.get("lat")?.trim();
  const lon = params.get("lon")?.trim();
  if (!lat || !lon) return null;

  // 範囲まで確かめる。読めない値は地点として扱わない（呼び出し元は `q` の側へ落とせる）。
  const point = { lat: Number(lat), lng: Number(lon) };
  return isLatLng(point) ? point : null;
}

export function clampLatitude(lat: number): number {
  return Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
}

/** 経度は東西でつながっている。-180〜180の範囲へ畳む。 */
export function wrapLongitude(lng: number): number {
  const wrapped = ((lng + 180) % 360 + 360) % 360;
  return wrapped - 180;
}

/** 緯度経度 → そのズームでの世界のピクセル座標。 */
export function project(point: LatLng, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const lat = (clampLatitude(point.lat) * Math.PI) / 180;

  return {
    x: ((point.lng + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * scale,
  };
}

/** 世界のピクセル座標 → 緯度経度。project の逆。 */
export function unproject(pixel: { x: number; y: number }, zoom: number): LatLng {
  const scale = TILE_SIZE * 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * pixel.y) / scale;

  return {
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
    lng: wrapLongitude((pixel.x / scale) * 360 - 180),
  };
}

/** 赤道上の地球1周（m）。Webメルカトルの縮尺の基準。 */
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;

/**
 * 実距離（m）→ そのズーム・緯度での画面上のピクセル数。現在地の精度円を描くのに使う。
 * Webメルカトルは高緯度ほど引き伸ばされるため、緯度のcosで割り戻す。
 */
export function metersToPixels(meters: number, lat: number, zoom: number): number {
  const cos = Math.cos((clampLatitude(lat) * Math.PI) / 180);
  const metersPerPixel = (EARTH_CIRCUMFERENCE_METERS * cos) / (TILE_SIZE * 2 ** zoom);
  return meters / metersPerPixel;
}

/** 2点がほぼ同じ地点か。住所を調べ直すかどうかの判定に使う（既定はおよそ1m）。 */
export function isSamePoint(a: LatLng, b: LatLng, tolerance = 0.00001): boolean {
  return Math.abs(a.lat - b.lat) < tolerance && Math.abs(a.lng - b.lng) < tolerance;
}

/**
 * 座標の集合がすべて枠に収まる中心とズームを求める（場所画面の地図・issue #1364）。
 *
 * 枠の大きさ（px）で入るズームが変わるため、幅・高さを受ける。`padding` は枠の四辺に
 * 残す余白で、ピンの絵（点より上へ伸びる）が枠の端で切れないようにする。
 * 1件のときは広がりが無くズームが決まらないため `singleZoom` に固定する。0件は中心を
 * 決められないため null を返し、呼び出し側の既定の中心へ任せる。
 *
 * 経度は単純に最小・最大で見る。日付変更線をまたぐ集合は考えない（国内で使う前提）。
 */
export function fitBounds(
  points: LatLng[],
  size: { width: number; height: number },
  { padding = 48, minZoom = 3, maxZoom = 17, singleZoom = 15 } = {},
): { center: LatLng; zoom: number } | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { center: points[0], zoom: singleZoom };

  // ズーム0の世界座標で外接矩形を取る。ズームが1上がるごとに2倍になるので、
  // 枠の幅・高さとの比から入るズームを逆算できる。
  const pixels = points.map((point) => project(point, 0));
  const minX = Math.min(...pixels.map((p) => p.x));
  const maxX = Math.max(...pixels.map((p) => p.x));
  const minY = Math.min(...pixels.map((p) => p.y));
  const maxY = Math.max(...pixels.map((p) => p.y));

  const center = unproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, 0);

  const usableWidth = Math.max(1, size.width - padding * 2);
  const usableHeight = Math.max(1, size.height - padding * 2);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const zoomX = spanX > 0 ? Math.log2(usableWidth / spanX) : maxZoom;
  const zoomY = spanY > 0 ? Math.log2(usableHeight / spanY) : maxZoom;
  // 整数へ切り下げる。タイルが整数のズームにしか無く、端数のままだと拡大縮小した
  // タイルで見せることになりぼやける。切り下げなら必ず収まる側に倒れる。
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.floor(Math.min(zoomX, zoomY))));

  return { center, zoom };
}
