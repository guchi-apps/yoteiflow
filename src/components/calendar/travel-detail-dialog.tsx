"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { CalendarClock, ChevronRight, CloudOff, Link2, MapPin, Pencil, Route, Trash2, Unlink } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { placeDisplayName } from "@/lib/place-text";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { cn } from "@/lib/utils";
import {
  TRAVEL_MODE_LABELS,
  type TaskEventStage,
  type TaskItem,
  type TaskLinkTarget,
  type TravelItem,
} from "@/types/calendar";

import { DeleteItemDialog } from "./delete-item-dialog";
import { TravelLinkFlow, unlinkTravel } from "./travel-link-flow";
import { TaskLinkDialog } from "./task-link-dialog";
import { taskLinkTargetLabel } from "./task-link-label";
import { TaskStageMark } from "./task-stage-mark";
import { estimateSourceLabel } from "./travel-estimate-notes";
import type { TouchedRange } from "./use-calendar-chunks";

/**
 * 移動の表示画面（docs/spec.md §29）。
 *
 * 削除はここからも行える。消すためだけに編集画面を開かせないため（docs/spec.md §15）。
 */
export function TravelDetailDialog({
  travel,
  timeZone,
  readOnly = false,
  onClose,
  onEdit,
  onDeleted,
  linkedTasks = [],
  onOpenTask,
  onLinked,
  onCreateTask,
  linkedEventTitle,
  weekStartsOn = 0,
}: {
  travel: TravelItem;
  timeZone: string;
  /** 閲覧のみにする。オフライン中に使う（docs/spec.md §21）。 */
  readOnly?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: (touched: TouchedRange[] | null) => void;
  /** この移動に紐づいているタスク（issue #914）。出発前に確かめるタスクなどを置く。 */
  linkedTasks?: TaskItem[];
  /** 紐づいたタスクを開く。移動の表示画面は閉じてタスクの詳細へ移る。 */
  onOpenTask?: (task: TaskItem) => void;
  /** タスクを紐づけたあと。変わった期間を渡して取り直す。 */
  onLinked?: (touched: TouchedRange[] | null) => void;
  /** 紐づけた状態で新しいタスクを作る（issue #1079）。入力画面へ渡す。 */
  onCreateTask?: (stage: TaskEventStage, target: TaskLinkTarget) => void;
  /** 紐づいている予定の名前。取得済みの予定から引いた値で、範囲外などで引けなければ null。 */
  linkedEventTitle?: string | null;
  weekStartsOn?: number;
}) {
  // 既存の予定を後から結ぶ・外す（issue #1105）。
  const [linkingEvent, setLinkingEvent] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [linking, setLinking] = useState(false);

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const edit = () => {
    setOpen(false);
    setTimeout(onEdit, 150);
  };

  const linkTask = () => {
    setOpen(false);
    setTimeout(() => setLinking(true), 150);
  };

  const startLinkEvent = () => {
    setOpen(false);
    setTimeout(() => setLinkingEvent(true), 150);
  };

  const unlink = async () => {
    setUnlinkError(null);
    const message = await unlinkTravel(travel.id);
    if (message) {
      setUnlinkError(message);
      return;
    }
    setOpen(false);
    setTimeout(() => onLinked?.([{ start: travel.start, end: travel.end }]), 150);
  };

  const openTask = (task: TaskItem) => {
    setOpen(false);
    setTimeout(() => onOpenTask?.(task), 150);
  };

  const deleted = (touched: TouchedRange[] | null) => {
    setOpen(false);
    setTimeout(() => onDeleted(touched), 150);
  };

  const minutes = Math.max(
    1,
    Math.round((new Date(travel.end).getTime() - new Date(travel.start).getTime()) / 60_000),
  );

  if (linkingEvent) {
    return (
      <TravelLinkFlow
        side={{ kind: "travel", travel }}
        timeZone={timeZone}
        weekStartsOn={weekStartsOn}
        onCancel={onClose}
        onLinked={(touched) => onLinked?.(touched)}
      />
    );
  }

  if (linking) {
    return (
      <TaskLinkDialog
        travel={travel}
        timeZone={timeZone}
        onCancel={onClose}
        onLinked={(touched) => onLinked?.(touched)}
        onCreateTask={onCreateTask}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {confirmingDelete && (
          <DeleteItemDialog
            item={{ kind: "travel", travel }}
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
          disabled={readOnly}
          onClick={edit}
        >
          <Pencil className="size-4" />
        </Button>

        <DialogHeader>
          <DialogTitle className="pr-22">{travel.title}</DialogTitle>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3 text-sm">
          <DetailRow icon={<CalendarClock className="size-4" />}>
            {formatTravelTime(travel, timeZone)}
          </DetailRow>

          <DetailRow icon={<Route className="size-4" />}>
            {TRAVEL_MODE_LABELS[travel.mode]} {minutes}分
            {travel.estimated && (
              <span className="text-on-surface-variant">
                {estimateSourceLabel(travel.estimateSource)}
              </span>
            )}
          </DetailRow>

          <DetailRow icon={<MapPin className="size-4" />}>
            <span className="flex flex-col">
              <span>出発地: {placeDisplayName(travel.origin)}</span>
              <span>目的地: {placeDisplayName(travel.destination)}</span>
            </span>
          </DetailRow>

          {travel.note && <LinkifiedText className="text-on-surface-variant" text={travel.note} />}

          {/* 書き出せていない移動はDaySpanの中だけに見える。他の端末で探しても出てこないため伝える。 */}
          {!travel.exported && (
            <DetailRow icon={<CloudOff className="size-4" />}>
              <span className="text-xs text-on-surface-variant">
                Googleカレンダーには書き出されていません。設定 ▸ 移動 で書き出し先を確認してください。
              </span>
            </DetailRow>
          )}

          {/* 紐づく予定（issue #1105）。後からでも結べ、付け替え・外すこともできる。 */}
          <DetailRow icon={<Link2 className="size-4" />}>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {travel.linkedEventId
                  ? `${travel.returnLeg ? "復路" : "往路"}: ${linkedEventTitle ?? "予定（表示範囲外）"}`
                  : "予定とは紐づいていません"}
              </span>
              <Button variant="outline" size="sm" disabled={readOnly} onClick={startLinkEvent}>
                {travel.linkedEventId ? "付け替える" : "予定と紐づける"}
              </Button>
              {travel.linkedEventId && (
                <Button variant="ghost" size="sm" disabled={readOnly} onClick={unlink}>
                  <Unlink className="size-4" />
                  外す
                </Button>
              )}
            </span>
          </DetailRow>
          {unlinkError && <p className="text-xs text-destructive">{unlinkError}</p>}

          {/* この移動に紐づいているタスク（issue #914）。出発前に確かめるものなど。 */}
          {linkedTasks.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {linkedTasks.map((task) => {
                const links = task.links.filter((link) => link.travelId === travel.id);
                if (links.length === 0) return null;

                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => openTask(task)}
                    className="flex items-center gap-2 rounded-md border border-secondary-container bg-secondary-container/40 py-1.5 pr-2.5 text-left text-xs text-on-surface"
                    style={{ borderLeftWidth: "3px", paddingLeft: "8px" }}
                  >
                    <TaskStageMark
                      stage={links[0].stage}
                      drifted={links.some((link) => link.drifted)}
                      className="h-4 w-5 shrink-0"
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        task.done && "text-on-surface-variant line-through",
                      )}
                    >
                      {task.title}
                      <span className="opacity-75">
                        （{links.map((link) => taskLinkTargetLabel(link)).join("・")}）
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 opacity-70" />
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="bg-secondary-container text-on-secondary-container"
              disabled={readOnly}
              onClick={linkTask}
            >
              <TaskStageMark stage="BEFORE_START" className="h-4 w-5 text-on-secondary-container" />
              タスクを登録
            </Button>
          </div>

          {readOnly && <p className="text-xs text-on-surface-variant">{OFFLINE_WRITE_MESSAGE}</p>}
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

function DetailRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** 「2026年8月15日 8:20 – 9:00」。日をまたぐ移動は到着側にも日付を添える。 */
export function formatTravelTime(travel: TravelItem, timeZone: string): string {
  const date = (iso: string) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone,
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));

  const time = (iso: string) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));

  const startDate = date(travel.start);
  const endDate = date(travel.end);

  return startDate === endDate
    ? `${startDate} ${time(travel.start)} – ${time(travel.end)}`
    : `${startDate} ${time(travel.start)} – ${endDate} ${time(travel.end)}`;
}
