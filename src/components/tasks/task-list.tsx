"use client";

import { shouldQueueWrite, submitWrite } from "@/lib/offline-queue/flush";
import { applyTaskOps } from "@/lib/offline-queue/ops";
import { usePendingWrites } from "@/lib/offline-queue/store";
import { useWriteSynced } from "@/lib/offline-queue/use-write-synced";
import { useMemo, useState, type ReactNode } from "react";
import { useOffline } from "next/offline";
import {
  ArrowUpDown,
  Ban,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Plus,
  RefreshCw,
  Tag,
} from "lucide-react";

import { AppMenuButton } from "@/components/nav/app-drawer";
import { AppFrame } from "@/components/nav/app-frame";
import {
  WIDE_SECTION_CARD_CLASS,
  WIDE_SECTION_HEADING_CLASS,
  WIDE_SECTION_LIST_CLASS,
} from "@/components/ui/wide-section";
import { BottomNav } from "@/components/nav/main-nav";
import { fabBottomOffsetClass, RunningActivityBar } from "@/components/nav/running-activity-bar";
import { OFFLINE_WRITE_MESSAGE, OfflineNotice } from "@/components/offline/offline-notice";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { SlowNetworkNotice } from "@/components/offline/slow-network-notice";
import { useApiResource } from "@/components/offline/use-api-resource";
import { AppBadgeSync } from "@/components/notifications/app-badge-sync";
import { LinearProgress } from "@/components/ui/linear-progress";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { TaskDetailDialog } from "@/components/calendar/task-detail-dialog";
import { ItemDialog, type ItemDrafts } from "@/components/calendar/item-dialog";
import { toTaskDraft } from "@/components/calendar/task-form";
import { taskLinkTargetedLabel } from "@/components/calendar/task-link-label";
import { TaskStageMark } from "@/components/calendar/task-stage-mark";
import { TagChip, TagChipList } from "@/components/tags/tag-chip";
import { tagColorOf } from "@/components/tags/tag-color";
import { useTaskViewPrefs } from "@/components/tasks/use-task-view-prefs";
import { cn } from "@/lib/utils";
import {
  classifyDateOf,
  classifyTasks,
  groupTasksByTag,
  NO_TAG_GROUP_KEY,
  overdueDaysLabel,
  sortDoneTasks,
  sortTasks,
  TASK_BUCKET_LABELS,
  TASK_SORT_LABELS,
  TASK_SORTS,
  type TaskBucketKey,
} from "@/services/notion/task-buckets";
import { EMPTY_TAG_CATALOG, type TagCatalog, type TagOption } from "@/services/notion/tag-options";
import { EMPTY_PLACE_CATALOG, type PlaceCatalog } from "@/services/notion/places";
import type { TaskItem, TaskPriority, WritableCalendar } from "@/types/calendar";
import type { RunningActivitySummary } from "@/types/activity";
import { dateKeyPlusMinutes } from "@/components/calendar/datetime-fields";

/** 期限での分類の並び。完了・対応しないは分類の軸によらず末尾へ別に置くため含めない。 */
const DUE_ORDER: Exclude<TaskBucketKey, "done" | "skipped">[] = [
  "overdue",
  "today",
  "tomorrow",
  "thisWeek",
  "nextWeek",
  "upcoming",
  "someday",
];

const DEFAULT_TASK_DUE_MINUTES = 18 * 60;

/** 画面に並べる1区分。期限での分類とタグでの分類のどちらもこの形にしてから描く。 */
type TaskSection = {
  key: string;
  /** 見出しの文字。タグの区分ではタグ名がそのまま入る。 */
  label: string;
  /** タグの区分かどうか。見出しをチップで描き、行からそのタグを外すのに使う。 */
  tagName: string | null;
  tasks: TaskItem[];
};

type TaskListData = {
  tasks: TaskItem[];
  /** 登録済みのタグ・種類。色の表示と入力の候補に使う。 */
  tagCatalog: TagCatalog;
  placeCatalog: PlaceCatalog;
  calendars: WritableCalendar[];
};

const EMPTY_TASKS: TaskItem[] = [];
const EMPTY_CALENDARS: WritableCalendar[] = [];

export function TaskList({
  timeZone,
  weekStartsOn = 0,
  runningActivity = null,
}: {
  timeZone: string;
  weekStartsOn?: number;
  /**
   * 記録中の項目（issue #629）。ナビの記録の項目へ印を出し、下部ナビの直上に記録中バーを
   * 出すために使う（docs/spec.md §27）。
   */
  runningActivity?: RunningActivitySummary | null;
}) {
  // 一覧・タグ・場所・カレンダーはページが待たずに、ここで背景取得する（issue #724）。
  // 追加ボタン・ナビは取得を待たない。入力ダイアログは候補が届く前でも開ける。
  const resource = useApiResource<TaskListData>(
    "/api/tasks/all",
    "Notionのタスクを取得できませんでした。",
  );
  const { data, reload } = resource;
  useWriteSynced(reload);
  // まだ届いていない完了・未完了の操作を重ねて描く（issue #1135）。
  const queuedWrites = usePendingWrites();
  const fetchedTasks = data?.tasks ?? EMPTY_TASKS;
  const tasks = useMemo(() => applyTaskOps(fetchedTasks, queuedWrites), [fetchedTasks, queuedWrites]);
  const tagCatalog = data?.tagCatalog ?? EMPTY_TAG_CATALOG;
  const placeCatalog = data?.placeCatalog ?? EMPTY_PLACE_CATALOG;
  const calendars = data?.calendars ?? EMPTY_CALENDARS;
  const loadError = resource.error;
  const pending = resource.loading;
  // 分類の軸・並び順・完了と対応しないの開閉は、選び直すまで端末に残す（issue #286）。
  const { groupBy, sort, doneOpen, skippedOpen, setGroupBy, setSort, setDoneOpen, setSkippedOpen } =
    useTaskViewPrefs();
  const [itemDialog, setItemDialog] = useState<ItemDrafts | null>(null);
  // タップした直後は表示専用画面を開く。編集アイコンを押したときだけ draft へ切り替える。
  const [viewingTask, setViewingTask] = useState<TaskItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // オフライン中は書き込みを止める（docs/spec.md §21）。
  const offline = useOffline();

  // オフラインでこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  // ナビからの移動はソフトナビゲーションで、Service Worker が保存できないため。
  useWarmOfflinePage("/tasks");

  const utils = useMemo(() => createCalendarDateUtils(timeZone), [timeZone]);
  const todayKey = utils.todayKey();
  const tagOptions = useMemo(() => tagCatalog.task ?? [], [tagCatalog]);

  // 分類の基準日は並び順と切り離し、予定日があれば予定日、無ければ期限にする（issue #903）。
  // 今週・来週は設定の週の開始曜日に従う。
  const buckets = useMemo(
    () => classifyTasks(tasks, todayKey, utils.itemDateKey, "planned", weekStartsOn),
    [tasks, todayKey, utils, weekStartsOn],
  );
  const bucketLabels = TASK_BUCKET_LABELS;

  // 分類の軸にタグを出してよいか。選択肢はNotionの取得に失敗しても空になり、その失敗は
  // 画面には出ない（services/notion/tag-options.ts）。タグが1つも無いまま切り替えられると、
  // 全件が「タグなし」の1区分に入り、壊れたように見える。タスク側にタグが付いていれば
  // 見出しの色と並びが既定に落ちるだけで分類はできるため、両方が空のときだけ隠す。
  const tagsAvailable =
    tagOptions.length > 0 || tasks.some((task) => !task.done && task.tags.length > 0);
  const effectiveGroupBy = tagsAvailable ? groupBy : "due";

  const sections = useMemo<TaskSection[]>(() => {
    if (effectiveGroupBy === "tag") {
      return groupTasksByTag(
        tasks,
        tagOptions.map((option) => option.name),
        sort,
      ).map((group) => ({
        key: group.key,
        label: group.name,
        // タグなしの区分だけは、チップではなく普通の文字で見出しを出す。
        tagName: group.key === NO_TAG_GROUP_KEY ? null : group.name,
        tasks: group.tasks,
      }));
    }

    return DUE_ORDER.map((key) => ({
      key,
      label: bucketLabels[key],
      tagName: null,
      tasks: sortTasks(buckets[key], sort),
    }));
  }, [effectiveGroupBy, sort, tasks, tagOptions, buckets, bucketLabels]);

  // バッジは期限だけで数える（services/notifications/badge.ts の countDueTasks と同じ式。
  // あちらはサーバー専用のモジュールを読み込むため、クライアントからは呼ばない）。
  const dueCount = useMemo(() => {
    const due = classifyTasks(tasks, todayKey, utils.itemDateKey, "due");
    return due.overdue.length + due.today.length;
  }, [tasks, todayKey, utils]);

  const doneTasks = useMemo(() => sortDoneTasks(buckets.done), [buckets]);
  const skippedTasks = useMemo(() => sortDoneTasks(buckets.skipped), [buckets]);

  const nextSort = () => setSort(TASK_SORTS[(TASK_SORTS.indexOf(sort) + 1) % TASK_SORTS.length]);

  const patchTaskDone = async (task: TaskItem, done: boolean, skipped = false) => {
    // オフライン中・先にためた操作があるときは、繰り返しなしの完了と未完了へ戻す操作だけ
    // 端末にためる。繰り返しの完了は次回分を新規作成するため、再送で二重に作られうる（issue #1135）。
    if (shouldQueueWrite(offline)) {
      if (skipped || (done && task.recurrence)) throw new Error(OFFLINE_WRITE_MESSAGE);
      submitWrite({ kind: "taskDone", taskId: task.id, done });
      return;
    }

    const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // 繰り返しタスクは完了時に次回分が作られるため、通常の更新とは別の経路で送る。
      body: JSON.stringify({ done, completeAction: true, ...(skipped ? { skipped: true } : {}) }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? "更新できませんでした。");
    }
  };

  const toggleDone = async (task: TaskItem, done: boolean) => {
    setBusyId(task.id);
    setError(null);
    try {
      await patchTaskDone(task, done);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新できませんでした。");
    } finally {
      setBusyId(null);
      reload();
    }
  };

  /** 表示画面からの完了切り替え。表示画面は自前で完了状態を持つため、ここでは取り直すだけでよい。 */
  const toggleDoneFromDetail = async (task: TaskItem, done: boolean, skipped = false) => {
    await patchTaskDone(task, done, skipped);
    reload();
  };

  const editTask = (task: TaskItem) => {
    if (offline) return;
    setViewingTask(null);
    setItemDialog({ task: toTaskDraft(task, timeZone) });
  };

  /**
   * 右下の「＋」からの追加。この画面で作れるのはタスクだけで、日付リマインドは
   * 専用一覧（/reminders）に寄せている（docs/spec.md §9・§15）。ひな型が1つのため
   * ItemDialog に切り替えは出ず、タスクの入力画面がそのまま開く。
   */
  const openAdd = () => {
    const drafts: ItemDrafts = {
      task: {
        dueMode: "datetime",
        due: dateKeyPlusMinutes(todayKey, DEFAULT_TASK_DUE_MINUTES),
      },
    };
    setItemDialog(drafts);
  };

  const renderTask = (task: TaskItem, section: TaskSection) => (
    <TaskRow
      key={task.id}
      task={task}
      // タグの区分では、見出しに出ているタグを行から外す。同じチップが二重に出るのを避けつつ、
      // 兼ねている他のタグは残して、どの区分にも出ていることが分かるようにする。
      hideTagName={section.tagName}
      tagOptions={tagOptions}
      progressOptions={tagCatalog.progress ?? null}
      utils={utils}
      todayKey={todayKey}
      disabled={busyId === task.id || offline}
      onToggleDone={(done) => toggleDone(task, done)}
      onOpen={() => setViewingTask(task)}
    />
  );

  return (
    <AppFrame
      current="tasks"
      activityRunning={runningActivity !== null}
      running={runningActivity}
    >
      <header className="flex items-center gap-1 bg-surface-container-low px-2 py-2">
        {/* 768px未満は左上をメニューにする（issue #328・#463）。768px以上は左端のサイドバーから
            画面を移る（issue #636）。 */}
        <AppMenuButton current="tasks" activityRunning={runningActivity !== null} />
        {/* いまどの画面にいるかは、ヘッダーのナビが無くなったぶんここで示す（issue #463）。
            狭い画面では下部ナビが同じことを示すため、PCだけに出す。 */}
        <div className="hidden shrink-0 items-center gap-1.5 font-semibold md:flex">
          <ListChecks className="size-5" />
          <span>タスク</span>
        </div>

        <span className="flex-1" />

        {tagsAvailable && (
          <Button
            variant="outline"
            size="sm"
            aria-label={effectiveGroupBy === "due" ? "タグで分類する" : "期限で分類する"}
            onClick={() => setGroupBy(effectiveGroupBy === "due" ? "tag" : "due")}
          >
            {effectiveGroupBy === "due" ? (
              <CalendarClock className="size-4" />
            ) : (
              <Tag className="size-4" />
            )}
            {effectiveGroupBy === "due" ? "期限" : "タグ"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          aria-label={`並び替え（いまは${TASK_SORT_LABELS[sort]}）`}
          onClick={nextSort}
        >
          <ArrowUpDown className="size-4" />
          {TASK_SORT_LABELS[sort]}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="再取得"
          // オフライン中に押しても、再接続まで終わらない読み込みが始まるだけになる。
          disabled={pending || offline}
          onClick={() => reload()}
        >
          <RefreshCw className="size-4" />
        </Button>
      </header>

      <LinearProgress active={pending || busyId !== null} />

      <OfflineNotice />
      {!offline && resource.stale && <SlowNetworkNotice />}

      {(loadError || error) && (
        <div className="bg-error-container/70 text-on-error-container px-3 py-2 text-xs">{loadError ?? error}</div>
      )}

      {/* アイコンのバッジは、取得した一覧から合わせる（docs/spec.md §32）。ここで別に取り直すと
          Notionへの往復が1回増えるため、一覧が届くまでは描かない。 */}
      {(data !== null || loadError) && (
        <AppBadgeSync tasks={data ? dueCount : null} />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24">
        {/*
          広い画面では区分をカードにして格子に並べ、全区分を一度に見せる（issue #636）。1列のままだと
          「今後」が長い日は、その下の「期限未設定」までスクロールしないと何件あるかが読めない。
          列の数は画面幅ではなく本文の幅（AppFrame の @container/main）で決める。
        */}
        <div className="@xl/main:grid @xl/main:grid-cols-2 @xl/main:items-start @xl/main:gap-3 @xl/main:p-3 @5xl/main:grid-cols-4">
          {sections.map((section) => {
            if (section.tasks.length === 0) return null;

            return (
              <section key={section.key} className={WIDE_SECTION_CARD_CLASS}>
                <h2
                  className={cn(
                    "sticky top-0 z-10 flex items-center gap-2 border-b border-rule bg-background/95 px-3 py-1 text-[11px] tracking-widest text-muted-foreground backdrop-blur",
                    WIDE_SECTION_HEADING_CLASS,
                  )}
                >
                  {section.tagName ? (
                    <TagChip
                      name={section.tagName}
                      color={tagColorOf(tagOptions, section.tagName)}
                      className="tracking-normal"
                    />
                  ) : (
                    section.label
                  )}
                  <span className="text-[10px] opacity-70">{section.tasks.length}</span>
                </h2>

                <ul className={WIDE_SECTION_LIST_CLASS}>
                  {section.tasks.map((task) => renderTask(task, section))}
                </ul>
              </section>
            );
          })}

          {/* 完了・対応しないは履歴として残るぶん件数が増え続ける（docs/spec.md §12）。既定では
              畳んでおき、見出しを押したときだけ開く。分類の軸によらず末尾に置き、それぞれ
              別見出し・別の開閉状態にする（issue #858）。広い画面でも区分の列には混ぜず、
              格子の下に全幅の1段ずつで置く。 */}
          <CollapsibleTaskSection
            label={bucketLabels.done}
            tasks={doneTasks}
            open={doneOpen}
            onToggle={() => setDoneOpen(!doneOpen)}
            renderTask={(task) => (
              <TaskRow
                key={task.id}
                task={task}
                hideTagName={null}
                tagOptions={tagOptions}
                progressOptions={null}
                utils={utils}
                todayKey={todayKey}
                disabled={busyId === task.id || offline}
                onToggleDone={(done) => toggleDone(task, done)}
                onOpen={() => setViewingTask(task)}
              />
            )}
          />

          <CollapsibleTaskSection
            label={bucketLabels.skipped}
            tasks={skippedTasks}
            open={skippedOpen}
            onToggle={() => setSkippedOpen(!skippedOpen)}
            renderTask={(task) => (
              <TaskRow
                key={task.id}
                task={task}
                hideTagName={null}
                tagOptions={tagOptions}
                progressOptions={null}
                utils={utils}
                todayKey={todayKey}
                disabled={busyId === task.id || offline}
                onOpen={() => setViewingTask(task)}
              />
            )}
          />

          {data === null && !loadError && <TaskListSkeleton />}

          {data !== null && tasks.length === 0 && !loadError && (
            <p className="p-6 text-center text-sm text-muted-foreground @xl/main:col-span-full">
              タスクがありません。
            </p>
          )}
        </div>
      </div>

      <Button
        size="icon"
        className={cn(
          "elevation-3 fixed right-4 z-20 size-16 rounded-[20px] bg-primary-container text-on-primary-container hover:brightness-95 active:rounded-[14px]",
          fabBottomOffsetClass(runningActivity !== null),
        )}
        aria-label="タスクを追加"
        disabled={offline}
        onClick={openAdd}
      >
        <Plus className="size-6" />
      </Button>

      <RunningActivityBar running={runningActivity} />
      <BottomNav current="tasks" activityRunning={runningActivity !== null} timeZone={timeZone} />

      {itemDialog && (
        <ItemDialog
          initialKind="task"
          drafts={itemDialog}
          calendars={calendars}
          tagCatalog={tagCatalog}
          placeCatalog={placeCatalog}
          timeZone={timeZone}
          weekStartsOn={weekStartsOn}
          onClose={() => setItemDialog(null)}
          onSaved={() => {
            setItemDialog(null);
            reload();
          }}
        />
      )}

      {viewingTask && (
        <TaskDetailDialog
          task={viewingTask}
          tagOptions={tagCatalog.task ?? []}
          progressOptions={tagCatalog.progress ?? null}
          timeZone={timeZone}
          readOnly={offline}
          onClose={() => setViewingTask(null)}
          onEdit={() => editTask(viewingTask)}
          onDeleted={() => {
            setViewingTask(null);
            reload();
          }}
          onToggleDone={toggleDoneFromDetail}
          // 紐づけの操作は表示画面のまま効く（docs/spec.md §31）。この画面は取得範囲を
          // 持たないため、変わった期間は見ずにページごと読み直す。
          onChanged={() => reload()}
        />
      )}
    </AppFrame>
  );
}

/**
 * 完了・対応しないの折りたたみ見出し。分類の軸によらず末尾に置く区画で、
 * 完了と対応しないをそれぞれ別見出し・別の開閉状態にするために共通化した（issue #858）。
 * 件数が0のときは区画ごと出さない（対応状況プロパティが無いDBでは skippedTasks が常に空になる）。
 */
function CollapsibleTaskSection({
  label,
  tasks,
  open,
  onToggle,
  renderTask,
}: {
  label: string;
  tasks: TaskItem[];
  open: boolean;
  onToggle: () => void;
  renderTask: (task: TaskItem) => ReactNode;
}) {
  if (tasks.length === 0) return null;

  return (
    <section className={cn(WIDE_SECTION_CARD_CLASS, "@xl/main:col-span-full")}>
      <h2
        className={cn(
          "sticky top-0 z-10 border-b border-rule bg-background/95 backdrop-blur",
          WIDE_SECTION_HEADING_CLASS,
        )}
      >
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] tracking-widest text-muted-foreground"
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {label}
          <span className="text-[10px] opacity-70">{tasks.length}</span>
        </button>
      </h2>

      {open && <ul className={WIDE_SECTION_LIST_CLASS}>{tasks.map((task) => renderTask(task))}</ul>}
    </section>
  );
}

/**
 * タスク1件の行。
 *
 * 1画面に入る件数を増やすため、タスク名は body-medium、日付・タグの行は label-small まで下げ、
 * 上下の余白も詰める（issue #286）。押せる大きさは変えない（チェックボックスは18dpのボックスに
 * 40dpの当たり判定を持つ）。
 */
/** 一覧の取得が済むまでの行の骨組み。追加ボタンとナビは待たずに使える（issue #724）。 */
function TaskListSkeleton() {
  return (
    <div role="status" aria-label="タスクを読み込み中" className="animate-pulse @xl/main:col-span-full">
      {Array.from({ length: 6 }, (_, row) => (
        <div key={row} className="flex items-center gap-2 py-3 pr-3 pl-3">
          <div className="size-[18px] rounded-xs bg-on-surface/10" />
          <div className={cn("h-4 rounded bg-on-surface/10", row % 2 ? "w-1/3" : "w-1/2")} />
        </div>
      ))}
    </div>
  );
}

function TaskRow({
  task,
  hideTagName,
  tagOptions,
  progressOptions,
  utils,
  todayKey,
  disabled,
  onToggleDone,
  onOpen,
}: {
  task: TaskItem;
  /** 見出しに出ているため行からは外すタグ。期限での分類では null。 */
  hideTagName: string | null;
  tagOptions: TagOption[];
  /** 進捗（issue #873）の色を引くために渡す。 */
  progressOptions: TagOption[] | null;
  utils: ReturnType<typeof createCalendarDateUtils>;
  todayKey: string;
  disabled: boolean;
  /**
   * 完了チェックボックスの切り替え。渡さないと行にチェックボックス自体を出さない
   * （対応しない区画の行では、行のチェックボックスは「完了」の意味しか持たせない・issue #858。
   * 対応しないの解除は表示画面〔TaskDetailDialog〕からのみ行う）。
   */
  onToggleDone?: (done: boolean) => void;
  onOpen: () => void;
}) {
  // どちらの日付欄で超過を示すかは、実際に分類に使った基準日（classifyDateOf）に合わせる。
  // 予定日があるタスクは「予定」欄を、無いタスクは「期限」欄を赤くする（issue #903）。
  const classifyDate = classifyDateOf(task, "planned");
  const classifyDateKey = classifyDate ? utils.itemDateKey(classifyDate) : null;
  const overdue = !task.done && classifyDateKey !== null && classifyDateKey < todayKey;
  const overdueLabel =
    classifyDateKey !== null && !task.done ? overdueDaysLabel(classifyDateKey, todayKey) : null;
  const overdueOnPlanned = task.planned != null;
  const tags = hideTagName ? task.tags.filter((name) => name !== hideTagName) : task.tags;

  return (
    <li className="flex items-start gap-2 border-b border-rule/50 py-1.5 pr-3 pl-2">
      <PriorityBar priority={task.priority} />

      {/*
        行のチェックボックスは「完了」の1つだけにする（issue #858）。「対応しない」への切り替えは
        表示画面（TaskDetailDialog）からのみ行い、一覧行からは操作できない。対応しない区画の行では
        onToggleDone を渡さないため、チェックボックス自体を出さない（メタ情報行の Ban バッジで
        対応しない状態を示す）。
      */}
      {onToggleDone && (
        <Checkbox
          className="mt-[3px]"
          checked={task.done && !task.skipped}
          disabled={disabled}
          aria-label={`${task.title} を完了にする`}
          onCheckedChange={(value) => onToggleDone(value === true)}
        />
      )}

      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div
          className={cn(
            "type-body-medium clip-nowrap",
            task.done && "text-on-surface-variant line-through",
          )}
        >
          {task.title}
        </div>

        <div className="type-label-small flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-normal text-on-surface-variant">
          {/* 進捗は片付いていないタスクにだけ出す。完了・対応しないでは意味が無い（issue #873）。 */}
          {task.progress && !task.done && (
            <TagChip name={task.progress} color={tagColorOf(progressOptions ?? [], task.progress)} />
          )}
          {task.skipped && (
            <span className="inline-flex items-center gap-0.5">
              <Ban className="size-3" aria-hidden />
              対応しない
            </span>
          )}
          {task.due && (
            <span className={cn(!overdueOnPlanned && overdue && "text-destructive")}>
              {formatTaskDate(task.due, task.hasTime, utils, todayKey)}
              {!overdueOnPlanned && overdueLabel && `・${overdueLabel}`}
            </span>
          )}
          {/*
            予定日は期限とは別の日付。分類・超過表示の基準は予定日があれば予定日、無ければ期限（issue #903）。
          */}
          {task.planned && (
            <span className={cn(overdueOnPlanned && overdue ? "text-destructive" : "opacity-80")}>
              予定 {formatTaskDate(task.planned, task.plannedHasTime, utils, todayKey)}
              {overdueOnPlanned && overdueLabel && `・${overdueLabel}`}
            </span>
          )}
          {/*
            予定への紐づけ（docs/spec.md §31）。この画面には予定が出ていないため、段階だけでは
            何の前後なのかが読めない。予定名まで添える。期限と予定日で別の予定へ紐づけられる
            ため、どちらの日付の紐づけなのかも添える（この行に日付は2つ並んでいる）。
          */}
          {task.links.map((link) => (
            <span key={link.id} className="inline-flex items-center gap-1 opacity-80">
              <TaskStageMark stage={link.stage} className="h-2.5 w-3" />
              {taskLinkTargetedLabel(link)}
            </span>
          ))}
          {task.recurrence && task.recurrence !== "なし" && (
            <span className="opacity-80">{task.recurrence}</span>
          )}
          <TagChipList names={tags} options={tagOptions} />
        </div>
      </button>
    </li>
  );
}

/**
 * 行の左端に出す優先度の帯。
 *
 * バッジで「高」と書くと日付やタグと同じ文字の列に混ざり、縦に並べたときどれが急ぐのか読めない
 * （issue #286）。色だけに意味を持たせないよう、読み上げ用の文字を添える。
 */
function PriorityBar({ priority }: { priority: TaskPriority }) {
  const tone = priority === "高" ? "bg-destructive" : priority === "中" ? "bg-tertiary" : null;

  if (!tone) return <span className="w-[3px] shrink-0" aria-hidden />;

  return (
    <>
      <span className={cn("w-[3px] shrink-0 self-stretch rounded-full", tone)} aria-hidden />
      <span className="sr-only">優先度 {priority}</span>
    </>
  );
}

function formatTaskDate(
  date: string,
  hasTime: boolean,
  utils: ReturnType<typeof createCalendarDateUtils>,
  todayKey: string,
): string {
  const dateKey = utils.itemDateKey(date);
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  // 今年の日付では年を出さない。ほとんどの期限は今年のもので、行の幅を年に使うと
  // 項目名に回せる幅がそのぶん減る。
  const label =
    dateKey.slice(0, 4) === todayKey.slice(0, 4)
      ? `${month}/${day}`
      : `${dateKey.slice(0, 4)}/${month}/${day}`;

  return hasTime ? `${label} ${utils.formatTime(date)}` : label;
}
