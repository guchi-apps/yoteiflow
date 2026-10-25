/**
 * 移動の出発地・目的地からYahoo!乗換案内の検索URLを組み立てる（docs/spec.md §29）。
 *
 * `map-link.ts` と同じく、開く先のURLを作るだけの関数。DaySpanがこのURLを取得することは
 * 無い（結果ページの読み取りは二次利用にあたるため。§29「取得元の選定」）。
 *
 * **座標で開く。** Yahoo!乗換案内は `flatlon` / `tlatlon` に緯度経度を受け、最寄り駅までの
 * 徒歩を含んだドアtoドアで探索する。出発地・目的地が駅である必要がなく、「自宅」に対して
 * 駅を選ばせる手順が要らない。NAVITIMEのトータルナビへ座標を渡しているのと同じ理由で、
 * 座標も同じ場所DBから引く。
 *
 * #1053 で移動の入力画面からYahoo!の入口を外したときに一度消したが、予定を動かしたあとに
 * 紐づく電車を新しい時刻で調べ直す導線（issue #1301）のために戻した。取り込みは従来どおり
 * Yahoo!アプリの共有（共有拡張）から行う。
 */

import type { PlaceItem } from "@/services/notion/places";

import type { LatLng } from "@/lib/coordinates";
import { matchPlaceByText, splitNameAndAddress } from "@/lib/place-text";
import { yahooSearchStationName } from "@/lib/station-name";

const SEARCH = "https://transit.yahoo.co.jp/search/result";

/** 検索の基準。1=出発時刻を指定、4=到着時刻を指定。 */
const DEPART_AT = "1";
const ARRIVE_AT = "4";

/** 地点の渡し方。座標があればそれを使い、無ければ検索語として渡す文字列だけを持つ。 */
export type YahooTransitPlace = {
  /** 画面に出る名前。座標があるときはこちらが表示名になる。 */
  name: string;
  /** 座標が無いときの検索語。住所があれば住所のほうが地点に当たりやすい。 */
  query: string;
  coordinates: LatLng | null;
};

/**
 * 場所欄の値から、Yahoo!へ渡す1地点を決める（docs/spec.md §29）。
 *
 * **`名前 住所` の文字列を丸ごと渡してはいけない。** 場所欄には候補から選ぶとこの形が入るが、
 * Yahoo!はこの文字列から地点を引けず、**日時指定ごと捨てて検索画面（乗換案内トップの
 * 入力フォーム）を返す**（`cmd=4011`。カンマ区切りの `名前, 住所` は `cmd=4001`。issue #458）。
 * 住所だけ・駅名だけなら引ける。
 *
 * 見る順は 場所DB（最寄り駅 → 座標 → 住所）→ 分けた住所 → 丸ごと。
 * 座標は画面が持っている場所DBから引く（サーバー側で引き直すと、押すたびにNotionの
 * 全件取得が増える）。
 */
export function resolveYahooPlace(text: string, places: PlaceItem[]): YahooTransitPlace | null {
  const value = text.trim();
  if (!value) return null;

  // 住所が古くなって完全一致が外れた値も、名前の前方一致で元の1件へ戻る（matchPlaceByText）。
  const place = matchPlaceByText(value, places);
  if (place) {
    // 最寄り駅があるときは座標を添えない。座標があるとYahoo!はそちらで探索し、
    // 駅名は表示名にしかならないため、入れた駅から探せなくなる。
    // 保存は「梅田駅」の形だが、Yahoo!には「駅」を外して渡す（issue #1356）。
    if (place.station) {
      const station = yahooSearchStationName(place.station);
      return { name: station, query: station, coordinates: null };
    }
    return { name: place.name, query: place.address ?? place.name, coordinates: place.coordinates };
  }

  // 場所DBに1件も当たらない値（他アプリで作られた予定の場所欄など）は、住所だけを渡す。
  const split = splitNameAndAddress(value);
  if (!split) return { name: value, query: value, coordinates: null };

  return { name: split.name, query: split.address, coordinates: null };
}

/** 検索の基準。どちらの時刻を指定して探すか。 */
export type YahooTransitBasis = "depart" | "arrive";

/** 基準を決めるのに要るぶんだけ。画面のチップの状態もこれで決める。 */
export type YahooTransitBasisInput = {
  /**
   * 入力欄の形式（`YYYY-MM-DDTHH:mm`）。設定タイムゾーンでの壁時計なので、
   * そのまま分解する。ここでDateへ通すと、サーバーのローカル時刻（UTC）が混ざる。
   */
  departAt: string;
  arriveAt: string;
  /** 画面で選ばれた基準。既定は到着時刻（移動は「予定の開始までに着く」ために作るため）。 */
  basis?: YahooTransitBasis;
};

export type YahooTransitLinkInput = YahooTransitBasisInput & {
  origin: YahooTransitPlace | null;
  destination: YahooTransitPlace | null;
};

/**
 * どちらの時刻を指定して探すか。時刻がどちらも無ければ null（時刻を指定せずに開く）。
 *
 * **選ばれた側が空なら、もう一方へ落ちる。** 出発時刻だけ・到着時刻だけを入れた状態でも、
 * 入っているほうで探せる必要があるため（issue #444）。
 *
 * 画面のチップの選択状態もこの関数で決める。規則を画面側にもう1つ書くと、押したチップと
 * 実際に開くURLが食い違いうる。
 */
export function resolveYahooTransitBasis(input: YahooTransitBasisInput): YahooTransitBasis | null {
  const hasDepart = splitLocalInput(input.departAt) !== null;
  const hasArrive = splitLocalInput(input.arriveAt) !== null;

  if (!hasDepart && !hasArrive) return null;
  if (!hasDepart) return "arrive";
  if (!hasArrive) return "depart";
  return input.basis ?? "arrive";
}

/**
 * 出発地・目的地のどちらかが決まっていないときに開く、地点未指定のトップページ。
 *
 * 日時や場所を決める前からYahoo!乗換案内を開けるようにするため（issue #490）。
 * 片方だけ指定した状態で検索URLを組み立てても、Yahoo!側は地点を引けず日時指定ごと
 * トップページへ落とす（`applyPlace` のコメントにある `名前 住所` 丸ごと渡し失敗と同じ挙動。
 * 実地確認済み）ので、揃わない間は特別扱いを増やさずこの1つに統一する。
 */
export const YAHOO_TRANSIT_TOP_URL = "https://transit.yahoo.co.jp/";

/**
 * 検索URL。出発地・目的地が揃っていなければ地点未指定のトップページ（`YAHOO_TRANSIT_TOP_URL`）。
 *
 * 基準の既定は到着時刻。移動は「予定の開始までに着く」ために作るため（§29）。出発時刻を
 * 指定して探したいときは、画面のチップで基準を切り替える。
 */
export function yahooTransitLink(input: YahooTransitLinkInput): string {
  const origin = input.origin;
  const destination = input.destination;
  if (!origin || !destination) return YAHOO_TRANSIT_TOP_URL;

  const params = new URLSearchParams();
  applyPlace(params, "from", "flatlon", origin);
  applyPlace(params, "to", "tlatlon", destination);

  const basis = resolveYahooTransitBasis(input);
  const at = basis && splitLocalInput(basis === "depart" ? input.departAt : input.arriveAt);
  if (at) {
    params.set("y", at.year);
    params.set("m", at.month);
    params.set("d", at.day);
    params.set("hh", at.hour);
    // 分は十の位・一の位で分かれている（Yahoo!側の指定の形）。
    params.set("m1", at.minute.slice(0, 1));
    params.set("m2", at.minute.slice(1, 2));
    params.set("type", basis === "depart" ? DEPART_AT : ARRIVE_AT);
  }

  return `${SEARCH}?${params.toString()}`;
}

/**
 * 1地点ぶんの指定を積む。
 *
 * 座標があるときは名前を表示名として渡し、探索は座標で行わせる。座標が無いときは
 * 検索語（住所があれば住所）をそのまま渡す。DaySpanの場所欄は `名前 住所` の形で
 * 入るため、その文字列のままでは地点が引けない。
 */
function applyPlace(
  params: URLSearchParams,
  nameKey: string,
  coordinateKey: string,
  place: YahooTransitPlace,
): void {
  if (place.coordinates) {
    params.set(nameKey, place.name);
    params.set(coordinateKey, `${place.coordinates.lat},${place.coordinates.lng}`);
    return;
  }
  params.set(nameKey, place.query);
}

/** `YYYY-MM-DDTHH:mm` を部分ごとに分ける。形が違えば null。 */
function splitLocalInput(
  value: string,
): { year: string; month: string; day: string; hour: string; minute: string } | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!matched) return null;
  return {
    year: matched[1],
    month: matched[2],
    day: matched[3],
    hour: matched[4],
    minute: matched[5],
  };
}
