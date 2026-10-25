/**
 * OverpassでOSMの生タグを読み、地点のいちばん近くにある番地を引く（docs/spec.md §9）。
 *
 * Nominatimは日本の住所から街区符号（`addr:block_number`）を落とすため、逆ジオコーディング
 * だけでは「渋谷二丁目1」までしか組み立てられない（正しくは渋谷2-21-1）。街区符号はOSMの
 * 生タグには入っており、それを読めるのがOverpassになる（issue #453）。
 *
 * **必ずサーバー側から呼ぶ。** Nominatimと同じく呼び出し元を名乗るUser-Agentが要る。
 * 無償の共用サーバーのため、呼ぶのは地図が止まったときの1回だけにする。
 * 取得できなくても住所は組み立てられる（丁目までに落ちるだけ）ので、失敗は投げずnullで返す。
 */

import type { JapaneseAddressParts } from "./japanese-address";

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

/** 呼び出し元を名乗る。Nominatimと同じ理由。 */
const USER_AGENT = "DaySpan/1.0 (+https://github.com/guchi-apps/yoteiflow)";

/**
 * 番地を引くのに使ってよい時間の合計。Nominatimの上限と同じ長さにする。
 *
 * 無償の共用サーバーで、混んでいると順番待ちになり504・切断も返る。予備のサーバーは
 * 並べていない（kumi.systems・osm.jp・private.coffeeは応答せず、osm.chはスイスのデータ
 * しか持たず、maps.mail.ruは応答するが13秒かかるうえ地点を国外のサーバーへ渡すことになる）。
 * 取れなければ丁目までの住所に落ちるだけなので、待ちを延ばしてまで粘らない。
 */
const TOTAL_BUDGET_MS = 8000;

/**
 * だめだったときに、残り時間で1回だけやり直す。
 *
 * 混んでいるときの失敗は2〜4秒で返ってくることが多く（504・接続の切断）、そこで諦めると
 * 使える時間を半分残したまま丁目までの住所に落ちる。やり直しは残り時間の中で行うので、
 * 地図を止めてから住所が出るまでの上限は変わらない。
 */
const MAX_ATTEMPTS = 2;

/** 残りがこれ未満ならやり直さない。間に合わない要求を出しても待ちが延びるだけ。 */
const MIN_ATTEMPT_MS = 2000;

/**
 * 地点からこの距離までの番地を候補にする。
 *
 * 密な市街地では最寄りが数十m以内に見つかる（実測で渋谷37m・中之島12m・豊中42m）。
 * 広げすぎると道路を挟んだ別の街区まで拾うため、街区1つぶんの見当で切る。
 */
const RADIUS_M = 120;

/**
 * 受け取る番地の件数の上限。
 *
 * Overpassは距離順には返さない（`out` の件数指定は先頭から切るだけ）。切りすぎると
 * いちばん近い番地がその外に落ちるため、密な市街地で入る件数（実測で渋谷の120m以内に59件）に
 * 余裕を持たせる。上限を置くのは、応答の大きさを見込めるようにするため。
 */
const MAX_ELEMENTS = 200;

type OverpassElement = {
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string | undefined>;
};

/** 緯度経度の差から、比べるためだけの距離を出す。順位が付けばよいので平面で足りる。 */
function squaredDistance(lat: number, lng: number, targetLat: number, targetLng: number): number {
  const dLat = targetLat - lat;
  const dLng = (targetLng - lng) * Math.cos((lat * Math.PI) / 180);
  return dLat * dLat + dLng * dLng;
}

function toParts(tags: Record<string, string | undefined>): JapaneseAddressParts {
  return {
    province: tags["addr:province"],
    city: tags["addr:city"],
    district: tags["addr:district"],
    suburb: tags["addr:suburb"],
    quarter: tags["addr:quarter"],
    neighbourhood: tags["addr:neighbourhood"],
    // 街区符号は `addr:block_number` が標準だが、`addr:block` で入っている地物もある。
    block: tags["addr:block_number"] ?? tags["addr:block"],
    houseNumber: tags["addr:housenumber"],
  };
}

/**
 * 地点にいちばん近い番地のタグを返す。見つからなければnull。
 *
 * ノード・ウェイ・リレーションのどれで描かれていても拾う（建物はウェイ、店舗はノードが多い）。
 * ウェイ・リレーションの位置は `out center` が返す重心で見る。
 */
export async function nearestAddressTags(
  lat: number,
  lng: number,
): Promise<JapaneseAddressParts | null> {
  const query = `[out:json][timeout:${Math.floor(TOTAL_BUDGET_MS / 1000)}];nwr(around:${RADIUS_M},${lat},${lng})["addr:housenumber"];out tags center ${MAX_ELEMENTS};`;

  const elements = await requestOverpass(query);
  if (!elements) return null;

  let best: { distance: number; tags: Record<string, string | undefined> } | null = null;
  for (const element of elements) {
    const elementLat = element.lat ?? element.center?.lat;
    const elementLng = element.lon ?? element.center?.lon;
    if (!element.tags || elementLat === undefined || elementLng === undefined) continue;

    const distance = squaredDistance(lat, lng, elementLat, elementLng);
    if (!best || distance < best.distance) best = { distance, tags: element.tags };
  }

  return best ? toParts(best.tags) : null;
}

/** Overpassへ問い合わせて地物を渡す。取れなければnull（住所は丁目までに落ちる）。 */
async function requestOverpass(query: string): Promise<OverpassElement[] | null> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) break;

    try {
      const response = await fetch(OVERPASS_API, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(remaining),
        cache: "no-store",
      });
      if (!response.ok) continue;

      const json = (await response.json()) as { elements?: OverpassElement[] };
      return Array.isArray(json.elements) ? json.elements : [];
    } catch {
      // 混雑・timeout・接続の切断。残り時間があればもう一度だけ試す。
    }
  }

  return null;
}

/** 駅の候補を探す半径。徒歩圏より広めに取り、乗り換え先の駅も候補に入れる。 */
const STATION_RADIUS_M = 2000;
const STATION_MAX_ELEMENTS = 100;
const STATION_LIMIT = 8;

export type NearbyStation = { name: string; distanceM: number };

/**
 * 地点の近くの駅を距離順に返す（issue #1356）。同名の駅（路線ごとのノード）は近い1件にまとめる。
 * 取れなければnull（候補なしで手入力のまま使える）。
 */
export async function nearbyStations(lat: number, lng: number): Promise<NearbyStation[] | null> {
  const query = `[out:json][timeout:${Math.floor(TOTAL_BUDGET_MS / 1000)}];nwr(around:${STATION_RADIUS_M},${lat},${lng})["railway"="station"]["name"];out tags center ${STATION_MAX_ELEMENTS};`;
  const elements = await requestOverpass(query);
  if (!elements) return null;

  const byName = new Map<string, number>();
  for (const element of elements) {
    const name = element.tags?.name?.trim();
    const elementLat = element.lat ?? element.center?.lat;
    const elementLng = element.lon ?? element.center?.lon;
    if (!name || elementLat === undefined || elementLng === undefined) continue;

    const dLat = (elementLat - lat) * 111_000;
    const dLng = (elementLng - lng) * 111_000 * Math.cos((lat * Math.PI) / 180);
    const distance = Math.round(Math.hypot(dLat, dLng));
    const key = name.endsWith("駅") ? name : `${name}駅`;
    const known = byName.get(key);
    if (known === undefined || distance < known) byName.set(key, distance);
  }

  return [...byName.entries()]
    .map(([name, distanceM]) => ({ name, distanceM }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, STATION_LIMIT);
}
