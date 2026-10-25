import type { Client } from "@notionhq/client";
import type { NotionConnection } from "@prisma/client";

import { createNotionClient } from "./client";
import type { PlacePropertyMap } from "./place-database";
import type { ReminderPropertyMap } from "./reminder-database";
import type { ShoppingPropertyMap } from "./shopping-database";
import type { PropertyMap } from "./task-database";
import type { WorkPropertyMap } from "./work-database";

// タスクのタグ・場所のタグ（multi_select）と、日付リマインドの種類・勤務場所・
// 買い物のカテゴリ（select）の選択肢を扱う。
//
// 選択肢そのものはNotion側のプロパティ定義が一次情報源で、DaySpanのDBには持たない
// （docs/spec.md §19）。DaySpanからできるのは追加・削除・改名・並び替えまで。
// 色だけはNotion APIが既存の選択肢への変更を拒む（`Cannot update color of select with id: ...`）
// ため、変えたい場合はNotion側で直してもらう。
//
// 書き戻したあとは必ずNotionから取り直して返す。仮にNotionが要求を無視しても、画面には
// 変わらないままの一覧が返るだけで、「変えられたことにする」表示にはならない。

/** Notionのselect / multi_selectが取りうる色。DaySpanから指定できるのもこの10色に限る。 */
export const TAG_COLORS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  default: "既定",
  gray: "グレー",
  brown: "ブラウン",
  orange: "オレンジ",
  yellow: "イエロー",
  green: "グリーン",
  blue: "ブルー",
  purple: "パープル",
  pink: "ピンク",
  red: "レッド",
};

export function isTagColor(value: unknown): value is TagColor {
  return typeof value === "string" && (TAG_COLORS as readonly string[]).includes(value);
}

export type TagOption = {
  /** Notion側の選択肢ID。更新時に既存の選択肢を指すために使う。 */
  id: string;
  name: string;
  color: TagColor;
};

/**
 * タグを置いているプロパティの種別。タスクと場所は複数選択、それ以外は単一選択。
 *
 * 勤務場所（docs/spec.md §34）・買い物のカテゴリ（§36）・場所のタグ（§9）をここへ含めるのは、
 * 選択肢と色がNotionのプロパティ定義そのもので、追加・削除・改名・並び替えの手順も
 * タグとまったく同じため。別の経路を作ると、同じ操作が2か所に増える。
 */
export type TagKind = "task" | "reminder" | "work" | "shopping" | "place" | "progress";

/**
 * 複数選択（multi_select）で持っている種別。書き戻すときの構成がここだけ違う。
 *
 * 1つのタスク・1つの場所には複数のタグが付く。日付リマインドの種類・勤務場所・
 * 買い物のカテゴリは1件につき1つ（select）。
 */
const MULTI_SELECT_KINDS: ReadonlySet<TagKind> = new Set<TagKind>(["task", "place"]);

/**
 * 登録済みのタグ・種類。
 *
 * プロパティが無い（タスクDBにタグ列が無い等）場合と、1件も登録されていない場合は
 * 画面での案内が違うため、前者を null で区別する。
 */
export type TagCatalog = {
  task: TagOption[] | null;
  /**
   * タスクの進捗（issue #873）の選択肢。タグと同じタスクDBにあるため、`loadTagCatalog` は
   * 1回の `dataSources.retrieve` から両方を読む（往復を増やさない）。Service Workerに残る古い応答には
   * 無いため、読む側は `?? null` で受ける。
   */
  progress?: TagOption[] | null;
  reminder: TagOption[] | null;
  work: TagOption[] | null;
  shopping: TagOption[] | null;
};

export const EMPTY_TAG_CATALOG: TagCatalog = {
  task: null,
  progress: null,
  reminder: null,
  work: null,
  shopping: null,
};

type PropertyConfig = {
  type?: string;
  select?: { options?: Array<{ id?: string; name?: string; color?: string }> };
  multi_select?: { options?: Array<{ id?: string; name?: string; color?: string }> };
};

/** タグの置き場所。データソースIDとプロパティ名が揃って初めて読み書きできる。 */
type TagLocation = { dataSourceId: string; propertyName: string };

export function tagLocation(connection: NotionConnection, kind: TagKind): TagLocation | null {
  if (kind === "task") {
    const propertyName = (connection.propertyMap as PropertyMap | null)?.tags;
    if (!connection.taskDataSourceId || !propertyName) return null;
    return { dataSourceId: connection.taskDataSourceId, propertyName };
  }

  if (kind === "progress") {
    const propertyName = (connection.propertyMap as PropertyMap | null)?.progress;
    if (!connection.taskDataSourceId || !propertyName) return null;
    return { dataSourceId: connection.taskDataSourceId, propertyName };
  }

  if (kind === "work") {
    const propertyName = (connection.workPropertyMap as WorkPropertyMap | null)?.place;
    if (!connection.workDataSourceId || !propertyName) return null;
    return { dataSourceId: connection.workDataSourceId, propertyName };
  }

  if (kind === "shopping") {
    const propertyName = (connection.shoppingPropertyMap as ShoppingPropertyMap | null)?.category;
    if (!connection.shoppingDataSourceId || !propertyName) return null;
    return { dataSourceId: connection.shoppingDataSourceId, propertyName };
  }

  if (kind === "place") {
    const propertyName = (connection.placePropertyMap as PlacePropertyMap | null)?.tags;
    if (!connection.placeDataSourceId || !propertyName) return null;
    return { dataSourceId: connection.placeDataSourceId, propertyName };
  }

  const propertyName = (connection.reminderPropertyMap as ReminderPropertyMap | null)?.category;
  if (!connection.reminderDataSourceId || !propertyName) return null;
  return { dataSourceId: connection.reminderDataSourceId, propertyName };
}

function readOptions(property: PropertyConfig | undefined): TagOption[] | null {
  const options = property?.multi_select?.options ?? property?.select?.options;
  if (!options) return null;

  return options
    .filter((option): option is { id: string; name: string; color?: string } =>
      Boolean(option.id && option.name),
    )
    .map((option) => ({
      id: option.id,
      name: option.name,
      // Notion側で新しい色が増えても表示だけは壊さない。知らない色は既定として扱う。
      color: isTagColor(option.color) ? option.color : "default",
    }));
}

async function fetchOptions(
  notion: Client,
  { dataSourceId, propertyName }: TagLocation,
): Promise<TagOption[] | null> {
  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const properties = dataSource.properties as Record<string, PropertyConfig>;
  return readOptions(properties[propertyName]);
}

/**
 * 1種類ぶんの選択肢だけを取得する。
 *
 * 勤務の画面では勤務場所しか要らない。まとめて取る `loadTagCatalog` を呼ぶと、使わない
 * タスクのタグと日付リマインドの種類のぶんまでNotionへ問い合わせることになる。
 */
export async function loadTagOptions(
  connection: NotionConnection | null,
  kind: TagKind,
): Promise<TagOption[] | null> {
  if (!connection) return null;
  const location = tagLocation(connection, kind);
  if (!location) return null;

  try {
    return await fetchOptions(createNotionClient(connection), location);
  } catch {
    // 選択肢は入力の候補でしかない。取れなくても画面は開けるようにする。
    return null;
  }
}

/**
 * 登録済みのタグ・種類をまとめて取得する。
 *
 * 取得に失敗しても画面自体は開けるようにする。タグは表示の彩りと入力の候補であって、
 * 予定・タスクを読むために要るものではないため、失敗は空として扱う。
 */
export async function loadTagCatalog(connection: NotionConnection | null): Promise<TagCatalog> {
  if (!connection) return EMPTY_TAG_CATALOG;

  const taskLocation = tagLocation(connection, "task");
  const progressLocation = tagLocation(connection, "progress");
  const reminderLocation = tagLocation(connection, "reminder");
  const workLocation = tagLocation(connection, "work");
  const shoppingLocation = tagLocation(connection, "shopping");
  if (!taskLocation && !progressLocation && !reminderLocation && !workLocation && !shoppingLocation) {
    return EMPTY_TAG_CATALOG;
  }

  try {
    const notion = createNotionClient(connection);
    // タグと進捗はどちらもタスクDBのプロパティ。retrieveは1回で済ませて両方を読む。
    const taskSource = taskLocation ?? progressLocation;
    const taskProperties = taskSource
      ? ((await notion.dataSources.retrieve({ data_source_id: taskSource.dataSourceId }))
          .properties as Record<string, PropertyConfig>)
      : null;
    const [task, progress, reminder, work, shopping] = await Promise.all([
      taskLocation && taskProperties ? readOptions(taskProperties[taskLocation.propertyName]) : null,
      progressLocation && taskProperties
        ? readOptions(taskProperties[progressLocation.propertyName])
        : null,
      reminderLocation ? fetchOptions(notion, reminderLocation) : null,
      workLocation ? fetchOptions(notion, workLocation) : null,
      shoppingLocation ? fetchOptions(notion, shoppingLocation) : null,
    ]);
    return { task, progress, reminder, work, shopping };
  } catch {
    return EMPTY_TAG_CATALOG;
  }
}

/**
 * 選択肢の一覧をNotionへ書き戻す。
 *
 * Notionは配列に無い選択肢を削除するため、残すものは必ずIDで送り直す。IDを添えずに
 * 名前だけで送ると、変更のつもりが削除と再作成になり、それが付いていた既存ページからも外れる。
 *
 * 色は既存の選択肢へは送らない（Notionが拒む）。名前は `{ id, name }` で送れば変わる。
 * 送った順がそのまま定義順になるため、並び替えもこの経路で行う。
 */
async function writeOptions(
  notion: Client,
  { dataSourceId, propertyName }: TagLocation,
  kind: TagKind,
  options: Array<{ id: string } | { id: string; name: string } | { name: string; color: TagColor }>,
): Promise<void> {
  const config = MULTI_SELECT_KINDS.has(kind)
    ? { multi_select: { options } }
    : { select: { options } };

  await notion.dataSources.update({
    data_source_id: dataSourceId,
    properties: { [propertyName]: config } as never,
  });
}

/** 選択肢を1つ追加する。すでに同じ名前があれば何もしない。 */
export async function addTagOption(
  connection: NotionConnection,
  kind: TagKind,
  name: string,
  color: TagColor,
): Promise<TagOption[]> {
  const location = tagLocation(connection, kind);
  if (!location) throw new Error("Tag property is not configured");

  const notion = createNotionClient(connection);
  const current = (await fetchOptions(notion, location)) ?? [];
  if (current.some((option) => option.name === name)) return current;

  await writeOptions(notion, location, kind, [
    ...current.map((option) => ({ id: option.id })),
    { name, color },
  ]);

  return (await fetchOptions(notion, location)) ?? [];
}

/**
 * 選択肢を1つ削除する。
 *
 * Notionでは選択肢を消すと、それが付いていた既存ページからも外れる。取り消せないため、
 * 呼び出し側（設定画面）でその旨を伝えたうえで実行する。
 */
export async function removeTagOption(
  connection: NotionConnection,
  kind: TagKind,
  name: string,
): Promise<TagOption[]> {
  const location = tagLocation(connection, kind);
  if (!location) throw new Error("Tag property is not configured");

  const notion = createNotionClient(connection);
  const current = (await fetchOptions(notion, location)) ?? [];

  await writeOptions(
    notion,
    location,
    kind,
    current.filter((option) => option.name !== name).map((option) => ({ id: option.id })),
  );

  return (await fetchOptions(notion, location)) ?? [];
}

/** 選択肢の改名・並び替えで、現在の状態と食い違う要求を受けたときのエラー。API側で409に変える。 */
export class TagOptionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TagOptionConflictError";
  }
}

/**
 * 選択肢の名前を変える。
 *
 * IDで指すため、それが付いている既存ページの値も一緒に変わる（選択肢を消して作り直すのとは
 * 違い、ページから外れない）。色は送らない（Notionが既存の選択肢への色の変更を拒むため）。
 *
 * 同じ名前が他にあると、Notionは同名の選択肢を2つ持つことになり、どちらを指しているのかが
 * 画面からもNotionからも読めなくなる。実行する前に断る。
 */
export async function renameTagOption(
  connection: NotionConnection,
  kind: TagKind,
  optionId: string,
  name: string,
): Promise<{ options: TagOption[]; previousName: string }> {
  const location = tagLocation(connection, kind);
  if (!location) throw new Error("Tag property is not configured");

  const notion = createNotionClient(connection);
  const current = (await fetchOptions(notion, location)) ?? [];

  const target = current.find((option) => option.id === optionId);
  if (!target) throw new TagOptionConflictError("選択肢が見つかりません。");
  if (target.name === name) return { options: current, previousName: target.name };
  if (current.some((option) => option.id !== optionId && option.name === name)) {
    throw new TagOptionConflictError("同じ名前の選択肢がすでにあります。");
  }

  await writeOptions(
    notion,
    location,
    kind,
    current.map((option) =>
      option.id === optionId ? { id: option.id, name } : { id: option.id },
    ),
  );

  // 変える前の名前も返す。勤務場所の出張扱い（NotionConnection.workTripPlaces）は名前で
  // 覚えているため、呼び出し側がそれを付け替えるのに要る。ここで取り直すと往復が1つ増える。
  return { options: (await fetchOptions(notion, location)) ?? [], previousName: target.name };
}

/**
 * 選択肢の並び順を入れ替える。
 *
 * Notionは送った配列の順をそのまま定義順にする。DaySpanの画面（タグのチップ・買い物の
 * カテゴリのタブ）はこの定義順で並べているため、ここを変えると表示の並びも変わる。
 *
 * 送られた並びが現在の一覧と1件でも食い違っていたら実行しない。過不足のある配列を送ると、
 * 抜けた選択肢がNotionから削除され、それが付いていた既存ページからも外れるため。
 */
export async function reorderTagOptions(
  connection: NotionConnection,
  kind: TagKind,
  orderedIds: string[],
): Promise<TagOption[]> {
  const location = tagLocation(connection, kind);
  if (!location) throw new Error("Tag property is not configured");

  const notion = createNotionClient(connection);
  const current = (await fetchOptions(notion, location)) ?? [];

  const requested = new Set(orderedIds);
  if (
    orderedIds.length !== current.length ||
    requested.size !== orderedIds.length ||
    current.some((option) => !requested.has(option.id))
  ) {
    throw new TagOptionConflictError(
      "並び替えの内容が現在の一覧と一致しません。画面を再読み込みしてからやり直してください。",
    );
  }

  await writeOptions(
    notion,
    location,
    kind,
    orderedIds.map((id) => ({ id })),
  );

  return (await fetchOptions(notion, location)) ?? [];
}
