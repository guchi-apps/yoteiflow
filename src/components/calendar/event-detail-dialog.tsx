"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import {
  ArrowRight,
  Bell,
  CalendarClock,
  ChevronRight,
  CircleDashed,
  Copy,
  ExternalLink,
  MapPin,
  Pencil,
  RotateCw,
  Trash2,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { eventLeadLabel } from "@/lib/event-notification";
import { mapLink } from "@/lib/map-link";
import type { PlaceItem } from "@/services/notion/places";
import { cn } from "@/lib/utils";
import {
  EVENT_OUTCOME_KIND_LABELS,
  TRAVEL_MODE_LABELS,
  type CalendarEventItem,
  type EventOutcomeItem,
  type TaskItem,
  type TravelItem,
} from "@/types/calendar";

import { BringItemsSection } from "./bring-items-section";
import { tintedEventColors } from "./calendar-color";
import { DeleteItemDialog } from "./delete-item-dialog";
import { EventOutcomeDialog } from "./event-outcome-dialog";
import { EventOutcomeMark } from "./event-outcome-mark";
import { placeCoordinates } from "./location-input";
import { readErrorMessage } from "./response-error";
import { taskLinkTargetLabel } from "./task-link-label";
import { TaskStageMark } from "./task-stage-mark";
import { TravelMark } from "./travel-mark";
import type { OptimisticEventChange } from "./optimistic-events";
import type { TouchedRange } from "./use-calendar-chunks";

/** 移動に添える「車 80分」。所要時間は出発・到着から求める（保存しているのは時刻のため）。 */
function travelSummary(travel: TravelItem): string {
  const minutes = Math.max(
    1,
    Math.round((new Date(travel.end).getTime() - new Date(travel.start).getTime()) / 60_000),
  );
  return `${TRAVEL_MODE_LABELS[travel.mode]} ${minutes}分${travel.estimated ? "（目安）" : ""}`;
}

export function EventDetailDialog({
  event,
  timeZone,
  readOnly = false,
  onClose,
  onEdit,
  onDuplicate,
  onAddTravel,
  linkedTravels,
  onOpenTravel,
  onLinkTask,
  onBringChanged,
  linkedTasks,
  onOpenTask,
  places = [],
  onDeleted,
  onOutcomeChanged,
  onConfirmed,
}: {
  event: CalendarEventItem;
  timeZone: string;
  /** 閲覧のみにする。オフライン中に使う（docs/spec.md §21）。 */
  readOnly?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  /** この予定への移動を作る（docs/spec.md §29）。終日予定では出さない。 */
  onAddTravel: () => void;
  /**
   * この予定に紐づいている移動（issue #327）。
   *
   * 移動は時間グリッドでは予定の背面に置くため、時間が丸ごと重なると押せない。
   * 重なりの有無に依らず直せる道として、予定の側からも開けるようにする。
   */
  linkedTravels?: TravelItem[];
  onOpenTravel: (travel: TravelItem) => void;
  /**
   * この予定にタスクを登録する（docs/spec.md §31）。押すとタスク登録ダイアログ
   * （`TaskLinkDialog`）が開き、既存タスクから選ぶか、その場で新しく作れる（issue #835）。
   */
  onLinkTask: () => void;
  /** 持ち物の追加・完了のあと、カレンダーの取り直しを頼む（issue #1080）。 */
  onBringChanged?: () => void;
  /**
   * この予定に紐づいているタスク（issue #835）。
   *
   * 削除の確認では、外れる紐づけを示すためにタイトルだけを取り出して使う。それとは別に、
   * 通常の表示画面でも一覧を出し、予定を見ただけでどのタスクが紐づいているか分かるようにする。
   */
  linkedTasks?: TaskItem[];
  /** 紐づいているタスクの行を押したときに、そのタスクの詳細画面を開く。 */
  onOpenTask: (task: TaskItem) => void;
  /**
   * 登録済みの場所（issue #426）。場所を地図で開くとき、同じ名前で登録されていれば
   * その座標を使う。画面がすでに読んでいるものを渡すため、Notionへの往復は増えない。
   */
  places?: PlaceItem[];
  /** 削除後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onDeleted: (touched: TouchedRange[] | null, change?: OptimisticEventChange) => void;
  /**
   * 中止・不参加の記録が変わったときの処理（docs/spec.md §37）。外したときは null。
   * ダイアログは開いたままにするため、削除（onDeleted）とは別に受ける。
   */
  onOutcomeChanged: (outcome: EventOutcomeItem | null) => void;
  /** 「仮の予定を確定する」が成功したときの処理（issue #688）。ダイアログは閉じない。 */
  onConfirmed: () => void;
}) {
  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  // 削除は取り消せない。押した直後には消さず、確認を挟む。
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // 中止・不参加の記録（docs/spec.md §37）。表示画面を閉じずに重ねて開く。
  const [editingOutcome, setEditingOutcome] = useState(false);
  // 仮の予定の確定（issue #688）。確認は挟まない（編集フォームでいつでも仮へ戻せるため）。
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

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

  const duplicate = () => {
    setOpen(false);
    setTimeout(onDuplicate, 150);
  };

  const addTravel = () => {
    setOpen(false);
    setTimeout(onAddTravel, 150);
  };

  const openTravel = (travel: TravelItem) => {
    setOpen(false);
    setTimeout(() => onOpenTravel(travel), 150);
  };

  const openTask = (task: TaskItem) => {
    setOpen(false);
    setTimeout(() => onOpenTask(task), 150);
  };

  const linkTask = () => {
    setOpen(false);
    setTimeout(onLinkTask, 150);
  };

  const confirmTentative = async () => {
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(event.id)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: event.calendarId }),
      });
      if (!response.ok) {
        setConfirmError(await readErrorMessage(response, "確定できませんでした。"));
        return;
      }
      onConfirmed();
    } catch (cause) {
      setConfirmError(cause instanceof Error ? cause.message : "確定に失敗しました。");
    } finally {
      setConfirmBusy(false);
    }
  };

  /*
   * 移動を足せるのは時刻のある予定だけ。終日予定には「何時までに着けばよいか」が無く、
   * 出発時刻を逆算する起点が決まらない。
   */
  const canAddTravel = !event.allDay;

  /*
   * 場所を押したときの行き先（issue #426）。オフライン中は地図もアプリも開けないため
   * （docs/spec.md §21）、押せる見た目にせず今までどおりの文字に戻す。
   */
  const locationLink = readOnly ? null : mapLink(event.location, placeCoordinates(event.location ?? "", places));

  /** 中止・不参加の記録（docs/spec.md §37）。古い応答には項目自体が無いため null で受ける。 */
  const outcome = event.outcome ?? null;

  const deleted = (touched: TouchedRange[] | null, change?: OptimisticEventChange) => {
    setOpen(false);
    setTimeout(() => onDeleted(touched, change), 150);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {confirmingDelete && (
          <DeleteItemDialog
            item={{ kind: "event", event, linkedTasks: linkedTasks?.map((task) => task.title) }}
            onCancel={() => setConfirmingDelete(false)}
            onDeleted={deleted}
          />
        )}

        {editingOutcome && (
          <EventOutcomeDialog
            event={event}
            onCancel={() => setEditingOutcome(false)}
            onSaved={(next) => {
              setEditingOutcome(false);
              onOutcomeChanged(next);
            }}
          />
        )}

        {/*
          使用していないカレンダーの予定は、編集・削除の入口ごと出さない。押せるまま残すと、
          サーバーが断るまで直せるように見える。複製は残す（別のカレンダーへ写せる）。
        */}
        <div className="absolute top-2 right-10 flex items-center">
          <Button variant="ghost" size="icon-sm" aria-label="複製" disabled={readOnly} onClick={duplicate}>
            <Copy className="size-4" />
          </Button>

          {!event.readOnly && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="削除"
                disabled={readOnly}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="size-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="編集"
                disabled={readOnly}
                onClick={edit}
              >
                <Pencil className="size-4" />
              </Button>
            </>
          )}
        </div>

        <DialogHeader>
          {/* 起こらなかった予定は、名前に打ち消し線を引く。カレンダー上の枠と同じ描き分け。 */}
          <DialogTitle
            className={cn(event.readOnly ? "pr-22" : "pr-38", outcome && "line-through")}
          >
            {event.title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3 text-sm">
          {/*
            仮の予定（issue #688）。まだ本決まりでないという状態を、日時より先に伝える
            （中止・不参加の帯と同じ考え方）。
          */}
          {event.tentative && (
            <div className="flex items-start gap-2.5 rounded-md border border-tertiary/40 bg-tertiary-container px-3 py-2.5 text-on-tertiary-container">
              <CircleDashed className="mt-0.5 size-4" />
              <div className="flex min-w-0 flex-col">
                <span className="font-bold">仮の予定です</span>
                {confirmError && <span className="text-destructive">{confirmError}</span>}
              </div>
            </div>
          )}

          {/*
            記録は日時より先に出す。この予定が起こらなかったことは、いつだったかより先に
            伝わっている必要がある（同じ予定を見返す理由がそこにあるため）。
          */}
          {outcome && (
            <div className="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-error-container px-3 py-2.5 text-on-error-container">
              <EventOutcomeMark className="mt-0.5 size-4" />
              <div className="flex min-w-0 flex-col">
                <span className="font-bold">{EVENT_OUTCOME_KIND_LABELS[outcome.kind]}</span>
                {outcome.note && <LinkifiedText as="span" className="opacity-90" text={outcome.note} />}
              </div>
            </div>
          )}

          <DetailRow icon={<CalendarClock className="size-4" />}>
            {formatEventRange(event, timeZone)}
          </DetailRow>

          <DetailRow
            icon={
              <span
                className="inline-block size-3 rounded-full"
                style={{ backgroundColor: event.color ?? undefined }}
              />
            }
          >
            {event.calendarName}
          </DetailRow>

          {/*
            場所は押すと地図が開く（issue #426）。文字色だけを変えても本文の強調と区別が
            付かないため、下線と外部リンクの印を添える。印を文中に流すのは、
            別の要素にすると場所が長いときに印だけが次の行へ残るため。
          */}
          {event.location && (
            <DetailRow icon={<MapPin className="size-4" />}>
              {locationLink ? (
                <a
                  href={locationLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xs text-primary underline decoration-primary/40 underline-offset-3 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {event.location}
                  <ExternalLink className="ml-1 inline size-3 shrink-0 align-[-1px]" />
                </a>
              ) : (
                event.location
              )}
            </DetailRow>
          )}

          {event.attendees.length > 0 && (
            <DetailRow icon={<Users className="size-4" />}>
              {event.attendees.join(", ")}
            </DetailRow>
          )}

          {event.recurring && (
            <DetailRow icon={<RotateCw className="size-4" />}>繰り返しの予定です</DetailRow>
          )}

          {/*
            予定ごとの通知設定（issue #708）は編集画面でだけ変更できる。ここでは他の任意項目
            （場所・出席者・繰り返し）と同じ「設定されているときだけ行を出す」規則に合わせ、
            状態だけを表示する（issue #834）。終日予定は通知の対象外なので出さない。
          */}
          {!event.allDay && event.notification?.enabled && (
            <DetailRow icon={<Bell className="size-4" />}>
              通知：{event.notification.leadMinutes.map(eventLeadLabel).join("・")}
            </DetailRow>
          )}

          {event.description && (
            <LinkifiedText className="text-on-surface-variant" text={event.description} />
          )}

          {event.readOnly && (
            <p className="text-xs text-on-surface-variant">
              このカレンダーは表示のみに設定されています。予定を変更するには、設定のGoogle
              Calendarで「使用」をオンにしてください。
            </p>
          )}

          {readOnly && <p className="text-xs text-on-surface-variant">{OFFLINE_WRITE_MESSAGE}</p>}

          {/*
            この予定に紐づいている移動（issue #327）。時間グリッドでは予定の背面に置くため、
            予定と時間が丸ごと重なると押せない。ここからなら重なりに関係なく開ける。
          */}
          {linkedTravels && linkedTravels.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {linkedTravels.map((travel) => {
                // 背景は書き出し先カレンダーの色を使う（issue #492）。時間グリッドの
                // TravelBlockと同じ考え方で、塗り・枠線は予定と同じにし、移動だと分かるのは
                // 交通手段の印だけにする（issue #502）。面は淡く、色は左端の帯へ（issue #573）。
                // カレンダー上の移動と同じものを指しているため、ここだけベタ塗りを残さない。
                const colors = tintedEventColors(travel.color);
                return (
                  <button
                    key={travel.id}
                    type="button"
                    onClick={() => openTravel(travel)}
                    className="flex items-center gap-2 rounded-md border py-1.5 pr-2.5 text-left text-xs text-on-surface"
                    style={{
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      borderLeftWidth: "3px",
                      borderLeftColor: colors.accent,
                      paddingLeft: "8px",
                    }}
                  >
                    <TravelMark mode={travel.mode} className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {travel.title}
                      <span className="opacity-75">（{travelSummary(travel)}）</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 opacity-70" />
                  </button>
                );
              })}
            </div>
          )}

          {/*
            この予定に紐づいているタスク（issue #835）。予定を見ただけで、どのタスクが
            紐づいているか分かるようにする。1つのタスクが期限・予定日の両方でこの予定に
            紐づくこともあるため、その予定に対するlinkを行き先ごと並べる（docs/spec.md §31）。
          */}
          {linkedTasks && linkedTasks.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {linkedTasks.map((task) => {
                const links = task.links.filter((link) => link.eventId === event.id);
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

          {/* 予定の持ち物（issue #1080）。期限は向かう移動の出発から自動で決まる。 */}
          <BringItemsSection
            event={event}
            timeZone={timeZone}
            readOnly={readOnly}
            onChanged={() => onBringChanged?.()}
          />

          {/*
            この予定から作れるものへの導線。アイコンだけの操作にすると、矢印が何を指すのか
            押してみるまで分からないため、名前を添えたボタンとして並べる。
          */}
          <div className="flex flex-wrap gap-2">
            {/*
              仮の予定を確定する（issue #688）。確認は挟まない。編集フォームでいつでも
              「仮の予定」を選び直せるため、削除のような戻せない操作ではない。
            */}
            {event.tentative && (
              <Button
                variant="outline"
                size="sm"
                className="bg-tertiary-container text-on-tertiary-container"
                disabled={readOnly || confirmBusy}
                onClick={confirmTentative}
              >
                <CircleDashed className="size-4" />
                仮の予定を確定する
              </Button>
            )}

            {canAddTravel && (
              <Button
                variant="outline"
                size="sm"
                className="bg-travel-container text-on-travel-container"
                disabled={readOnly}
                onClick={addTravel}
              >
                <ArrowRight className="size-4" />
                移動を足す
              </Button>
            )}

            {/*
              タスクを登録する入口（docs/spec.md §31）。終日予定でも出す。移動と違い、
              出発時刻を逆算する起点が要らず、その日のうちにやる、で置き場所が決まるため。
              使用がオフのカレンダーでも出す。紐づけはGoogleへ書き込まないため。
              以前は「タスクを紐づける」「タスクを作成」の2つに分かれていたが、後者の入口が
              あっても紐づけ画面（`TaskLinkDialog`）の中で新しく作れるため、1つに統合した
              （issue #835）。
            */}
            <Button
              variant="outline"
              size="sm"
              className="bg-secondary-container text-on-secondary-container"
              disabled={readOnly}
              onClick={linkTask}
            >
              <TaskStageMark stage="AFTER_END" className="h-4 w-5 text-on-secondary-container" />
              タスクを登録
            </Button>

            {/*
              中止・不参加の記録（docs/spec.md §37）。記録はGoogleへ書き込まないため、
              「使用」がオフのカレンダーの予定にも付けられる（タスクの紐づけと同じ扱い）。
            */}
            <Button
              variant="outline"
              size="sm"
              className="bg-error-container text-on-error-container"
              disabled={readOnly}
              onClick={() => setEditingOutcome(true)}
            >
              <EventOutcomeMark className="size-4" />
              {outcome ? "記録を直す" : "中止・不参加にする"}
            </Button>
          </div>
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

/** 表示用の日時ラベル。終日は日付のみ、時刻ありは日付と時刻を並べる。 */
function formatEventRange(event: CalendarEventItem, timeZone: string): string {
  if (event.allDay) {
    const start = formatDateKey(event.start);
    return event.start === event.end ? start : `${start} 〜 ${formatDateKey(event.end)}`;
  }

  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  return `${formatParts(formatter.formatToParts(new Date(event.start)))} 〜 ${formatParts(formatter.formatToParts(new Date(event.end)))}`;
}

function formatParts(parts: Intl.DateTimeFormatPart[]): string {
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")}月${get("day")}日 ${get("hour")}:${get("minute")}`;
}

function formatDateKey(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`;
}
