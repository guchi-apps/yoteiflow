// タスクのタイトルから既存のタグをJevで選ぶ（issue #1666・docs/spec.md §36。買い物のカテゴリ判定 #725 と同形）。

import { askChoice, type ChoiceQuestion } from "@/lib/typesafe-system-one";

/** Jevは必ずどれかを選ぶため、どれにも当てはまらないときの逃げ道を選択肢へ加える。 */
export const NO_MATCH_LABEL = "（どれにも当てはまらない）";

/** 1回に送るタグの上限。 */
export const MAX_TAGS = 50;

export function buildTaskTagQuestion(tags: readonly string[]): ChoiceQuestion {
  const criteria: Record<string, string | null> = {};
  for (const name of tags) criteria[name] = null;
  criteria[NO_MATCH_LABEL] = "どのタグにも当てはまらない、または何のタスクか判断できない";

  return {
    type: "choice",
    instructions: "やることリストに入れるタスクのタイトルから、内容に最も合うタグを1つ選ぶ。",
    criteria,
  };
}

/** 答えが送った一覧に含まれるときだけ採る。逃げ道・一覧外は null。 */
export function pickTaskTag(choice: string | null, tags: readonly string[]): string | null {
  if (!choice || choice === NO_MATCH_LABEL) return null;
  return tags.includes(choice) ? choice : null;
}

/** 判定できなかった（通信失敗・応答不正）ときは null。合うものが無いときは `{ tag: null }`。 */
export async function suggestTaskTag(input: {
  title: string;
  tags: readonly string[];
}): Promise<{ tag: string | null } | null> {
  const choice = await askChoice({
    feature: "task-tag-suggest",
    state: input.title,
    question: buildTaskTagQuestion(input.tags),
  });
  if (choice === null) return null;
  return { tag: pickTaskTag(choice, input.tags) };
}

/**
 * タイトルの入力が終わったとき（欄からフォーカスが外れたとき）に自動で判定するか。
 *
 * 選んであるタグ（編集で既に付いているものを含む）は上書きしない。同じタイトルでは呼び直さない。
 */
export function shouldAutoPickTag(state: {
  title: string;
  selectedCount: number;
  lastAskedTitle: string | null;
  tagCount: number;
  offline: boolean;
}): boolean {
  const title = state.title.trim();
  return (
    title !== "" &&
    state.selectedCount === 0 &&
    state.lastAskedTitle !== title &&
    state.tagCount > 0 &&
    !state.offline
  );
}
