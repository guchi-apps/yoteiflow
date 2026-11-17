"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { Bell, CalendarClock, ChevronRight, CloudOff, ExternalLink, Link2, MapPin, Pencil, Route, Trash2 } from "lucide-react";

import { Accordion } from "@/components/ui/accordion";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { eventLeadLabel } from "@/lib/event-notification";
import { mapLink } from "@/lib/map-link";
import { placeDisplayName } from "@/lib/place-text";
import type { PlaceItem } from "@/services/notion/places";
import { TRAVEL_RELATION_LABELS, travelRelation } from "@/lib/travel-relation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  TRAVEL_MODE_LABELS,
  type TaskEventStage,
  type TaskItem,
  type TaskLinkTarget,
  type TravelItem,
  type TravelMode,
} from "@/types/calendar";

import { tintedEventColors } from "./calendar-color";
import { DeleteItemDialog } from "./delete-item-dialog";
import { placeCoordinates } from "./location-input";
import { TravelChangeSheet } from "./travel-change-sheet";
import { TravelNote } from "./travel-note";
import { TravelLinkFlow } from "./travel-link-flow";
import { CollapsibleNote } from "@/components/ui/collapsible-note";
import { readYahooRouteStops } from "@/lib/yahoo-transit-route";
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
  onEditWithMode,
  onDeleted,
  linkedTasks = [],
  onOpenTask,
  onLinked,
  onCreateTask,
  linkedEventTitle,
  linkedEventRange,
  linkedEventColor = null,
  onOpenLinkedEvent,
  weekStartsOn = 0,
  places = [],
}: {
  travel: TravelItem;
  timeZone: string;
  /** 閲覧のみにする。オフライン中に使う（docs/spec.md §21）。 */
  readOnly?: boolean;
  onClose: () => void;
  onEdit: () => void;
  /** 変更シートから、選んだ移動方法で編集画面を開く（issue #1466）。 */
  onEditWithMode?: (mode: TravelMode, times?: { departAt: string; arriveAt: string }) => void;
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
  /** 紐づく予定の日時。取れないとき（表示範囲外など）は前後を断定しない（issue #1137）。 */
  linkedEventRange?: { start: string; end: string; allDay: boolean } | null;
  /** 紐づく予定のカレンダー色。色帯に使う。取れないときは null。 */
  linkedEventColor?: string | null;
  /** 紐づく予定の表示画面へ移る（issue #1595）。予定が手元に無いとき（表示範囲外）は渡さず、行は押せない。 */
  onOpenLinkedEvent?: () => void;
  weekStartsOn?: number;
  /** 場所DB。座標を持つ地点は座標でGoogleマップを開く。 */
  places?: PlaceItem[];
}) {
  // 既存の予定を後から結ぶ・外す（issue #1105）。
  const [linkingEvent, setLinkingEvent] = useState(false);

  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [linking, setLinking] = useState(false);
  const [changing, setChanging] = useState(false);

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

  const RowEl = onOpenLinkedEvent ? "button" : "div";

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

  if (changing) {
    return (
      <TravelChangeSheet
        travel={travel}
        timeZone={timeZone}
        // ×・閉じるは全体を閉じず、移動の詳細へ戻す（issue #1598）
        onCancel={() => {
          setChanging(false);
          setOpen(true);
        }}
        onSaved={(touched) => onLinked?.(touched)}
        onSearch={(mode, times) => onEditWithMode?.(mode, times)}
      />
    );
  }

  if (linkingEvent) {
    return (
      <TravelLinkFlow
        side={{ kind: "travel", travel }}
        timeZone={timeZone}
        weekStartsOn={weekStartsOn}
        onCancel={onClose}
        onLinked={(touched) => onLinked?.(touched)}
        onUnlinked={() =>
          onLinked?.([
            { start: travel.start, end: travel.end },
            ...(linkedEventRange ? [{ start: linkedEventRange.start, end: linkedEventRange.end }] : []),
          ])
        }
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

  // 経路の詳細は専用項目から。旧データはメモに途中駅つきの経路が入っているため、そのときはメモを経路の詳細として扱う（issue #1634）
  const legacyRouteInNote = !travel.routeDetail && readYahooRouteStops(travel.note ?? "").length > 0;
  const routeDetailText = travel.routeDetail || (legacyRouteInNote ? travel.note : null);
  const noteText = legacyRouteInNote ? null : travel.note;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-y-auto">
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

          {travel.notification?.enabled && (
            <DetailRow icon={<Bell className="size-4" />}>
              通知：出発の{travel.notification.leadMinutes.map(eventLeadLabel).join("・")}
            </DetailRow>
          )}

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
              <span>
                出発地: <PlaceLink text={travel.origin} places={places} readOnly={readOnly} />
              </span>
              <span>
                目的地: <PlaceLink text={travel.destination} places={places} readOnly={readOnly} />
              </span>
            </span>
          </DetailRow>

          {noteText && (
            <CollapsibleNote>
              <TravelNote
                note={noteText}
                startIso={travel.start}
                timeZone={timeZone}
                destination={travel.destination}
                places={places}
                readOnly={readOnly}
              />
            </CollapsibleNote>
          )}

          {/* 経路の詳細（Yahoo!乗換案内の取り込み）はメモと別の欄。旧データはメモに入っているためそちらから読む。
              途中駅が読める経路は「ここから再検索」の導線を保つため既定で開く（issue #1581・#1515・#1634） */}
          {routeDetailText && (
            <CollapsibleNote defaultOpen={readYahooRouteStops(routeDetailText).length > 0}>
              <TravelNote
                note={routeDetailText}
                startIso={travel.start}
                timeZone={timeZone}
                destination={travel.destination}
                places={places}
                readOnly={readOnly}
                travel={travel}
              />
            </CollapsibleNote>
          )}

          {/* 書き出せていない移動はDaySpanの中だけに見える。他の端末で探しても出てこないため伝える。 */}
          {!travel.exported && (
            <DetailRow icon={<CloudOff className="size-4" />}>
              <span className="text-xs text-on-surface-variant">
                Googleカレンダーには書き出されていません。設定 ▸ 移動 で書き出し先を確認してください。
              </span>
            </DetailRow>
          )}

          {/*
            紐づく予定（issue #1105・#1573）。予定の表示画面の「紐づく移動」と同じ色帯の行にし、
            予定名・日時・前後の区分を省略せず2段で見せる。付け替え・外すは操作アコーディオンの
            「予定を付け替える」へ置く（#1597）。
          */}
          {travel.linkedEventId ? (
            <div className="flex items-stretch gap-1">
              <RowEl
                className="flex min-w-0 flex-1 text-left items-center gap-3 border-l-[3px] py-2 pr-2 pl-3"
                style={{ borderLeftColor: tintedEventColors(linkedEventColor).accent }}
                {...(onOpenLinkedEvent ? { type: "button" as const, onClick: onOpenLinkedEvent } : {})}
              >
                <Link2 className="size-4 shrink-0 text-on-surface-variant" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-bold break-words">{linkedEventTitle ?? "予定（表示範囲外）"}</span>
                  <span className="type-body-small text-on-surface-variant">
                    {TRAVEL_RELATION_LABELS[travelRelation(travel, linkedEventRange)]}
                    {linkedEventRange && ` ・ ${formatTravelTime({ ...travel, start: linkedEventRange.start, end: linkedEventRange.end }, timeZone, linkedEventRange.allDay)}`}
                  </span>
                </span>
                {onOpenLinkedEvent && <ChevronRight className="size-4 shrink-0 opacity-70" />}
              </RowEl>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-md border border-dashed border-outline-variant py-2 pr-2 pl-3">
              <Link2 className="size-4 shrink-0 text-on-surface-variant" />
              <span className="min-w-0 flex-1 text-on-surface-variant">予定とは紐づいていません</span>
              <Button variant="outline" size="sm" disabled={readOnly} onClick={startLinkEvent}>
                予定と紐づける
              </Button>
            </div>
          )}

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
                    className="flex items-center gap-3 border-l-[3px] border-secondary-container py-2 pr-2 pl-3 text-left text-sm text-on-surface"
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

          {/* 操作は既定で閉じたアコーディオンの中にカードで置く（予定の表示画面と同じ・issue #1573）。 */}
          <Accordion
            title="移動の操作"
            description={travel.linkedEventId ? "変更・付け替え・タスク" : "変更・紐づけ・タスク"}
            flat
          >
            <ActionCard
              icon={<Route className="size-4" />}
              iconClassName="bg-travel-container text-on-travel-container"
              title="移動方法・時間を変更"
              description="手段や所要時間を直す"
              disabled={readOnly}
              onClick={() => {
                setOpen(false);
                setTimeout(() => setChanging(true), 150);
              }}
            />
            <ActionCard
              icon={<Link2 className="size-4" />}
              iconClassName="bg-surface-container-high text-primary"
              title={travel.linkedEventId ? "予定を付け替える" : "予定と紐づける"}
              description={travel.linkedEventId ? "別の予定と結ぶ・紐づけを外す" : "予定と結ぶ"}
              disabled={readOnly}
              onClick={startLinkEvent}
            />
            <ActionCard
              icon={<TaskStageMark stage="BEFORE_START" className="h-4 w-5" />}
              iconClassName="bg-secondary-container text-on-secondary-container"
              title="タスクを登録"
              description="出発・到着に合わせてやることを置く"
              disabled={readOnly}
              onClick={linkTask}
            />
          </Accordion>

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

/**
 * 出発地・目的地。Googleマップを開くリンクにする（予定の場所と同じ見た目）。
 * オフライン中は地図もアプリも開けないため文字のままにする（docs/spec.md §21）。
 */
function PlaceLink({ text, places, readOnly }: { text: string; places: PlaceItem[]; readOnly: boolean }) {
  const label = placeDisplayName(text);
  const href = readOnly ? null : mapLink(text, placeCoordinates(text, places));
  if (!href) return <>{label}</>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-xs text-primary underline decoration-primary/40 underline-offset-3 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {label}
      <ExternalLink className="ml-1 inline size-3 shrink-0 align-[-1px]" />
    </a>
  );
}

/** 操作のカード。枠付きで、アイコン・太字の名前・説明の3段。押すと別の画面が開く（予定の表示画面と同じ形・issue #1597）。 */
function ActionCard({
  icon,
  iconClassName,
  title,
  description,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  iconClassName: string;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-left transition-colors hover:bg-surface-container-low active:bg-surface-container disabled:opacity-38"
    >
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", iconClassName)}>
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-bold">{title}</span>
        <span className="type-body-small text-on-surface-variant">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
    </button>
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
export function formatTravelTime(travel: TravelItem, timeZone: string, allDay = false): string {
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

  if (allDay) return startDate === endDate ? `${startDate}（終日）` : `${startDate} – ${endDate}`;

  return startDate === endDate
    ? `${startDate} ${time(travel.start)} – ${time(travel.end)}`
    : `${startDate} ${time(travel.start)} – ${endDate} ${time(travel.end)}`;
}
