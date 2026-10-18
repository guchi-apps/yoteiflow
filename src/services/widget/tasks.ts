import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";
import { db } from "@/lib/db";
import { getNotionConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { classifyTasks, overdueDaysLabel, sortTasks } from "@/services/notion/task-buckets";
import { listTasksInRange } from "@/services/notion/tasks";
import { readWidgetCache, type WidgetFetchOptions, writeWidgetCache } from "@/services/widget/cache";
import type { TaskItem } from "@/types/calendar";
import type { WidgetTaskItem, WidgetTasksPayload } from "@/types/widget";

/** 返す最大件数。ネイティブ版が枠の高さに入るだけ並べるための上限で、残りは件数にだけ含める（#969）。 */
const MAX_ITEMS = 30;

/**
 * 期限をどこまで遡るか（日）。
 *
 * 全件取得（`listAllTasks()`）にしない。あれは完了済みも含めて `has_more` の間ページングする
 * ため、往復がタスクDBの総件数に比例し、完了は履歴として増え続ける（docs/spec.md §12）。
 * 同じ全件取得を使っているバッジは「通知が届いたときとアプリを開いたとき・10分に1回まで」に
 * 絞られているが、ウィジェットは5分ごとに走る（docs/spec.md §20）。
 *
 * 90日はサーバー間参照用APIが期限切れを遡る上限と同じ。半年前に過ぎた期限をホーム画面に
 * 出しても行動は変わらない。これより古い期限切れはウィジェットの件数から漏れるため、
 * アプリアイコンのバッジ（全件を数える）と食い違いうる。
 */
const LOOKBACK_DAYS = 90;

/**
 * これからの期限をどこまで見るか（日）。
 *
 * 期限切れ・今日で埋まらない日に、大きい枠が空にならない程度まで。ここを広げるほど1回の
 * 取得で読むページが増える。
 */
const LOOKAHEAD_DAYS = 14;

/**
 * iPhoneウィジェットの「タスク」（docs/spec.md §28）。
 *
 * 分類も並び順もタスク画面と同じ関数（`classifyTasks()` / `sortTasks()`）を通す。ここで
 * 書き直すと、ウィジェットの数字と画面の見出しの件数が食い違う。丸い枠に出す数（期限切れ＋今日）は
 * アプリアイコンのバッジと同じ数え方でもある（docs/spec.md §32）。
 */
export async function buildWidgetTasks(
  userId: string,
  options: WidgetFetchOptions = {},
): Promise<WidgetTasksPayload> {
  const now = new Date();

  const uiSetting = await db.uiSetting.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";
  const utils = createCalendarDateUtils(timeZone);
  const todayKey = utils.todayKey();

  const source = await loadSource(userId, timeZone, todayKey, now, options);
  if (!source.ok) {
    return {
      timeZone,
      now: now.toISOString(),
      overdueCount: 0,
      todayCount: 0,
      total: 0,
      items: [],
      unavailable: source.unavailable,
    };
  }

  // 期限の言葉は持ち回さずここで作る。持ち回すと、日付が変わっても「今日」のまま出る。
  const buckets = classifyTasks(source.tasks, todayKey, utils.itemDateKey);

  const ordered: { task: TaskItem; bucket: WidgetTaskItem["bucket"] }[] = [
    ...sortTasks(buckets.overdue, "due").map((task) => ({ task, bucket: "overdue" as const })),
    ...sortTasks(buckets.today, "due").map((task) => ({ task, bucket: "today" as const })),
    // 明日・今週・来週も、ウィジェットでは従来どおり「これから」の1区分として扱う（issue #903）。
    ...sortTasks(
      [...buckets.tomorrow, ...buckets.thisWeek, ...buckets.nextWeek, ...buckets.upcoming],
      "due",
    ).map((task) => ({ task, bucket: "upcoming" as const })),
  ];

  return {
    timeZone,
    now: now.toISOString(),
    overdueCount: buckets.overdue.length,
    todayCount: buckets.today.length,
    total: ordered.length,
    items: ordered.slice(0, MAX_ITEMS).map(({ task, bucket }) => ({
      title: task.title,
      bucket,
      dueLabel: dueLabelOf(task, bucket, todayKey, utils),
      priority: task.priority,
    })),
    unavailable: null,
  };
}

type TasksSource =
  | { ok: true; tasks: TaskItem[] }
  | { ok: false; unavailable: WidgetTasksPayload["unavailable"] };

async function loadSource(
  userId: string,
  timeZone: string,
  todayKey: string,
  now: Date,
  options: WidgetFetchOptions,
): Promise<TasksSource> {
  const cacheKey = { userId, view: "tasks" as const, dateKey: todayKey, timeZone };
  const cached = options.fresh ? null : readWidgetCache<TaskItem[]>(cacheKey, now);
  if (cached) return { ok: true, tasks: cached };

  const connection = await getNotionConnection(userId);
  if (!connection) return { ok: false, unavailable: "notion_not_connected" };

  const today = parseDateKey(todayKey);

  let tasks: TaskItem[];
  try {
    // 完了済みは `listTasksInRange()` が取得後に落とす。完了状態はcheckbox/statusのどちらでも
    // ありえ、Notion側のフィルタを型ごとに出し分けるより単純なため（同関数のコメント）。
    tasks = await listTasksInRange(createNotionClient(connection), connection, {
      from: toDateKey(addDays(today, -LOOKBACK_DAYS)),
      to: toDateKey(addDays(today, LOOKAHEAD_DAYS)),
    });
  } catch (error) {
    // 握りつぶさずログへ全文を残す（CLAUDE.md「外部APIの扱い」）。画面には理由を出す。
    console.error("[dayspan] widget tasks failed:", error);
    return { ok: false, unavailable: "notion_unavailable" };
  }

  writeWidgetCache(cacheKey, tasks, now);
  return { ok: true, tasks };
}

/**
 * 行の右端に添える期限。
 *
 * 期限切れは超過日数（`overdueDaysLabel()`）。区分に入っていることは並びで分かるが、昨日
 * 過ぎたのか3か月放置しているのかは分からないため、タスク画面と同じ言葉を使う。
 */
function dueLabelOf(
  task: TaskItem,
  bucket: WidgetTaskItem["bucket"],
  todayKey: string,
  utils: ReturnType<typeof createCalendarDateUtils>,
): string {
  // classifyTasks が overdue / today / upcoming へ入れるのは期限のあるものだけ。
  if (!task.due) return "";

  const dueKey = utils.itemDateKey(task.due);

  if (bucket === "overdue") return overdueDaysLabel(dueKey, todayKey) ?? "期限切れ";
  if (bucket === "today") return task.hasTime ? `今日 ${utils.formatTime(task.due)}` : "今日";

  // これからの期限は年を出さない。枠の幅がそのぶん項目名から削られ、取りにいくのも
  // LOOKAHEAD_DAYS までで年をまたがない。
  const [, month, day] = dueKey.split("-");
  return `${Number(month)}/${Number(day)}`;
}
