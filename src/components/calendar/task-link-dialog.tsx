"use client";

import { useEffect, useMemo, useState } from "react";

import { useOffline } from "next/offline";
import { Plus } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { resolveStageDate } from "@/services/task-links/stage";
import {
  DEFAULT_TASK_LINK_TARGET,
  TASK_LINK_TARGETS,
  TASK_LINK_TARGET_LABELS,
  type CalendarEventItem,
  type TaskEventStage,
  type TaskItem,
  type TaskLinkTarget,
  type TravelItem,
} from "@/types/calendar";

import { formatLinkedDate, taskLinkTargetLabel, taskLinkTargetedLabel } from "./task-link-label";
import { TaskStagePicker } from "./task-stage-picker";
import { readErrorMessage } from "./response-error";
import { taskRanges, withTaskLinks, type TouchedRange } from "./use-calendar-chunks";

/**
 * 予定にタスクを登録する（docs/spec.md §31）。
 *
 * 「タスクを紐づける」「タスクを作成」に分かれていた入口を1つに統合したもので、
 * 既存のタスクから選ぶか、その場で新しく作るかをこのダイアログの中で選べる（issue #835）。
 * 「新しいタスクを作る」を一覧の先頭に置くのは、以前フッターの目立たない位置にしかなく
 * 気づきにくかったため（issue #794）。既存タスクを選ぶのと対等な操作に見せる。
 *
 * 選ぶ相手は「カレンダーに出ているタスク」では足りない。期限も予定日も無いタスクは
 * カレンダーに置く日が決まらず表示されていないが（docs/spec.md §10）、それこそが
 * 「いつやるか決まっていない」＝紐づけたいタスクであるため、ここで別に取りにいく。
 */
export function TaskLinkDialog({
  event: eventProp,
  travel,
  timeZone,
  onCancel,
  onCreateTask,
  onLinked,
}: {
  /** 紐づけ先が予定のとき。移動のときは travel を渡す。 */
  event?: CalendarEventItem;
  /** 紐づけ先が移動のとき（issue #914）。段階は出発・到着の呼び名になる。 */
  travel?: TravelItem;
  timeZone: string;
  onCancel: () => void;
  /** 紐づけた状態で新しいタスクを作る。入力画面へ渡す。 */
  onCreateTask?: (stage: TaskEventStage, target: TaskLinkTarget) => void;
  /** 紐づけ後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onLinked: (touched: TouchedRange[] | null) => void;
}) {
  // 移動は終日にならない。段階の起点（出発・到着）と表示名だけ予定と同じ形に直して以降は共通に扱う。
  const event = (eventProp ??
    (travel && {
      title: travel.title,
      calendarId: "",
      id: "",
      allDay: false,
      start: travel.start,
      end: travel.end,
    })) as CalendarEventItem;

  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  const [stage, setStage] = useState<TaskEventStage>("BEFORE_START");
  // 行き先の初期値は予定日。行き先を選べるようになる前と同じ操作で同じ結果になるようにする
  // （docs/spec.md §31）。
  const [target, setTarget] = useState<TaskLinkTarget>(DEFAULT_TASK_LINK_TARGET);
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offline = useOffline();

  useEffect(() => {
    let cancelled = false;

    // 未完了のタスクを取りにいく。紐づけ先を選ぶときだけの取得で、カレンダーの取得には混ぜない
    // （月を送るたびにNotionへの往復が増えるため。タグの取得を分けているのと同じ理由）。
    fetch("/api/tasks")
      .then(async (response) => {
        if (!response.ok) throw new Error(await readErrorMessage(response, "タスクを取得できませんでした。"));
        return (await response.json()) as { tasks: TaskItem[] };
      })
      .then((data) => {
        // 保存済みの応答（Service Worker）は紐づけが1件だった頃の形のことがある。
        if (!cancelled) setTasks(withTaskLinks(data.tasks));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setTasks([]);
        setError(cause instanceof Error ? cause.message : "タスクを取得できませんでした。");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => {
    setOpen(false);
    setTimeout(onCancel, 150);
  };

  const resolved = resolveStageDate(event, stage);
  const targetLabel = TASK_LINK_TARGET_LABELS[target];

  const filtered = useMemo(() => {
    if (!tasks) return [];
    const keyword = query.trim();
    if (!keyword) return tasks;
    return tasks.filter((task) => task.title.includes(keyword));
  }, [tasks, query]);

  const selected = tasks?.find((task) => task.id === selectedId) ?? null;
  // 置き換わるのは同じ行き先の紐づけだけ。もう一方はそのまま残る（行き先ごとに1件）。
  const replacedLink = selected?.links.find((item) => item.target === target) ?? null;
  const keptLink = selected?.links.find((item) => item.target !== target) ?? null;
  const existingDate = selected ? (target === "DUE" ? selected.due : selected.planned) : null;

  const link = async () => {
    if (!selected) return;

    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/task-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: selected.id,
          ...(travel
            ? { travelId: travel.id }
            : { calendarId: event.calendarId, eventId: event.id }),
          stage,
          target,
        }),
      });

      if (!response.ok) {
        setError(await readErrorMessage(response, "紐づけできませんでした。"));
        return;
      }

      const result = (await response.json()) as { date?: string };
      const date = result.date ?? resolved.date;

      // 行き先の日付が動くため、移動元と移動先の両方を取り直す。動かないほうの日付は
      // そのまま渡し、同じタスクのもう一方の枠を消してしまわないようにする。
      const touched: TouchedRange[] = [
        ...taskRanges(selected),
        ...taskRanges(
          target === "DUE"
            ? { due: date, planned: selected.planned }
            : { due: selected.due, planned: date },
        ),
      ];

      setOpen(false);
      setTimeout(() => onLinked(touched), 150);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "紐づけできませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const createTask = () => {
    setOpen(false);
    setTimeout(() => onCreateTask?.(stage, target), 150);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>「{event.title}」にタスクを登録</DialogTitle>
          <DialogDescription className="type-body-small text-on-surface-variant">
            選んだ段階から決まる日時が、タスクの{targetLabel}に入ります。{travel ? "移動" : "予定"}を動かすと{targetLabel}
            も動きます。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          {/*
            行き先（docs/spec.md §31）。締切そのものが予定で決まる場合（会議で提出する）と、
            いつ手を付けるかが決まる場合があり、選べないとどちらかを手で書き写すことになる。
          */}
          <div className="flex flex-col gap-1.5">
            <Label>紐づける日付</Label>
            <div className="flex flex-wrap gap-1">
              {TASK_LINK_TARGETS.map((value) => {
                const selectedTarget = value === target;

                return (
                  <Button
                    key={value}
                    type="button"
                    variant={selectedTarget ? "secondary" : "outline"}
                    size="sm"
                    className={cn(selectedTarget && "text-on-secondary-container")}
                    onClick={() => setTarget(value)}
                  >
                    {TASK_LINK_TARGET_LABELS[value]}
                  </Button>
                );
              })}
            </div>
          </div>

          <TaskStagePicker value={stage} travel={Boolean(travel)} onChange={setStage} />

          <div className="flex flex-col gap-1.5">
            <Label>タスク</Label>
            <Input
              id="task-link-search"
              label="タスクを探す"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <div className="max-h-56 overflow-y-auto rounded-md border border-outline-variant">
              {/*
                新しいタスクを作る（issue #835）。以前はフッター左下にしかなく気づきにくかった
                （issue #794）ため、一覧の先頭に固定し、既存タスクから選ぶのと対等な選択肢にする。
                読み込み中・0件でも押せる（既存タスクの有無に関わらず新規作成はできるため）。
              */}
              {onCreateTask && (
                <button
                  type="button"
                  onClick={createTask}
                  disabled={busy || offline}
                  className="flex w-full items-center gap-2 border-b border-outline-variant bg-secondary-container px-3 py-2 text-left text-sm font-medium text-on-secondary-container hover:brightness-95 disabled:opacity-38"
                >
                  <Plus className="size-4" />
                  新しいタスクを作る
                </button>
              )}

              {tasks === null && (
                <p className="px-3 py-4 text-sm text-muted-foreground">読み込んでいます…</p>
              )}
              {tasks !== null && filtered.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  {tasks.length === 0 ? "未完了のタスクがありません。" : "見つかりませんでした。"}
                </p>
              )}
              {filtered.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedId(task.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border-b border-outline-variant px-3 py-2 text-left text-sm last:border-b-0",
                    task.id === selectedId
                      ? "bg-secondary-container text-on-secondary-container font-medium"
                      : "hover:bg-surface-container-high",
                  )}
                >
                  <span className="clip-nowrap">{task.title}</span>
                  {/*
                    すでに同じ行き先へ紐づいているタスクは、選ぶとその紐づけが置き換わる
                    （紐づけは行き先ごとに1件）。どちらの日付の紐づけなのかまで添え、
                    押した結果どれが置き換わるのかを押す前に読めるようにする。
                  */}
                  <span className="shrink-0 text-xs opacity-70">
                    {task.links.length > 0
                      ? task.links
                          .map((item) => `${taskLinkTargetLabel(item)}: ${item.eventTitle}`)
                          .join(" / ")
                      : task.due
                        ? formatLinkedDate(task.due, timeZone)
                        : "期限なし"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-sm text-on-surface-variant">
            {targetLabel}は <b>{formatLinkedDate(resolved.date, timeZone)}</b> になります。
            {/*
              同じ行き先の紐づけだけが置き換わる。もう一方の行き先の紐づけは残るため、
              どちらが外れてどちらが残るのかをここで示す。
            */}
            {replacedLink
              ? `「${replacedLink.eventTitle}」への${targetLabel}の紐づけは外れます。`
              : existingDate
                ? `すでに入っている${targetLabel}は上書きされます。`
                : null}
            {keptLink ? `${taskLinkTargetedLabel(keptLink)}への紐づけはそのまま残ります。` : null}
          </p>

          {offline && <p className="text-xs text-on-surface-variant">{OFFLINE_WRITE_MESSAGE}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={close}>
            やめる
          </Button>
          <Button disabled={busy || offline || !selected} onClick={link}>
            紐づける
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
