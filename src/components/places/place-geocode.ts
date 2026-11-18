import { isLatLng, type LatLng } from "@/lib/coordinates";

/**
 * 場所の編集画面の地図が使う、住所⇔地点の問い合わせ（`/api/places/geocode`）。
 *
 * `PlaceMapDialog`（calendar/place-map-dialog.tsx）が同じ呼び出しをインラインで持っている。
 * あちらは予定・移動の場所欄・勤務場所の住所・地図からの新規登録が共有しており、影響を避けるため
 * 触らず、この画面に必要な2つだけをここへ置く（意図的な複製）。
 */

/** 地図が止まってから住所を調べるまでの待ち。Nominatim は1秒に1回まで。 */
export const REVERSE_LOOKUP_DELAY_MS = 700;

/** 住所（地名）から地点を引く。見つからない・失敗・座標として読めない値は null。 */
export async function searchAddressPoint(text: string): Promise<LatLng | null> {
  try {
    const response = await fetch(`/api/places/geocode?q=${encodeURIComponent(text)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { place: { lat: number; lng: number } | null };
    if (!body.place) return null;
    const found = { lat: body.place.lat, lng: body.place.lng };
    return isLatLng(found) ? found : null;
  } catch {
    return null;
  }
}

/** 地点から住所を引く。取れなければ null（呼び出し側は住所を触らない）。 */
export async function reverseAddress(point: LatLng): Promise<string | null> {
  try {
    const response = await fetch(`/api/places/geocode?lat=${point.lat}&lon=${point.lng}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { place: { address: string | null } | null };
    return body.place?.address ?? null;
  } catch {
    return null;
  }
}
