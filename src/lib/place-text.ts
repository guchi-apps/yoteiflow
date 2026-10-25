/**
 * 場所欄の文字列（`名前 住所`）を読み解く（docs/spec.md §9・§29）。
 *
 * 予定・移動の場所欄はただの文字列で保存され、DaySpanは**名前で場所を引いている**。
 * 候補から選んだあとの欄には `名前 住所` が入る（`toLocationText`）ため、その形から
 * 元の1件へ戻す・名前と住所へ分ける規則をここに集める。
 *
 * 画面（`location-input.tsx` / `travel-form.tsx`）とサーバーの両方から使えるよう、
 * Reactに依らない素の関数として置く。住所の**組み立て**（Nominatim・Overpassの部品から
 * 1本の文字列にする）は `services/geocoding/japanese-address.ts` の側にある。あちらは
 * サーバー側の取得の話で、ここは手元にある文字列を読み解く話。
 */

import type { PlaceItem } from "@/services/notion/places";

/** 場所欄へ入れる文字列。住所があれば添える。Google Calendar側で地図が引けるようにするため。 */
export function toLocationText(name: string, address: string | null): string {
  return address ? `${name} ${address}` : name;
}

/**
 * 場所欄の値に合う場所DBの1件。無ければ null。
 *
 * 見る順は「完全一致（名前だけ／`名前 住所`）→ 名前で始まっている」。
 *
 * **前方一致まで見るのは、住所の側が古くなるため。** 欄に入るのは選んだ時点の文字列で、
 * あとからNotionで住所を直す（`/places` の編集・地図から選び直す）と完全一致は外れる。
 * 名前は重複を断っている（`PlaceNameTakenError`）ので、名前が決まれば1件に決まる。
 * 区切りの空白まで含めて見るのは、`自宅` が `自宅近くのカフェ …` に当たらないようにするため。
 * 同じ名前で始まる場所が複数あるとき（`本社` と `本社 別館`）は長いほうを採る。
 */
export function matchPlaceByText(text: string, places: PlaceItem[]): PlaceItem | null {
  const query = text.trim();
  if (!query) return null;

  const exact = places.find(
    (item) => item.name === query || toLocationText(item.name, item.address) === query,
  );
  if (exact) return exact;

  let matched: PlaceItem | null = null;
  for (const item of places) {
    if (!query.startsWith(`${item.name} `)) continue;
    if (!matched || item.name.length > matched.name.length) matched = item;
  }
  return matched;
}

/**
 * 都道府県名。`[都道府県]` の1文字で探すと「京都市」「県民ホール」に当たるため、名前で持つ。
 * 祝日（`japanese-holidays.ts`）と同じく、外部に取りにいかず自前の表で判定する。
 */
const PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
] as const;

/** 名前と住所の間に入る区切り。`toLocationText` は半角スペース、Googleの場所欄は読点が多い。 */
const SEPARATORS = /[\s、,]+$/;

/**
 * `名前 住所` を分ける。住所の始まりが読めなければ null（分けずにそのまま使う）。
 *
 * 住所の始まりは**先頭以外に現れる最後の都道府県名**とする。先頭を飛ばすのは、
 * `東京都新宿区…` のような住所そのものを名前と住所に割らないため。
 *
 * **最初ではなく最後を採る。** 名前の側に都道府県を含む値（`カフェ大阪府庁前 大阪府大阪市…`）で
 * 最初を採ると、名前の中の `大阪府` で切れて住所側が `庁前 大阪府大阪市…` という `名前 住所` の
 * 塊のまま残り、分ける前と同じ失敗に戻る。住所に都道府県が2回現れることは無いので、
 * 最後を採れば住所側は必ず都道府県から始まる。
 *
 * 英語の住所や `梅田スカイビル` のような施設名だけの値は null になるが、どちらも
 * Yahoo!がそのまま引けることを確かめている（docs/spec.md §29）。
 */
export function splitNameAndAddress(text: string): { name: string; address: string } | null {
  const value = text.trim();
  if (!value) return null;

  let at = -1;
  for (const prefecture of PREFECTURES) {
    const index = value.lastIndexOf(prefecture);
    if (index > at) at = index;
  }
  if (at <= 0) return null;

  const name = value.slice(0, at).replace(SEPARATORS, "").trim();
  const address = value.slice(at).trim();
  // 区切りを外した結果どちらかが空になるなら、分けても得るものが無い。
  if (!name || !address) return null;

  return { name, address };
}

/**
 * 文字列に都道府県から始まる住所が含まれているか（issue #1319）。`名前 住所` の形と、
 * 住所だけ（`大阪府大阪市…`）の両方を含む。
 */
export function containsAddress(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (PREFECTURES.some((prefecture) => value.startsWith(prefecture))) return true;
  return splitNameAndAddress(value) !== null;
}

/**
 * 場所欄の値から表示用の名前だけを取り出す（issue #587）。
 *
 * カレンダー上のチップ・ダイアログは幅が狭く、住所まで出すと場所名が埋もれて読みにくい。
 * 住所を切り分けられない値（施設名だけ・英語住所など）はそのまま返す。
 */
export function placeDisplayName(text: string): string {
  // 先頭に郵便番号が付く値（`〒100-0001 東京都…`）は、先に外さないと郵便番号が名前として残る。
  const withoutLead = text.trim().replace(POSTAL_CODE_HEAD, "");
  const name = splitNameAndAddress(withoutLead)?.name ?? withoutLead;
  // 住所の前に郵便番号が付いている値（`名前 〒530-0001 大阪府…`）は、名前の末尾に郵便番号が残る。
  return name.replace(POSTAL_CODE_TAIL, "").trim() || text.trim();
}

/** 先頭の郵便番号（`〒` 付き・無しの両方）。 */
const POSTAL_CODE_HEAD = /^(?:〒\s*)?\d{3}-?\d{4}[\s、,]+/;

/** 名前の末尾に残る郵便番号（`〒` 付き・無しの両方）。 */
const POSTAL_CODE_TAIL = /[\s、,]*(?:〒\s*)?\d{3}-?\d{4}$/;
