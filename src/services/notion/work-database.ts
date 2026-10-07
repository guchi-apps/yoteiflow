import type { Client } from "@notionhq/client";

// 勤務場所・出張・年休・会社休業日のデータソース（docs/spec.md §34）。
//
// 通常の勤務（1日1件）も出張（期間で1件）も年休も会社休業日も、同じDBの同じ形のページとして持つ。
// 違うのは日付が範囲かどうかと「出張」「会社休業日」チェック・「年休」の区分だけで、種類ごとに
// DBを分けると月の一覧を出すのに複数のDBへ問い合わせることになる。
//
// タスク・日付リマインド・場所と同じく、一次情報源はNotion側でDaySpanには保存しない。

export type WorkField =
  | "title"
  | "date"
  | "place"
  | "annualLeave"
  | "businessTrip"
  | "companyHoliday"
  | "preApplied"
  | "postRegistered"
  | "memo"
  | "segments";

export type WorkPropertyMap = Partial<Record<WorkField, string>>;

type PropertyConfig = { id: string; name: string; type: string };
type Requirement = {
  field: WorkField;
  label: string;
  types: string[];
  required: boolean;
  hints: string[];
  /**
   * 名前が当たったときだけ対応付ける項目（場所DBの「座標」と同じ扱い）。
   *
   * 出張・会社休業日・事前申請・事後登録はどれも checkbox で、型だけで空いている欄へ順に
   * 割り当てると事前申請と事後登録が入れ替わりうる。入れ替わったことは画面からは分からず、
   * 申請したはずのものが未対応として残り続けるため、推測では割り当てない。
   */
  hintOnly?: boolean;
};

export const WORK_FIELD_REQUIREMENTS: Requirement[] = [
  {
    field: "title",
    label: "タイトル",
    types: ["title"],
    required: true,
    hints: ["タイトル", "名前", "title", "name", "勤務"],
  },
  {
    field: "date",
    label: "日付",
    types: ["date"],
    required: true,
    hints: ["日付", "date", "勤務日", "期間"],
  },
  {
    field: "place",
    label: "勤務場所",
    types: ["select"],
    required: true,
    hints: ["勤務場所", "場所", "place", "location", "区分", "種類"],
  },
  {
    field: "annualLeave",
    label: "年休",
    types: ["select"],
    required: false,
    hints: ["年休", "有休", "有給", "leave", "vacation"],
    // 勤務場所と同じ select のため、型だけを見て空いている欄へ割り当てると入れ替わりうる。
    // 入れ替わると勤務場所の選択肢が年休の区分として出るため、推測では割り当てない。
    hintOnly: true,
  },
  {
    field: "businessTrip",
    label: "出張",
    types: ["checkbox"],
    required: false,
    hints: ["出張", "trip", "business"],
    hintOnly: true,
  },
  {
    field: "companyHoliday",
    label: "会社休業日",
    types: ["checkbox"],
    required: false,
    // 「休業」だけでも当てる。利用者が自分で作ったDBでは「休業日」「会社休み」のような
    // 名前になりうるため。出張・事前申請・事後登録のヒントとは重ならない。
    hints: ["会社休業日", "休業", "会社休み", "closed", "holiday"],
    hintOnly: true,
  },
  {
    field: "preApplied",
    label: "事前申請",
    types: ["checkbox"],
    required: false,
    hints: ["事前申請", "事前", "申請", "apply", "application"],
    hintOnly: true,
  },
  {
    field: "postRegistered",
    label: "事後登録",
    types: ["checkbox"],
    required: false,
    hints: ["事後登録", "事後", "登録", "report", "register"],
    hintOnly: true,
  },
  {
    field: "memo",
    label: "メモ",
    types: ["rich_text"],
    required: false,
    hints: ["メモ", "備考", "memo", "note"],
  },
  {
    field: "segments",
    label: "時間帯",
    types: ["rich_text"],
    required: false,
    hints: ["時間帯", "内訳"],
    // メモと同じ rich_text のため、型だけで割り当てるとメモ欄へ内訳を書き込む（issue #1155）。
    hintOnly: true,
  },
];

export type WorkValidation = {
  propertyMap: WorkPropertyMap;
  missingRequired: { field: WorkField; label: string; types: string[] }[];
  missingOptional: { field: WorkField; label: string; types: string[] }[];
};

/**
 * 勤務記録DBとして使えるかを検証し、アプリの項目名とNotionプロパティ名の対応を組み立てる。
 * 型の一致を主、名前の一致を従として推定するのはタスク・リマインド・場所と同じ。
 */
export function buildWorkPropertyMap(properties: Record<string, PropertyConfig>): WorkValidation {
  const entries = Object.values(properties);
  const used = new Set<string>();
  const propertyMap: WorkPropertyMap = {};
  const missingRequired: WorkValidation["missingRequired"] = [];
  const missingOptional: WorkValidation["missingOptional"] = [];
  const hinted = (property: PropertyConfig, requirement: Requirement) =>
    requirement.hints.some((hint) => property.name.toLowerCase().includes(hint.toLowerCase()));

  for (const requirement of WORK_FIELD_REQUIREMENTS) {
    const property = entries.find(
      (entry) =>
        requirement.types.includes(entry.type) && !used.has(entry.name) && hinted(entry, requirement),
    );
    if (property) {
      propertyMap[requirement.field] = property.name;
      used.add(property.name);
    }
  }

  for (const requirement of WORK_FIELD_REQUIREMENTS) {
    if (propertyMap[requirement.field]) continue;
    const property = requirement.hintOnly
      ? undefined
      : entries.find((entry) => requirement.types.includes(entry.type) && !used.has(entry.name));
    if (property) {
      propertyMap[requirement.field] = property.name;
      used.add(property.name);
    } else {
      (requirement.required ? missingRequired : missingOptional).push({
        field: requirement.field,
        label: requirement.label,
        types: requirement.types,
      });
    }
  }

  return { propertyMap, missingRequired, missingOptional };
}

function plainTitle(items: Array<{ plain_text?: string }> | undefined): string {
  return items?.map((item) => item.plain_text ?? "").join("").trim() || "(無題)";
}

export async function validateWorkDataSource(notion: Client, dataSourceId: string) {
  const source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const validation = buildWorkPropertyMap(source.properties as Record<string, PropertyConfig>);
  if (!("title" in source)) return { ...validation, title: "(無題)", databaseId: null };
  const parent = source.database_parent;
  return {
    ...validation,
    title: plainTitle(source.title),
    databaseId: parent?.type === "database_id" ? parent.database_id : null,
  };
}

/** 新規作成する勤務記録DBのプロパティ名。propertyMapの初期値もこの名前で確定させる。 */
export const WORK_DATABASE_TEMPLATE = {
  title: "タイトル",
  date: "日付",
  place: "勤務場所",
  annualLeave: "年休",
  businessTrip: "出張",
  companyHoliday: "会社休業日",
  preApplied: "事前申請",
  postRegistered: "事後登録",
  memo: "メモ",
  segments: "時間帯",
} as const satisfies Required<Record<WorkField, string>>;

/**
 * 勤務場所の初期の選択肢。
 *
 * 空のselectから始めると、勤務場所を1つ足すまで何も登録できない。よくある区分を入れておき、
 * 要らないものは設定（タグ）から消してもらう。色はNotionの既定の10色から選ぶ。
 */
const DEFAULT_PLACE_OPTIONS = [
  { name: "出社", color: "blue" },
  { name: "在宅", color: "green" },
  { name: "客先", color: "orange" },
  { name: "出張", color: "purple" },
] as const;

/**
 * 新規作成した勤務記録DBで、最初から出張扱いにしておく勤務場所。
 *
 * 初期の選択肢に「出張」がある以上、それを選んで出張にならないほうが分かりにくい。
 * 要らなければ設定のタグ画面で外せる。
 */
export const DEFAULT_TRIP_PLACES: string[] = ["出張"];

/**
 * 年休の区分（docs/spec.md §34）。
 *
 * 選択肢はDaySpanが決める。勤務場所と違って利用者が足すものではなく、半日を 0.5 日として
 * 数えるかどうかがこの名前で決まるため（`annualLeaveDays()`）。新しく作るDBにはこの3つを
 * 入れておく。
 *
 * 時間休（`3時間休`）はここに並べない。所定労働時間によって使う時間数が変わり、7時間ぶん
 * 並べるとNotionのselectの一覧が時間休で埋まる。Notionは定義に無い名前を書き込むとその場で
 * 選択肢を足すため、実際に使った時間数だけが増えていく（issue #537）。
 */
export const ANNUAL_LEAVE_OPTIONS = [
  { name: "全休", color: "pink" },
  { name: "午前半休", color: "purple" },
  { name: "午後半休", color: "purple" },
] as const;

export type AnnualLeaveKind = (typeof ANNUAL_LEAVE_OPTIONS)[number]["name"];

/** 入力ダイアログで時間休の区分に出す名前。時間数を名前へ含める（`annualLeaveHours()` が読み戻す）。 */
export const HOURLY_LEAVE_LABEL = "時間休";

/** 時間休の区分の名前。Notion側の選択肢は、この名前で書き込んだ時点で増える。 */
export function hourlyLeaveName(hours: number): string {
  return `${hours}${HOURLY_LEAVE_LABEL}`;
}

/**
 * 時間休として選べる上限の時間数。
 *
 * 所定労働時間ぶん取れば全休と同じで、区分を分ける意味が無い。1時間刻みで選ばせるため、
 * 端数のある所定（7時間45分）では切り上げてから1を引く（7時間まで）。
 */
export function maxHourlyLeaveHours(minutesPerDay: number): number {
  return Math.max(1, Math.ceil(minutesPerDay / 60) - 1);
}

/**
 * 必要なプロパティを揃えた勤務記録DBを作成する。
 *
 * 年休・出張・会社休業日・事前申請・事後登録は名前が当たったときだけ対応付ける（hintOnly）ため、
 * 既存のDBを選んでもらう経路では揃わないことがある。ここで作れば、その5つを含めて必ず揃った
 * 構成になる。
 */
export async function createWorkDatabase(
  notion: Client,
  { parentPageId, title }: { parentPageId: string; title: string },
): Promise<{
  dataSourceId: string;
  databaseId: string;
  title: string;
  propertyMap: WorkPropertyMap;
}> {
  const database = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: title } }],
    initial_data_source: {
      properties: {
        [WORK_DATABASE_TEMPLATE.title]: { title: {} },
        // 出張は複数日にまたがるため、日付は範囲（start–end）でも入る。
        [WORK_DATABASE_TEMPLATE.date]: { date: {} },
        [WORK_DATABASE_TEMPLATE.place]: {
          select: { options: DEFAULT_PLACE_OPTIONS.map((option) => ({ ...option })) },
        },
        [WORK_DATABASE_TEMPLATE.annualLeave]: {
          select: { options: ANNUAL_LEAVE_OPTIONS.map((option) => ({ ...option })) },
        },
        [WORK_DATABASE_TEMPLATE.businessTrip]: { checkbox: {} },
        [WORK_DATABASE_TEMPLATE.companyHoliday]: { checkbox: {} },
        [WORK_DATABASE_TEMPLATE.preApplied]: { checkbox: {} },
        [WORK_DATABASE_TEMPLATE.postRegistered]: { checkbox: {} },
        [WORK_DATABASE_TEMPLATE.memo]: { rich_text: {} },
        [WORK_DATABASE_TEMPLATE.segments]: { rich_text: {} },
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
    propertyMap: { ...WORK_DATABASE_TEMPLATE },
  };
}

/**
 * すでに使っている勤務記録DBへ、足りない任意プロパティ（年休・出張・会社休業日・事前申請・
 * 事後登録・メモ・時間帯）を足す。
 *
 * 年休・出張・会社休業日・事前申請・事後登録は名前が当たったときだけ対応付けるため、既存のDBを選ぶと
 * 揃わないことがある。どの型で何という名前にすればよいのかは画面のどこにも出ていないので、
 * 設定画面から実行できるようにする（場所DBの「座標」と同じ経路）。
 *
 * すでに同じ名前のプロパティがあるときは作らない。型が違っていても作り直さないのは、
 * 利用者が別の用途で使っている欄を黙って壊さないため。
 */
export async function addWorkOptionalProperties(
  notion: Client,
  dataSourceId: string,
): Promise<WorkValidation & { title: string; databaseId: string | null }> {
  const source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const properties = source.properties as Record<string, PropertyConfig>;
  const names = new Set(Object.values(properties).map((property) => property.name));

  const additions: Record<string, unknown> = {};
  for (const field of ["businessTrip", "companyHoliday", "preApplied", "postRegistered"] as const) {
    const name = WORK_DATABASE_TEMPLATE[field];
    if (!names.has(name)) additions[name] = { checkbox: {} };
  }
  if (!names.has(WORK_DATABASE_TEMPLATE.annualLeave)) {
    additions[WORK_DATABASE_TEMPLATE.annualLeave] = {
      select: { options: ANNUAL_LEAVE_OPTIONS.map((option) => ({ ...option })) },
    };
  }
  if (!names.has(WORK_DATABASE_TEMPLATE.memo)) {
    additions[WORK_DATABASE_TEMPLATE.memo] = { rich_text: {} };
  }
  if (!names.has(WORK_DATABASE_TEMPLATE.segments)) {
    additions[WORK_DATABASE_TEMPLATE.segments] = { rich_text: {} };
  }

  if (Object.keys(additions).length > 0) {
    await notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: additions as never,
    });
  }

  // 足したあとの構成で対応付けを取り直す。作っただけでは propertyMap に載らない。
  return validateWorkDataSource(notion, dataSourceId);
}
