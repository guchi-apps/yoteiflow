import type { PropertyMap, TaskField } from "@/services/notion/task-database";
import type { PlacePropertyMap } from "@/services/notion/place-database";
import type { ShoppingPropertyMap } from "@/services/notion/shopping-database";
import type { WorkPropertyMap } from "@/services/notion/work-database";

/**
 * 設定画面に「プロパティを追加」ボタンがある項目だけを数える。追加手段のない項目
 * （日付リマインド・ゴミの日の任意項目など）まで数えると、利用者が対応できないドットが
 * 出続けるため。ここへ項目を足すときは、設定画面のボタンと揃える（issue #1171）。
 * 型だけを読み込むのは、`node --test` で外部ライブラリを辿らずに動かすため。
 */
const TASK_ADDABLE: TaskField[] = [
  "planned",
  "memo",
  "priority",
  "recurrence",
  "tags",
  "outcome",
  "progress",
];
const WORK_ADDABLE = [
  "businessTrip",
  "annualLeave",
  "companyHoliday",
  "preApplied",
  "postRegistered",
  "segments",
] as const;
const PLACE_ADDABLE = ["coordinates", "station"] as const;
const SHOPPING_ADDABLE = ["plannedDate", "wishlisted"] as const;

export type NotionActionInput = {
  taskDataSourceId: string | null;
  propertyMap: PropertyMap | null;
  placeDataSourceId: string | null;
  placePropertyMap: PlacePropertyMap | null;
  workDataSourceId: string | null;
  workPropertyMap: WorkPropertyMap | null;
  shoppingDataSourceId: string | null;
  shoppingPropertyMap: ShoppingPropertyMap | null;
};

function missingCount<T extends string>(
  dataSourceId: string | null,
  map: Partial<Record<T, string>> | null,
  fields: readonly T[],
): number {
  // 対応付けが保存されていないDBは数えない（必須が欠けた選び直しは画面がエラーで案内する）。
  if (!dataSourceId || !map) return 0;
  return fields.filter((field) => !map[field]).length;
}

/**
 * Notion連携で利用者の操作が必要な件数。接続済みでタスクDB未選択なら1件、
 * 選択済みの各DBは追加できるのに無いプロパティの数を足す。
 * 保存済みの対応付けだけを見るため、Notionへの往復は増えない。
 */
export function countNotionActions(input: NotionActionInput): number {
  if (!input.taskDataSourceId) return 1;
  return (
    missingCount(input.taskDataSourceId, input.propertyMap, TASK_ADDABLE) +
    missingCount(input.placeDataSourceId, input.placePropertyMap, PLACE_ADDABLE) +
    missingCount(input.workDataSourceId, input.workPropertyMap, WORK_ADDABLE) +
    missingCount(input.shoppingDataSourceId, input.shoppingPropertyMap, SHOPPING_ADDABLE)
  );
}

/** DBごとの件数。設定画面の各カードの見出しに出す。 */
export const notionActionCounts = {
  task: (i: NotionActionInput) => missingCount(i.taskDataSourceId, i.propertyMap, TASK_ADDABLE),
  place: (i: NotionActionInput) =>
    missingCount(i.placeDataSourceId, i.placePropertyMap, PLACE_ADDABLE),
  work: (i: NotionActionInput) => missingCount(i.workDataSourceId, i.workPropertyMap, WORK_ADDABLE),
  shopping: (i: NotionActionInput) =>
    missingCount(i.shoppingDataSourceId, i.shoppingPropertyMap, SHOPPING_ADDABLE),
};
