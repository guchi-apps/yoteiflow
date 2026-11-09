import type { Client } from "@notionhq/client";

// Notion API 2025-09-03以降、プロパティを持つのはデータベースではなくデータソース。
// タスクの読み書きはデータソースに対して行う（docs/spec.md §9）。

export type TaskField =
  | "title"
  | "due"
  | "planned"
  | "done"
  | "memo"
  | "priority"
  | "recurrence"
  | "tags"
  | "outcome"
  | "progress"
  | "links";

type FieldRequirement = {
  field: TaskField;
  label: string;
  types: string[];
  required: boolean;
  /** プロパティ名の自動推定に使う候補。ユーザーが別名を付けていても拾えるようにする。 */
  nameHints: string[];
  /**
   * 名前がヒントに当たったときだけ対応付け、型だけでの割り当て（2巡目）には使わない。
   * 「プロジェクト」「担当」のような別用途のselectを進捗と取り違え、そこへ書き込むのを避ける。
   */
  hintOnly?: boolean;
};

export const TASK_FIELD_REQUIREMENTS: FieldRequirement[] = [
  { field: "title", label: "タイトル", types: ["title"], required: true, nameHints: ["タイトル", "名前", "title", "name", "タスク"] },
  { field: "due", label: "期限", types: ["date"], required: true, nameHints: ["期限", "締切", "日付", "due", "date", "deadline"] },
  // 予定日は「期限までのどの辺りで片付けるか」の見込み。期限と同じdate型のため、
  // 名前で先に確定させる必要がある（型だけで割り当てると期限と取り違える）。
  { field: "planned", label: "予定日", types: ["date"], required: false, nameHints: ["予定日", "予定", "着手", "実施", "planned", "scheduled"] },
  { field: "done", label: "完了状態", types: ["checkbox", "status"], required: true, nameHints: ["完了", "done", "status", "ステータス", "済"] },
  { field: "memo", label: "メモ", types: ["rich_text"], required: false, nameHints: ["メモ", "備考", "memo", "note", "notes", "詳細"] },
  { field: "priority", label: "優先度", types: ["select", "status"], required: false, nameHints: ["優先度", "priority", "重要度"] },
  { field: "recurrence", label: "繰り返し", types: ["select"], required: false, nameHints: ["繰り返し", "repeat", "recurrence", "リピート"] },
  { field: "tags", label: "タグ", types: ["multi_select"], required: false, nameHints: ["タグ", "tag", "tags", "カテゴリ", "category"] },
  // 「対応しない」の置き場（issue #750）。完了状態がcheckboxでも使えるよう、完了とは別のselectにする。
  // 名前が当たったときだけ対応付ける。型だけで割り当てると優先度・繰り返しと取り違える。
  { field: "outcome", label: "対応状況", types: ["select"], required: false, nameHints: ["対応状況", "対応", "outcome", "resolution"] },
  // 「承認待ち」などの途中の状態（issue #873）。完了状態とは独立し、選択肢は利用者が決める。
  // 「ステータス」「status」は完了状態のヒントと重なるため、ヒントに含めない。
  { field: "progress", label: "進捗", types: ["select"], required: false, nameHints: ["進捗", "進行", "progress"], hintOnly: true },
  // 外部リンク（Morrowのメール詳細など。issue #1508）。ハイパーリンク付きのrich_textに持つ。
  // メモと同じrich_textのため、名前が当たったときだけ対応付ける（型だけで割り当てるとメモ等を取り違える）。
  { field: "links", label: "リンク", types: ["rich_text"], required: false, nameHints: ["リンク", "links", "link", "関連リンク"], hintOnly: true },
];

/** 新規作成・プロパティ追加で入れる進捗の初期の選択肢。以後はNotion側・設定画面で自由に直せる。 */
export const DEFAULT_PROGRESS_OPTIONS = ["未着手", "進行中", "承認待ち", "保留"] as const;

export type PropertyMap = Partial<Record<TaskField, string>>;

export type ValidationResult = {
  propertyMap: PropertyMap;
  missingRequired: { field: TaskField; label: string; types: string[] }[];
  missingOptional: { field: TaskField; label: string; types: string[] }[];
};

type NotionPropertyConfig = { id: string; name: string; type: string };

export type DataSourceSummary = {
  dataSourceId: string;
  databaseId: string | null;
  title: string;
  url: string | null;
};

function plainTitle(richText: Array<{ plain_text?: string }> | undefined): string {
  if (!richText || richText.length === 0) return "(無題)";
  return richText.map((t) => t.plain_text ?? "").join("").trim() || "(無題)";
}

/** Integrationに共有されているデータソース（＝タスクDBの候補）を列挙する。 */
export async function listCandidateDataSources(notion: Client): Promise<DataSourceSummary[]> {
  const summaries: DataSourceSummary[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.search({
      filter: { property: "object", value: "data_source" },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    for (const result of response.results) {
      if (result.object !== "data_source") continue;
      // 検索結果には最小限のフィールドしか含まれない場合がある。title等が無いものは詳細を持たない
      // 部分レスポンスなので、一覧としては表示できるものだけを拾う。
      if (!("title" in result)) continue;

      const parent = result.database_parent;
      summaries.push({
        dataSourceId: result.id,
        databaseId: parent && parent.type === "database_id" ? parent.database_id : null,
        title: plainTitle(result.title),
        url: result.url ?? null,
      });
    }

    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);

  return summaries;
}

/**
 * タスクDBとして使えるかを検証し、アプリの項目名とNotionプロパティ名の対応を組み立てる。
 * プロパティ名はユーザーが自由に付けられるため、型の一致を主、名前の一致を従として推定する。
 */
export function buildPropertyMap(
  properties: Record<string, NotionPropertyConfig>,
): ValidationResult {
  const entries = Object.values(properties);
  const used = new Set<string>();
  const propertyMap: PropertyMap = {};
  const missingRequired: ValidationResult["missingRequired"] = [];
  const missingOptional: ValidationResult["missingOptional"] = [];

  const matchesHints = (property: NotionPropertyConfig, requirement: FieldRequirement) =>
    requirement.nameHints.some((hint) =>
      property.name.toLowerCase().includes(hint.toLowerCase()),
    );

  // 1巡目: 名前が想定に近いものを先に確定させる。型だけで先着順に割り当てると、
  // 例えば優先度が無いDBで「繰り返し」（同じselect型）を優先度として取り違えてしまう。
  for (const requirement of TASK_FIELD_REQUIREMENTS) {
    const chosen = entries.find(
      (p) => requirement.types.includes(p.type) && !used.has(p.name) && matchesHints(p, requirement),
    );
    if (chosen) {
      propertyMap[requirement.field] = chosen.name;
      used.add(chosen.name);
    }
  }

  // 2巡目: 名前では決まらなかった項目を型で補う。ただし、他の項目の想定名に一致する
  // プロパティは、その項目のために空けておく（取り違えを避ける）。
  for (const requirement of TASK_FIELD_REQUIREMENTS) {
    if (propertyMap[requirement.field]) continue;

    const chosen = requirement.hintOnly
      ? undefined
      : entries.find(
      (p) =>
        requirement.types.includes(p.type) &&
        !used.has(p.name) &&
        !TASK_FIELD_REQUIREMENTS.some(
          (other) => other.field !== requirement.field && matchesHints(p, other),
        ),
    );

    if (chosen) {
      propertyMap[requirement.field] = chosen.name;
      used.add(chosen.name);
      continue;
    }

    const missing = {
      field: requirement.field,
      label: requirement.label,
      types: requirement.types,
    };
    if (requirement.required) {
      missingRequired.push(missing);
    } else {
      missingOptional.push(missing);
    }
  }

  return { propertyMap, missingRequired, missingOptional };
}

export async function validateTaskDataSource(
  notion: Client,
  dataSourceId: string,
): Promise<ValidationResult & { title: string; databaseId: string | null }> {
  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId });

  const properties = dataSource.properties as Record<string, NotionPropertyConfig>;

  // レスポンスは詳細版と部分版のユニオン。titleの有無で詳細版かを判定する。
  if (!("title" in dataSource)) {
    return { ...buildPropertyMap(properties), title: "(無題)", databaseId: null };
  }

  const parent = dataSource.database_parent;

  return {
    ...buildPropertyMap(properties),
    title: plainTitle(dataSource.title),
    databaseId: parent && parent.type === "database_id" ? parent.database_id : null,
  };
}

// --- タスクDBの新規作成 ---
// 仕様上、DaySpanが無断でNotion DBを作ることはしない。ユーザーが設定画面で明示的に
// 「新規作成」を選んだときだけこの経路を通る（docs/spec.md §9）。

/** 新規作成するタスクDBのプロパティ名。propertyMapの初期値もこの名前で確定させる。 */
export const TASK_DATABASE_TEMPLATE = {
  title: "タイトル",
  due: "期限",
  planned: "予定日",
  done: "完了",
  memo: "メモ",
  priority: "優先度",
  recurrence: "繰り返し",
  tags: "タグ",
  outcome: "対応状況",
  progress: "進捗",
  links: "リンク",
} as const satisfies Required<Record<TaskField, string>>;

export const PRIORITY_OPTIONS = ["高", "中", "低"];
export const RECURRENCE_OPTIONS = ["なし", "毎日", "毎週", "毎月", "毎年"];
/** 「対応しない」にしたタスクの対応状況の値。この名前のときだけ対応しないとして読む（issue #750）。 */
export const SKIPPED_OUTCOME = "対応しない";

export type SharedPageSummary = {
  pageId: string;
  title: string;
};

function pageTitle(page: PageObjectResponseLike): string {
  const titleProperty = Object.values(page.properties ?? {}).find(
    (property) => property?.type === "title",
  );
  if (!titleProperty || !Array.isArray(titleProperty.title)) return "(無題)";
  return titleProperty.title.map((t) => t.plain_text ?? "").join("").trim() || "(無題)";
}

type PageObjectResponseLike = {
  properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }>;
};

/** タスクDBの作成先として選べるページ（Connectionに共有されているページ）を列挙する。 */
export async function listSharedPages(notion: Client): Promise<SharedPageSummary[]> {
  const pages: SharedPageSummary[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.search({
      filter: { property: "object", value: "page" },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    for (const result of response.results) {
      if (result.object !== "page") continue;
      // データベース内のページ（＝レコード）は作成先にできないため除く。
      if ("parent" in result && result.parent?.type === "data_source_id") continue;
      if (!("properties" in result)) continue;

      pages.push({ pageId: result.id, title: pageTitle(result) });
    }

    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

/**
 * 必要なプロパティを揃えたタスクDBを作成し、そのデータソースIDを返す。
 * プロパティ名はテンプレートで固定するため、検証を通さずpropertyMapを確定できる。
 */
export async function createTaskDatabase(
  notion: Client,
  { parentPageId, title }: { parentPageId: string; title: string },
): Promise<{ dataSourceId: string; databaseId: string; title: string; propertyMap: PropertyMap }> {
  const database = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: title } }],
    initial_data_source: {
      properties: {
        [TASK_DATABASE_TEMPLATE.title]: { title: {} },
        [TASK_DATABASE_TEMPLATE.due]: { date: {} },
        [TASK_DATABASE_TEMPLATE.planned]: { date: {} },
        [TASK_DATABASE_TEMPLATE.done]: { checkbox: {} },
        [TASK_DATABASE_TEMPLATE.memo]: { rich_text: {} },
        [TASK_DATABASE_TEMPLATE.priority]: {
          select: { options: PRIORITY_OPTIONS.map((name) => ({ name })) },
        },
        [TASK_DATABASE_TEMPLATE.recurrence]: {
          select: { options: RECURRENCE_OPTIONS.map((name) => ({ name })) },
        },
        // タグの選択肢はユーザーが自由に増やすものなので、初期値は作らない。
        [TASK_DATABASE_TEMPLATE.tags]: { multi_select: {} },
        [TASK_DATABASE_TEMPLATE.outcome]: { select: { options: [{ name: SKIPPED_OUTCOME }] } },
        [TASK_DATABASE_TEMPLATE.progress]: {
          select: { options: DEFAULT_PROGRESS_OPTIONS.map((name) => ({ name })) },
        },
        [TASK_DATABASE_TEMPLATE.links]: { rich_text: {} },
      },
    },
  });

  if (!("data_sources" in database) || database.data_sources.length === 0) {
    throw new Error("Created database has no data source");
  }

  return {
    dataSourceId: database.data_sources[0].id,
    databaseId: database.id,
    title,
    propertyMap: { ...TASK_DATABASE_TEMPLATE },
  };
}

/**
 * Notionから取り直した対応付けを、保存済みの `propertyMap` へ反映すべきかを決める。
 * 変わらないとき・必須プロパティが欠けたときは `null`（保存済みを据え置く）。
 * 欠けたまま置き換えると、一時的にプロパティを消しただけでタスクの読み書きが全て止まるため。
 */
export function resolveRefreshedPropertyMap(
  current: PropertyMap | null,
  validation: Pick<ValidationResult, "propertyMap" | "missingRequired">,
): PropertyMap | null {
  if (validation.missingRequired.length > 0) return null;
  const before = current ?? {};
  const after = validation.propertyMap;
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<TaskField>;
  for (const field of fields) {
    if (before[field] !== after[field]) return after;
  }
  return null;
}

function optionalPropertyConfig(field: TaskField): Record<string, unknown> | null {
  switch (field) {
    case "planned":
      return { date: {} };
    case "memo":
      return { rich_text: {} };
    case "priority":
      return { select: { options: PRIORITY_OPTIONS.map((name) => ({ name })) } };
    case "recurrence":
      return { select: { options: RECURRENCE_OPTIONS.map((name) => ({ name })) } };
    case "tags":
      return { multi_select: {} };
    case "outcome":
      return { select: { options: [{ name: SKIPPED_OUTCOME }] } };
    case "progress":
      return { select: { options: DEFAULT_PROGRESS_OPTIONS.map((name) => ({ name })) } };
    case "links":
      return { rich_text: {} };
    default:
      return null;
  }
}

/**
 * 使用中のタスクDBへ、対応付けできていない任意プロパティ（予定日・メモ・優先度・繰り返し・
 * タグ・対応状況）を足す。「対応状況」などは後から増えた項目で、既存のDBには置き場所が無い。
 *
 * Notionへ書き込むため、利用者が設定画面で押したときだけ呼ぶ（無断でDBを変えない）。
 * すでに同じ名前のプロパティがあるときは作らない。型が違っていても作り直さないのは、
 * 利用者が別の用途で使っている欄を黙って壊さないため（場所DB・勤務記録DBと同じ）。
 */
export async function addTaskOptionalProperties(
  notion: Client,
  dataSourceId: string,
): Promise<ValidationResult & { title: string; databaseId: string | null }> {
  const current = await validateTaskDataSource(notion, dataSourceId);
  const source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const names = new Set(
    Object.values(source.properties as Record<string, NotionPropertyConfig>).map((p) => p.name),
  );

  const additions: Record<string, unknown> = {};
  for (const item of current.missingOptional) {
    const name = TASK_DATABASE_TEMPLATE[item.field];
    const config = optionalPropertyConfig(item.field);
    if (config && !names.has(name)) additions[name] = config;
  }

  if (Object.keys(additions).length > 0) {
    await notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: additions as never,
    });
  }

  // 足したあとの構成で対応付けを取り直す。作っただけでは propertyMap に載らない。
  return validateTaskDataSource(notion, dataSourceId);
}
