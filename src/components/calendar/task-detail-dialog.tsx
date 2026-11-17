"use client";

import { useState, type ReactNode } from "react";

import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  CalendarClock,
  CalendarDays,
  ExternalLink,
  Flag,
  Link2,
  NotebookText,
  Pencil,
  Repeat,
  Tag,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { TagChipList } from "@/components/tags/tag-chip";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/services/notion/tag-options";
import type { TaskEventLinkItem, TaskEventStage, TaskItem } from "@/types/calendar";

import { DeleteItemDialog } from "./delete-item-dialog";
import {
  formatLinkedDate,
  taskLinkFullLabel,
  taskLinkStageLabel,
  taskLinkTargetLabel,
} from "./task-link-label";
import { TaskStageMark } from "./task-stage-mark";
import { TaskStagePicker } from "./task-stage-picker";
import { readErrorMessage } from "./response-error";
import { taskRanges, type TouchedRange } from "./use-calendar-chunks";

export function TaskDetailDialog({
  task,
  tagOptions,
  timeZone,
  readOnly = false,
  offlineEditable = false,
  onClose,
  onEdit,
  onDeleted,
  onToggleDone,
  onChanged,
}: {
  task: TaskItem;
  /** 登録済みのタグ。色を引くために渡す。取得できていないときは空でよい。 */
  tagOptions: TagOption[];
  timeZone: string;
  /** 閲覧のみにする。オフライン中に使う（docs/spec.md §21）。 */
  readOnly?: boolean;
  /** オフライン中でも編集・完了切り替えを受ける（端末にためて同期する画面だけ。issue #1242）。 */
  offlineEditable?: boolean;
  onClose: () => void;
  onEdit: () => void;
  /** 削除後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onDeleted: (touched: TouchedRange[] | null) => void;
  /** 完了状態の切り替え。表示画面のままでも設定できるようにするため、保存とは別経路で呼ぶ。 */
  onToggleDone: (task: TaskItem, done: boolean, skipped?: boolean) => Promise<void>;
  /** 画面を開いたまま内容が変わったときの通知（紐づけの操作）。変わった期間だけ取り直す。 */
  onChanged: (touched: TouchedRange[] | null) => void;
}) {
  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  const [done, setDone] = useState(task.done);
  // 「対応しない」は完了と別の状態（issue #750）。どちらか一方だけが立つ。
  const [skipped, setSkipped] = useState(task.skipped);
  // 予定への紐づけ（docs/spec.md §31）。段階の変更・ずれの解消・解除はこの画面で行う。
  // 保存を挟まずその場で効かせるのは、完了の切り替えと同じく、押した結果が期限・予定日という
  // 別の項目に現れるため。編集画面まで往復させると何が変わったのか追いにくい。
  // 行き先ごとに1件のため、多くても期限と予定日の2件が並ぶ。
  const [links, setLinks] = useState(task.links);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 削除は押した直後には実行せず、確認を挟む。
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) close();
  };

  const edit = () => {
    setOpen(false);
    setTimeout(onEdit, 150);
  };

  const deleted = (touched: TouchedRange[] | null) => {
    setOpen(false);
    setTimeout(() => onDeleted(touched), 150);
  };

  /** 段階の変更と「予定に合わせる」。どちらも予定から日時を決め直して行き先へ入れる。 */
  const resyncLink = async (link: TaskEventLinkItem, stage?: TaskEventStage) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/task-links/${encodeURIComponent(link.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stage ? { stage } : {}),
      });

      if (!response.ok) {
        setError(await readErrorMessage(response, "予定に合わせられませんでした。"));
        return;
      }

      const result = (await response.json()) as { date?: string };
      const date = result.date ?? link.resolvedAt;

      setLinks((current) =>
        current.map((item) =>
          item.id === link.id
            ? {
                ...item,
                stage: stage ?? item.stage,
                resolvedAt: date,
                resolvedAllDay: !date.includes("T"),
                drifted: false,
                expectedAt: null,
              }
            : item,
        ),
      );

      // 行き先の日付が動いたため、移動元と移動先の両方を取り直す。閉じずに続けて操作できるよう、
      // 画面はそのままにする。
      onChanged([...taskRanges(task), { start: date, end: date }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "予定に合わせられませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (link: TaskEventLinkItem) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/task-links/${encodeURIComponent(link.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "紐づけを解除できませんでした。"));
        return;
      }
      setLinks((current) => current.filter((item) => item.id !== link.id));
      onChanged(taskRanges(task));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "紐づけを解除できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const dueLink = links.find((link) => link.target === "DUE") ?? null;
  const plannedLink = links.find((link) => link.target === "PLANNED") ?? null;

  const toggleSkipped = async (value: boolean) => {
    setDone(value);
    setSkipped(value);
    setBusy(true);
    setError(null);
    try {
      await onToggleDone(task, value, true);
    } catch (cause) {
      setDone(!value);
      setSkipped(!value);
      setError(cause instanceof Error ? cause.message : "更新できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const toggleDone = async (value: boolean) => {
    const wasSkipped = skipped;
    setDone(value);
    setSkipped(false);
    setBusy(true);
    setError(null);
    try {
      await onToggleDone(task, value);
    } catch (cause) {
      setDone(!value);
      setSkipped(wasSkipped);
      setError(cause instanceof Error ? cause.message : "更新できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-x-hidden overflow-y-auto">
        {confirmingDelete && (
          <DeleteItemDialog
            item={{ kind: "task", task }}
            onCancel={() => setConfirmingDelete(false)}
            onDeleted={deleted}
          />
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="削除"
          className="absolute top-2 right-18"
          disabled={readOnly}
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="編集"
          className="absolute top-2 right-10"
          disabled={readOnly && !offlineEditable}
          onClick={edit}
        >
          <Pencil className="size-4" />
        </Button>

        <DialogHeader>
          <DialogTitle className={cn("pr-22", done && "text-on-surface-variant line-through")}>
            {task.title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3 text-sm">
          {/*
            完了と対応しないは1つの分割ボタンにまとめる（issue #1660）。左は完了のトグル、
            右の▾から「対応しない」へ切り替える。完了の切り替えだけオフラインでも受け、
            対応しないは従来どおりオンラインのみ（issue #750・#1242）。
          */}
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "inline-flex overflow-hidden rounded-md border text-base select-none md:text-sm",
                skipped
                  ? "border-transparent bg-surface-container-highest text-on-surface-variant"
                  : done
                    ? "border-transparent bg-secondary-container text-on-secondary-container"
                    : "border-outline text-on-surface",
              )}
            >
              <button
                type="button"
                className="flex min-h-11 items-center gap-2 px-4 outline-none hover:bg-on-surface/8 disabled:pointer-events-none disabled:opacity-38"
                disabled={busy || (readOnly && !offlineEditable)}
                onClick={() => (skipped ? toggleDone(false) : toggleDone(!done))}
              >
                {skipped ? (
                  <Ban className="size-4" aria-hidden />
                ) : done ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <span className="size-4 rounded-[3px] border-2 border-current" aria-hidden />
                )}
                {skipped ? "対応しない" : done ? "完了" : "完了にする"}
              </button>

              {(task.canSkip || skipped) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="状態を選ぶ"
                      className="flex min-h-11 items-center border-l border-current/30 px-2.5 outline-none hover:bg-on-surface/8 disabled:pointer-events-none disabled:opacity-38"
                      disabled={busy || readOnly}
                    >
                      <ChevronDown className="size-4" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {(done || skipped) && (
                      <DropdownMenuItem onSelect={() => void toggleDone(false)}>
                        未完了に戻す
                      </DropdownMenuItem>
                    )}
                    {!(done && !skipped) && (
                      <DropdownMenuItem onSelect={() => void toggleDone(true)}>
                        <Check aria-hidden />
                        完了
                      </DropdownMenuItem>
                    )}
                    {!skipped && (
                      <DropdownMenuItem onSelect={() => void toggleSkipped(true)}>
                        <Ban aria-hidden />
                        対応しない
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {readOnly && <p className="text-xs text-on-surface-variant">{OFFLINE_WRITE_MESSAGE}</p>}

          {task.due && (
            <DetailField
              icon={<CalendarClock className="size-4" />}
              value={
                dueLink
                  ? `期限: ${formatTaskDate(task.due, task.hasTime, timeZone)}（予定に合わせて入る）`
                  : `期限: ${formatTaskDate(task.due, task.hasTime, timeZone)}`
              }
            />
          )}
          {task.planned && (
            <DetailField
              icon={<CalendarDays className="size-4" />}
              value={
                plannedLink
                  ? `予定日: ${formatTaskDate(task.planned, task.plannedHasTime, timeZone)}（予定に合わせて入る）`
                  : `予定日: ${formatTaskDate(task.planned, task.plannedHasTime, timeZone)}`
              }
            />
          )}

          {/*
            紐づけは行き先ごとに1件で、期限と予定日の両方に持てる（docs/spec.md §31）。
            2つ並んだときにどちらの日付の話なのかが読めるよう、見出しに行き先を入れる。
          */}
          {/* 持ち物タスク（issue #1080）。対象の予定と、期限の基準の移動を示す。 */}
          {task.bring && (
            <DetailField
              icon={<Link2 className="size-4" />}
              value={`「${task.bring.eventTitle}」の持ち物${
                dueLink?.travelId ? `（期限の基準: ${dueLink.eventTitle} の出発）` : "（移動未設定）"
              }`}
            />
          )}

          {links.map((link) => (
            <div
              key={link.id}
              className="flex min-w-0 flex-col gap-2 border-l-[3px] border-secondary-container py-1 pl-3"
            >
              <span className="text-xs text-muted-foreground">
                {taskLinkTargetLabel(link)}を予定に合わせる
              </span>

              <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-secondary-container px-2.5 py-1 text-on-secondary-container">
                <TaskStageMark
                  stage={link.stage}
                  className="h-3.5 w-4.5 text-on-secondary-container"
                />
                {taskLinkFullLabel(link)}
              </span>

              {/*
                DaySpanの外で予定が動いた場合は、取得のたびにNotionへ書き戻さず画面に出す
                （docs/spec.md §20・§31）。押されたときだけ合わせる。
              */}
              {link.drifted && link.expectedAt && (
                <div className="flex flex-col gap-2 rounded-lg bg-error-container px-3 py-2 text-on-error-container">
                  <span className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    {taskLinkTargetLabel(link)}が紐づけ先と合っていません。「{link.eventTitle}」の
                    {taskLinkStageLabel(link)}は {formatLinkedDate(link.expectedAt, timeZone)} です。
                  </span>
                  <Button
                    size="sm"
                    className="w-fit"
                    disabled={busy || readOnly}
                    onClick={() => resyncLink(link)}
                  >
                    予定に合わせる
                  </Button>
                </div>
              )}

              <TaskStagePicker
                value={link.stage}
                label="いつやるか"
                disabled={busy || readOnly}
                onChange={(stage) => resyncLink(link, stage)}
              />

              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                disabled={busy || readOnly}
                onClick={() => unlink(link)}
              >
                紐づけを解除
              </Button>
            </div>
          ))}

          {task.priority && <DetailField icon={<Flag className="size-4" />} value={`優先度: ${task.priority}`} />}
          {task.recurrence && task.recurrence !== "なし" && (
            <DetailField icon={<Repeat className="size-4" />} value={`繰り返し: ${task.recurrence}`} />
          )}
          {task.tags.length > 0 && (
            <DetailField icon={<Tag className="size-4" />}>
              <TagChipList names={task.tags} options={tagOptions} />
            </DetailField>
          )}
          {/* 外部リンク（Morrowのメール詳細など。issue #1508）。素の <a> にして、Universal Linkに対応するアプリが入っていればアプリで開かせる。 */}
          {(task.externalLinks?.length ?? 0) > 0 && (
            <DetailField icon={<ExternalLink className="size-4" />}>
              <ul className="flex flex-col gap-1">
                {task.externalLinks?.map((link, index) => (
                  <li key={`${index}:${link.url}`} className="min-w-0">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-full items-center gap-1 break-all text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="size-3 shrink-0" />
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </DetailField>
          )}
          {/* モーダル全体を1画面に収めるため、メモは高さを固定して中だけスクロールさせる（issue #1494）。 */}
          {task.memo && (
            <DetailField
              icon={<NotebookText className="size-4" />}
              value={task.memo}
              valueClassName="max-h-60 overflow-x-hidden overflow-y-auto"
            />
          )}

          {task.url && (
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              <ExternalLink className="size-3" />
              Notionで開く
            </a>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** アイコン付きの行。予定・移動の詳細と同じ形（issue #1583）。文字だけの項目は value、形のある項目は children で渡す。 */
function DetailField({
  icon,
  value,
  children,
  valueClassName,
}: {
  icon: ReactNode;
  value?: string;
  children?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
                {children ??
          (value !== undefined &&
            (valueClassName ? (
              <div className={valueClassName}>
                <LinkifiedText as="span" text={value} />
              </div>
            ) : (
              <LinkifiedText as="span" text={value} />
            )))}
      </div>
    </div>
  );
}

/** 期限・予定日の表示用フォーマット。日付のみは日付を、時刻ありは日付と時刻を表示する。 */
function formatTaskDate(date: string, hasTime: boolean, timeZone: string): string {
  if (!hasTime) return formatDateKey(date);

  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(date));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("month")}月${get("day")}日 ${get("hour")}:${get("minute")}`;
}

function formatDateKey(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`;
}
