import type { Client } from "@notionhq/client";
import type { NotionConnection } from "@prisma/client";

import { formatCoordinates, parseCoordinates, type LatLng } from "@/lib/coordinates";
import { disallowedPlaceTags } from "@/lib/place-tags";
import { ensureStationSuffix } from "@/lib/station-name";

import { createNotionClient } from "./client";
import type { PlacePropertyMap } from "./place-database";

/**
 * よく行く場所（docs/spec.md §9）。予定の「場所」欄の入力候補として使う。
 * 一次情報源はNotionで、DaySpan側には保存しない。
 */
export type PlaceItem = {
  id: string;
  name: string;
  address: string | null;
  tags: string[];
  /** 地図から登録したときの地点。地図を開き直すときの中心に使う。 */
  coordinates: LatLng | null;
  /**
   * 最寄り駅。Yahoo!乗換案内をこの駅名で開く（docs/spec.md §29）。
   *
   * 座標より先に見る。座標だけを渡すドアtoドアの探索では、Yahoo!が選ぶ乗り降りの駅が
   * 地点のわずかなずれで変わる。駅名を入れておけば、いつ開いても同じ駅から探せる。
   */
  station: string | null;
  /** 最寄り駅までの徒歩（分）。最寄り駅があるときだけ移動の検索時刻に足す（docs/spec.md §29）。 */
  stationMinutes?: number | null;
};

type PropertyValue = {
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  multi_select?: Array<{ name?: string }>;
  number?: number | null;
};
type Page = { id: string; properties?: Record<string, PropertyValue> };

const text = (items?: Array<{ plain_text?: string }>) =>
  items?.map((item) => item.plain_text ?? "").join("").trim() || "";

/** 0〜180の整数だけを徒歩分として扱う。範囲外・小数は読まない。 */
export function normalizeMinutes(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 && rounded <= 180 ? rounded : null;
}

function normalize(page: Page, map: PlacePropertyMap): PlaceItem | null {
  const get = (field: keyof PlacePropertyMap) => (map[field] ? page.properties?.[map[field]!] : undefined);
  const name = text(get("name")?.title);
  // 名前の無い行は候補として出しても選べない。空行は落とす。
  if (!name) return null;
  return {
    id: page.id,
    name,
    address: text(get("address")?.rich_text) || null,
    tags: get("tags")?.multi_select?.map((option) => option.name ?? "").filter(Boolean) ?? [],
    coordinates: parseCoordinates(text(get("coordinates")?.rich_text)),
    station: text(get("station")?.rich_text) || null,
    stationMinutes: normalizeMinutes(get("stationMinutes")?.number),
  };
}

/**
 * 登録済みの場所を取得する。**取得に失敗したらそのまま投げる。**
 *
 * 場所の一覧・編集画面（docs/spec.md §9）では「1件も登録が無い」と「取得できなかった」を
 * 区別する必要がある。空で返すと、Notionが落ちている日に「まだ1件も登録していない」画面が
 * 出て、直したい場所が消えたように見えるため。
 *
 * 予定の入力候補として読むだけの経路は loadPlaces（下）を使う。
 */
export async function listPlaces(connection: NotionConnection | null): Promise<PlaceItem[]> {
  if (!connection?.placeDataSourceId) return [];
  const map = (connection.placePropertyMap as PlacePropertyMap | null) ?? {};
  if (!map.name) return [];

  const notion = createNotionClient(connection);
  const pages: Page[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: connection.placeDataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const result of response.results) {
      if (result.object === "page" && "properties" in result) pages.push(result as Page);
    }
    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);

  return pages.map((page) => normalize(page, map)).filter((item): item is PlaceItem => item !== null);
}

/**
 * 入力候補としての場所を取得する。
 *
 * 取得に失敗しても画面は開けるようにする。場所は入力の候補であって、予定を読むために
 * 要るものではないため、失敗は空として扱う（tag-options.ts と同じ考え方）。
 */
export async function loadPlaces(connection: NotionConnection | null): Promise<PlaceItem[]> {
  try {
    return await listPlaces(connection);
  } catch {
    return [];
  }
}

/**
 * 場所の候補一式。DBが未設定なのか、設定済みで1件も登録が無いのかで画面の案内が違うため、
 * 設定済みかどうかを ready で分けて持つ（tag-options.ts の TagCatalog と同じ考え方）。
 */
export type PlaceCatalog = { ready: boolean; places: PlaceItem[] };

export const EMPTY_PLACE_CATALOG: PlaceCatalog = { ready: false, places: [] };

export async function loadPlaceCatalog(connection: NotionConnection | null): Promise<PlaceCatalog> {
  if (!connection?.placeDataSourceId) return EMPTY_PLACE_CATALOG;
  return { ready: true, places: await loadPlaces(connection) };
}

const richText = (content: string) => ({ rich_text: [{ type: "text", text: { content } }] });

/**
 * 場所を1件追加する。すでに同じ名前があれば作らず、その場所を返す。
 *
 * 同名の場所に住所・座標が入っていないときだけ、今回の値で埋める。
 * 地図から選び直したときに「自宅」のような既存の場所へ地点を足せるようにするため。
 * すでに入っている値は上書きしない。利用者がNotion側で直した内容を黙って戻さないため。
 */
export async function createPlace(
  connection: NotionConnection,
  input: {
    name: string;
    address?: string | null;
    coordinates?: LatLng | null;
    station?: string | null;
    stationMinutes?: number | null;
  },
): Promise<PlaceItem> {
  if (!connection.placeDataSourceId) throw new Error("Place data source is not configured");
  const map = (connection.placePropertyMap as PlacePropertyMap | null) ?? {};
  if (!map.name) throw new Error("Place name property is not configured");

  const notion = createNotionClient(connection);
  const existing = (await listPlaces(connection)).find((place) => place.name === input.name);
  input = { ...input, station: ensureStationSuffix(input.station) };

  if (existing) {
    const filled: Record<string, unknown> = {};
    if (map.address && input.address && !existing.address) {
      filled[map.address] = richText(input.address);
    }
    if (map.coordinates && input.coordinates && !existing.coordinates) {
      filled[map.coordinates] = richText(formatCoordinates(input.coordinates));
    }
    if (map.station && input.station && !existing.station) {
      filled[map.station] = richText(input.station);
    }
    if (map.stationMinutes && input.stationMinutes != null && existing.stationMinutes == null) {
      filled[map.stationMinutes] = { number: input.stationMinutes };
    }
    if (Object.keys(filled).length === 0) return existing;

    await notion.pages.update({ page_id: existing.id, properties: filled as never });
    return {
      ...existing,
      address: existing.address ?? input.address ?? null,
      coordinates: existing.coordinates ?? input.coordinates ?? null,
      station: existing.station ?? input.station ?? null,
      stationMinutes: existing.stationMinutes ?? input.stationMinutes ?? null,
    };
  }

  const properties: Record<string, unknown> = {
    [map.name]: { title: [{ type: "text", text: { content: input.name } }] },
  };
  if (map.address && input.address) properties[map.address] = richText(input.address);
  if (map.coordinates && input.coordinates) {
    properties[map.coordinates] = richText(formatCoordinates(input.coordinates));
  }
  if (map.station && input.station) properties[map.station] = richText(input.station);
  if (map.stationMinutes && input.stationMinutes != null) {
    properties[map.stationMinutes] = { number: input.stationMinutes };
  }

  const page = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: connection.placeDataSourceId },
    properties: properties as never,
  });

  return {
    id: page.id,
    name: input.name,
    address: input.address ?? null,
    tags: [],
    coordinates: input.coordinates ?? null,
    station: input.station ?? null,
    stationMinutes: input.stationMinutes ?? null,
  };
}

/**
 * 場所DB以外のページへの書き込みを断るときの合図。
 *
 * ページIDだけを受け取って書き換える経路なので、渡されたIDがどのDBのものかは
 * 呼び出し側の言い分でしか分からない。日付リマインドがゴミの日DBを守っているのと
 * 同じ形で、サービス層で確かめる（reminders.ts の ReminderNotEditableError）。
 */
export class PlaceNotEditableError extends Error {
  constructor() {
    super("This page is not in the place data source");
    this.name = "PlaceNotEditableError";
  }
}

/**
 * すでに同じ名前の場所があるときの合図。
 *
 * 予定・移動の場所欄はただの文字列で保存され、DaySpanは**名前で場所を引いている**
 * （location-input.ts の findPlace / placeCoordinates、Yahoo!乗換案内の発着地）。
 * 同名が2件あるとどちらを指すのか決まらないため、改名の時点で断る。
 */
export class PlaceNameTakenError extends Error {
  constructor(readonly placeName: string) {
    super(`Place name already exists: ${placeName}`);
    this.name = "PlaceNameTakenError";
  }
}

/** 固定の4種にも、その場所に既に付いているタグにも無い名前を新しく付けようとした（issue #1361）。 */
export class PlaceTagNotAllowedError extends Error {
  constructor(readonly tagNames: string[]) {
    super(`Place tag not allowed: ${tagNames.join(", ")}`);
    this.name = "PlaceTagNotAllowedError";
  }
}

/** NotionのIDはハイフン付き・無しのどちらの表記でも同じものを指す。比較の前に揃える。 */
const sameId = (a: string | null, b: string | null) =>
  a !== null && b !== null && a.replaceAll("-", "").toLowerCase() === b.replaceAll("-", "").toLowerCase();

/**
 * 対象ページが場所DBのものか確かめる。
 *
 * UIで入口を隠すだけだと、DaySpanのAPIや将来のMCPから直接呼ばれた要求が素通りする。
 * 経路によらず同じ結果になるここで断る（docs/spec.md §22）。
 * 代償として更新・削除のたびにNotionへの往復が1回増える。読み取り側は増えない。
 */
async function assertPlacePage(
  notion: Client,
  connection: NotionConnection,
  placeId: string,
): Promise<void> {
  if (!connection.placeDataSourceId) throw new PlaceNotEditableError();

  const page = await notion.pages.retrieve({ page_id: placeId });
  const parent = "parent" in page ? page.parent : null;
  const dataSourceId = parent?.type === "data_source_id" ? parent.data_source_id : null;

  if (!sameId(dataSourceId, connection.placeDataSourceId)) throw new PlaceNotEditableError();
}

/**
 * 書き換えたあとの姿。
 *
 * 住所・地点は**項目そのものが無い**ことに意味がある。`null` は「消す」で、項目を渡さない
 * ことは「触らない」を表す。同じにすると、DaySpanが読めない値（座標の欄に手で書かれた
 * `梅田駅の北側` のような文字列）が入っている場所を開いて保存しただけで、その文字が消える。
 */
export type PlaceWriteInput = {
  name: string;
  /** 空文字・null は「住所を消す」、項目ごと渡さないのは「触らない」。 */
  address?: string | null;
  /** null は「地点を消す」、項目ごと渡さないのは「触らない」。 */
  coordinates?: LatLng | null;
  /** 空文字・null は「最寄り駅を消す」、項目ごと渡さないのは「触らない」（住所と同じ）。 */
  station?: string | null;
  /** null は「消す」、項目ごと渡さないのは「触らない」。 */
  stationMinutes?: number | null;
  /**
   * 付けるタグの名前。渡した配列でそのまま置き換え、空配列は「全部外す」。
   * 項目ごと渡さないのは「触らない」（住所・座標と同じ）。
   *
   * `null` を持たないのは、タグが multi_select で値を必ず読めるため。住所・座標のように
   * 「画面に出ていない値がNotion側に入っている」ことが起きない。
   */
  tags?: string[];
};

/**
 * 場所を1件書き換える（docs/spec.md §9）。
 *
 * 住所と座標は同時に受ける。座標があるときは地図もYahoo!乗換案内も座標のほうを先に見るため、
 * 住所だけを直して座標が前のまま残ると、画面に出ている文字列と実際に開く地点が食い違う。
 *
 * 対応付けの無いプロパティ（住所・座標を持たない場所DB）へは書かない。持っていない欄を
 * 作りにいくと、利用者が意図して外している構成を勝手に戻すことになる。
 */
export async function updatePlace(
  connection: NotionConnection,
  placeId: string,
  input: PlaceWriteInput,
): Promise<PlaceItem> {
  const map = (connection.placePropertyMap as PlacePropertyMap | null) ?? {};
  if (!map.name) throw new Error("Place name property is not configured");

  const notion = createNotionClient(connection);
  await assertPlacePage(notion, connection, placeId);

  const name = input.name.trim();
  if (!name) throw new Error("Place name is required");

  // 自分以外に同じ名前があれば断る。名前で引いている経路が壊れるため。
  const places = await listPlaces(connection);
  const duplicated = places.find((place) => place.name === name && !sameId(place.id, placeId));
  if (duplicated) throw new PlaceNameTakenError(name);

  if (map.tags && "tags" in input) {
    const before = places.find((place) => sameId(place.id, placeId));
    const rejected = disallowedPlaceTags(input.tags ?? [], before?.tags ?? []);
    if (rejected.length > 0) throw new PlaceTagNotAllowedError(rejected);
  }

  const properties: Record<string, unknown> = {
    [map.name]: { title: [{ type: "text", text: { content: name } }] },
  };
  // 空にしたときは rich_text を空配列で送る。省くと Notion 側の値がそのまま残る。
  const address = input.address?.trim() || null;
  const station = ensureStationSuffix(input.station);
  const writeAddress = Boolean(map.address) && "address" in input;
  const writeCoordinates = Boolean(map.coordinates) && "coordinates" in input;
  const writeStation = Boolean(map.station) && "station" in input;
  const writeStationMinutes = Boolean(map.stationMinutes) && "stationMinutes" in input;
  const stationMinutes = normalizeMinutes(input.stationMinutes);
  const writeTags = Boolean(map.tags) && "tags" in input;
  const tags = input.tags ?? [];
  if (writeAddress) properties[map.address!] = address ? richText(address) : { rich_text: [] };
  if (writeStation) properties[map.station!] = station ? richText(station) : { rich_text: [] };
  if (writeStationMinutes) properties[map.stationMinutes!] = { number: stationMinutes };
  if (writeCoordinates) {
    properties[map.coordinates!] = input.coordinates
      ? richText(formatCoordinates(input.coordinates))
      : { rich_text: [] };
  }
  // 付けられるのは固定のタグ（src/lib/place-tags.ts）と据え置きの旧タグだけ。上で検証済み。
  if (writeTags) properties[map.tags!] = { multi_select: tags.map((name) => ({ name })) };

  await notion.pages.update({ page_id: placeId, properties: properties as never });

  const before = places.find((place) => sameId(place.id, placeId));
  return {
    id: placeId,
    name,
    // 書いていない項目は、いまNotionにある値をそのまま残す。
    address: writeAddress ? address : (before?.address ?? null),
    tags: writeTags ? tags : (before?.tags ?? []),
    coordinates: writeCoordinates ? (input.coordinates ?? null) : (before?.coordinates ?? null),
    station: writeStation ? station : (before?.station ?? null),
    stationMinutes: writeStationMinutes ? stationMinutes : (before?.stationMinutes ?? null),
  };
}

/**
 * 場所を1件消す。Notionのゴミ箱へ移すだけなので、間違えてもNotion側で戻せる。
 *
 * すでに予定・移動の場所欄へ入っている文字列は消えない（あれはただの文字列で、
 * 場所DBを指してはいない）。次から入力の候補に出なくなるだけ。
 */
export async function deletePlace(connection: NotionConnection, placeId: string): Promise<void> {
  const notion = createNotionClient(connection);
  await assertPlacePage(notion, connection, placeId);
  await notion.pages.update({ page_id: placeId, in_trash: true });
}
