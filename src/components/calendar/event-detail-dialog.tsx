"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  Copy,
  ExternalLink,
  MapPin,
  Pencil,
  RotateCw,
  Trash2,
  Unlink,
  Users,
} from "lucide-react";

import { Accordion } from "@/components/ui/accordion";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { CollapsibleNote } from "@/components/ui/collapsible-note";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { eventLeadLabel } from "@/lib/event-notification";
import { locationIssue } from "@/lib/location-check";
import { mapLink } from "@/lib/map-link";
import type { PlaceItem } from "@/services/notion/places";
import { cn } from "@/lib/utils";
import {
  EVENT_OUTCOME_KINDS,
  EVENT_OUTCOME_KIND_DESCRIPTIONS,
  EVENT_OUTCOME_KIND_LABELS,
  type EventOutcomeKind,
  type ActivityLinkItem,
  TRAVEL_MODE_LABELS,
  type CalendarEventItem,
  type EventOutcomeItem,
  type TaskItem,
  type TravelItem,
} from "@/types/calendar";

import { ActivityLinkSection } from "./activity-link-section";
import { BringItemsSection } from "./bring-items-section";
import { tintedEventColors } from "./calendar-color";
import { DeleteItemDialog } from "./delete-item-dialog";
import { EventOutcomeMark } from "./event-outcome-mark";
import { placeCoordinates } from "./location-input";
import { readErrorMessage } from "./response-error";
import { taskLinkTargetLabel } from "./task-link-label";
import { TaskStageMark } from "./task-stage-mark";
import { TravelLinkFlow, unlinkTravel } from "./travel-link-flow";
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
  isActivity = false,
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
  weekStartsOn = 0,
  onTravelLinkChanged,
  onActivityLinksChanged,
  onOpenEventById,
  renderEdit,
  onEditSaved,
}: {
  event: CalendarEventItem;
  timeZone: string;
  /** 閲覧のみにする。オフライン中に使う（docs/spec.md §21）。 */
  readOnly?: boolean;
  onClose: () => void;
  /** 編集フォームを出せないとき（renderEdit が無いとき）の従来の編集入口。 */
  onEdit: () => void;
  /**
   * 編集フォームを同じハーフモーダルの中に出す（issue #1553）。渡すと鉛筆は閉じ直さず、
   * 中身だけを編集フォームへ入れ替える。
   */
  renderEdit?: (props: {
    title: string;
    onTitleChange: (value: string) => void;
    onSaved: (touched: TouchedRange[] | null, change?: OptimisticEventChange) => void;
  }) => ReactNode;
  /**
   * 編集の保存後の処理。詳細へ戻してよいとき true、閉じるべきとき false を返す
   * （移動追随の確認を開いた・予定のIDが変わったときは閉じる）。
   */
  onEditSaved?: (touched: TouchedRange[] | null, change: OptimisticEventChange) => boolean;
  onDuplicate: () => void;
  /** この予定への移動を作る（docs/spec.md §29）。終日予定では出さない。 */
  onAddTravel: () => void;
  /** 活動記録（保存先カレンダーの予定）。実績のため予定向けの導線を出さない（issue #1173）。 */
  isActivity?: boolean;
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
  /**
   * 仮の予定を確定した・仮の予定へ戻したときの処理（issue #688・#1567）。ダイアログは閉じない。
   * `tentative` は切り替えたあとの状態。
   */
  onConfirmed: (tentative: boolean) => void;
  weekStartsOn?: number;
  /** 既存の移動を後から結んだ・外したあと（issue #1105）。変わった期間を渡して取り直す。 */
  onTravelLinkChanged?: (touched: TouchedRange[] | null) => void;
  /** 活動記録と予定の紐づけが変わったとき（issue #1514）。開いている予定へ反映して取り直す。 */
  onActivityLinksChanged?: (links: ActivityLinkItem[]) => void;
  /** 紐づけの相手の予定を開く。手元に無ければ false（押せない表示にする）。 */
  onOpenEventById?: (eventId: string) => boolean;
}) {
  // 既存の移動を後から結ぶ（issue #1105）。選ぶ画面を出す間は表示画面を閉じる。
  const [linkingTravel, setLinkingTravel] = useState(false);
  const displayedLinkedTasks = (linkedTasks ?? []).filter((task) => !task.bring);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  // 削除は取り消せない。押した直後には消さず、確認を挟む。
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // 状態カード（issue #1567）。中止・不参加は選んだときだけメモと「記録する」を出す。
  // 記録済みならその種類・メモから始める（docs/spec.md §37）。
  const [pickKind, setPickKind] = useState<EventOutcomeKind | null>(event.outcome?.kind ?? null);
  const [outcomeNote, setOutcomeNote] = useState(event.outcome?.note ?? "");
  const [outcomeBusy, setOutcomeBusy] = useState(false);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  // 帯の「記録を直す」から予定の操作を開いたまま保つ。
  const [forceOps, setForceOps] = useState(false);
  // 仮の予定の確定・仮へ戻す（issue #688・#1567）。確認は挟まない（状態カードでいつでも切り替えられるため）。
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) close();
  };

  // 編集は閉じずに同じモーダルの中身を入れ替える（issue #1553）。
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState(event.title);

  const edit = () => {
    if (renderEdit) {
      setEditTitle(event.title);
      setEditMode(true);
      return;
    }
    setOpen(false);
    setTimeout(onEdit, 150);
  };

  const editSaved = (touched: TouchedRange[] | null, change?: OptimisticEventChange) => {
    if (change?.type === "upsert" && onEditSaved) {
      if (onEditSaved(touched, change)) {
        setEditMode(false);
        return;
      }
      setOpen(false);
      setTimeout(onClose, 150);
      return;
    }
    // 削除や、反映する予定が決まらない保存（繰り返しの新規など）は従来どおり閉じる。
    setOpen(false);
    setTimeout(() => onDeleted(touched, change), 150);
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

  const startLinkTravel = () => {
    setOpen(false);
    setTimeout(() => setLinkingTravel(true), 150);
  };

  const unlink = async (travel: TravelItem) => {
    setUnlinkError(null);
    const message = await unlinkTravel(travel.id);
    if (message) {
      setUnlinkError(message);
      return;
    }
    setOpen(false);
    setTimeout(
      () => onTravelLinkChanged?.([{ start: travel.start, end: travel.end }, { start: event.start, end: event.end }]),
      150,
    );
  };

  const linkTask = () => {
    setOpen(false);
    setTimeout(onLinkTask, 150);
  };

  // 帯の「確定する」と状態カードの「仮予定」が共有する。切り替えたあとの状態を返す。
  const setTentative = async (next: boolean) => {
    if (confirmBusy) return;
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(event.id)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: event.calendarId, tentative: next }),
      });
      if (!response.ok) {
        setConfirmError(
          await readErrorMessage(response, next ? "仮予定にできませんでした。" : "確定できませんでした。"),
        );
        return;
      }
      onConfirmed(next);
    } catch (cause) {
      setConfirmError(
        cause instanceof Error ? cause.message : next ? "仮予定への切り替えに失敗しました。" : "確定に失敗しました。",
      );
    } finally {
      setConfirmBusy(false);
    }
  };

  const outcomeUrl = `/api/events/${encodeURIComponent(event.id)}/outcome`;

  const saveOutcome = async () => {
    if (!pickKind || outcomeBusy) return;
    setOutcomeBusy(true);
    setOutcomeError(null);
    try {
      const note = outcomeNote.trim() || null;
      const response = await fetch(outcomeUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: event.calendarId, kind: pickKind, note }),
      });
      if (!response.ok) {
        setOutcomeError(await readErrorMessage(response, "記録できませんでした。"));
        return;
      }
      onOutcomeChanged({ kind: pickKind, note });
    } catch (cause) {
      setOutcomeError(cause instanceof Error ? cause.message : "記録に失敗しました。");
    } finally {
      setOutcomeBusy(false);
    }
  };

  const clearOutcome = async () => {
    if (outcomeBusy) return;
    setOutcomeBusy(true);
    setOutcomeError(null);
    try {
      const response = await fetch(outcomeUrl, { method: "DELETE" });
      if (!response.ok) {
        setOutcomeError(await readErrorMessage(response, "記録を外せませんでした。"));
        return;
      }
      setPickKind(null);
      setOutcomeNote("");
      onOutcomeChanged(null);
    } catch (cause) {
      setOutcomeError(cause instanceof Error ? cause.message : "記録を外せませんでした。");
    } finally {
      setOutcomeBusy(false);
    }
  };

  /*
   * 移動を足せるのは時刻のある予定だけ。終日予定には「何時までに着けばよいか」が無く、
   * 出発時刻を逆算する起点が決まらない。
   */
  const canAddTravel = !event.allDay && !isActivity;

  /*
   * 場所を押したときの行き先（issue #426）。オフライン中は地図もアプリも開けないため
   * （docs/spec.md §21）、押せる見た目にせず今までどおりの文字に戻す。
   */
  const locationLink = readOnly ? null : mapLink(event.location, placeCoordinates(event.location ?? "", places));

  /*
   * 場所が空・住所が無い予定の注意（issue #1319）。他のアプリ（Morrow など）は場所欄の文字列から
   * 地点を引くため、名前だけでは地点が決まらない。勤務予定は勤務の入力から直す。
   */
  const placeIssue = locationIssue(event, places, { isActivity });
  const placeFixHint = event.workGenerated
    ? "勤務の入力から勤務場所の住所を登録できます"
    : "編集で場所の候補から選ぶと住所が入ります";

  /** 中止・不参加の記録（docs/spec.md §37）。古い応答には項目自体が無いため null で受ける。 */
  const outcome = event.outcome ?? null;

  const deleted = (touched: TouchedRange[] | null, change?: OptimisticEventChange) => {
    setOpen(false);
    setTimeout(() => onDeleted(touched, change), 150);
  };

  if (linkingTravel) {
    return (
      <TravelLinkFlow
        side={{ kind: "event", event }}
        onCreateNew={addTravel}
        timeZone={timeZone}
        weekStartsOn={weekStartsOn}
        onCancel={onClose}
        onLinked={(touched) => onTravelLinkChanged?.(touched)}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-y-auto">
        {editMode && renderEdit && (
          <>
            <DialogHeader className="flex-row items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="詳細へ戻る" onClick={() => setEditMode(false)}>
                <ArrowLeft className="size-4" />
              </Button>
              <DialogTitle>予定を編集</DialogTitle>
            </DialogHeader>
            {renderEdit({ title: editTitle, onTitleChange: setEditTitle, onSaved: editSaved })}
          </>
        )}
        {!editMode && (
          <>
        {confirmingDelete && (
          <DeleteItemDialog
            item={{ kind: "event", event, linkedTasks: linkedTasks?.map((task) => task.title) }}
            onCancel={() => setConfirmingDelete(false)}
            onDeleted={deleted}
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
              {/* 主操作のためアコーディオンに入れない。確認は挟まない（状態カードでいつでも仮へ戻せる）。 */}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto shrink-0 bg-surface-container-lowest"
                disabled={readOnly || confirmBusy}
                onClick={() => void setTentative(false)}
              >
                確定する
              </Button>
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
              {/* 記録の修正は奥へ入れず、帯の中から1タップで開く。 */}
              {!isActivity && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto shrink-0 bg-surface-container-lowest"
                  disabled={readOnly}
                  onClick={() => setForceOps(true)}
                >
                  記録を直す
                </Button>
              )}
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
              {placeIssue === "no_address" && (
                <span className="type-body-small mt-0.5 flex items-start gap-1 text-tertiary">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span>住所が登録されていません。{placeFixHint}</span>
                </span>
              )}
            </DetailRow>
          )}

          {/* 場所の無い予定（issue #1319）。色だけに頼らず、印と文で示す。 */}
          {placeIssue === "missing" && (
            <div className="flex items-start gap-2 text-tertiary">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="flex min-w-0 flex-col">
                <span>場所が登録されていません</span>
                <span className="type-body-small text-on-surface-variant">{placeFixHint}</span>
              </span>
            </div>
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
            状態だけを表示する（issue #834）。終日予定も通知できる（issue #1568）。
          */}
          {event.notification?.enabled && (
            <DetailRow icon={<Bell className="size-4" />}>
              通知：{event.notification.leadMinutes.map(eventLeadLabel).join("・")}
            </DetailRow>
          )}

          {event.description && (
            <CollapsibleNote>
              <LinkifiedText className="text-on-surface-variant" text={event.description} />
            </CollapsibleNote>
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
                  <div key={travel.id} className="flex items-stretch gap-1">
                  <button
                    type="button"
                    onClick={() => openTravel(travel)}
                    className="flex min-w-0 flex-1 items-center gap-3 border-l-[3px] py-2 pr-2 pl-3 text-left text-sm text-on-surface"
                    style={{ borderLeftColor: colors.accent }}
                  >
                    <TravelMark mode={travel.mode} className="size-5 shrink-0 text-on-surface-variant" />
                    <span className="min-w-0 flex-1 truncate">
                      {travel.title}
                      <span className="opacity-75">（{travelSummary(travel)}）</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 opacity-70" />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${travel.title}の紐づけを外す`}
                    disabled={readOnly}
                    onClick={() => unlink(travel)}
                  >
                    <Unlink className="size-4" />
                  </Button>
                  </div>
                );
              })}
              {unlinkError && <p className="text-xs text-destructive">{unlinkError}</p>}
            </div>
          )}

          {/*
            この予定に紐づいているタスク（issue #835）。予定を見ただけで、どのタスクが
            紐づいているか分かるようにする。1つのタスクが期限・予定日の両方でこの予定に
            紐づくこともあるため、その予定に対するlinkを行き先ごと並べる（docs/spec.md §31）。
            持ち物（bring）は下の「持ち物」に出るため、ここには重ねて出さない（issue #1722）。
          */}
          {displayedLinkedTasks.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {displayedLinkedTasks.map((task) => {
                const links = task.links.filter((link) => link.eventId === event.id);
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

          {/* 活動記録と予定の紐づけ（issue #1514）。 */}
          <ActivityLinkSection
            event={event}
            timeZone={timeZone}
            weekStartsOn={weekStartsOn}
            isActivity={isActivity}
            readOnly={readOnly}
            onChanged={(links) => onActivityLinksChanged?.(links)}
            onOpenEvent={(id) => onOpenEventById?.(id) ?? false}
          />

          {/* 予定の持ち物（issue #1080）。期限は向かう移動の出発から自動で決まる。 */}
          {!isActivity && (
            <BringItemsSection
              event={event}
              timeZone={timeZone}
              readOnly={readOnly}
              onChanged={() => onBringChanged?.()}
              onOpenTask={openTask}
            />
          )}

          {/*
            この予定から作れるものへの導線。バッジ状のボタンを並べず、既定で閉じたアコーディオンの
            中に「アイコン＋名前＋説明」のカードとして置く（issue #1544）。確定・記録を直すは
            主操作・修正の入口として、それぞれの帯の中に出している。
          */}
          {(canAddTravel || !isActivity) && (
            <Accordion
              title="予定の操作"
              description={canAddTravel ? "移動・タスク・状態" : "タスク・状態"}
              flat
              forceOpen={forceOps}
            >
              {/*
                移動の入口は1つ（issue #1567）。押すと、先頭に「新しい移動を作る」・その下に既存の
                移動の一覧が並ぶ画面が開く（タスク登録と同じ形）。
              */}
              {canAddTravel && (
                <ActionCard
                  icon={<ArrowRight className="size-4" />}
                  iconClassName="bg-travel-container text-on-travel-container"
                  title="移動を登録"
                  description="既存の移動を結ぶ・新しく作る"
                  disabled={readOnly}
                  onClick={startLinkTravel}
                />
              )}

              {/*
                タスクを登録する入口（docs/spec.md §31）。終日予定でも出す。使用がオフの
                カレンダーでも出す（紐づけはGoogleへ書き込まないため）。
              */}
              {!isActivity && (
                <ActionCard
                  icon={<TaskStageMark stage="AFTER_END" className="h-4 w-5" />}
                  iconClassName="bg-secondary-container text-on-secondary-container"
                  title="タスクを登録"
                  description="この予定に合わせてやることを置く"
                  disabled={readOnly}
                  onClick={linkTask}
                />
              )}

              {/*
                予定の状態（issue #1567）。仮予定・中止・不参加の3枚を横に並べる。仮予定は押すと
                その場で切り替わる（もう一度押すと確定）。中止・不参加は、仮予定と両立しうる
                （docs/spec.md §37）ため仮予定とは別に選び、押したときだけメモと「記録する」を出す。
                記録はGoogleへ書き込まないため「使用」がオフのカレンダーの予定にも付けられる。
              */}
              {!isActivity && (
                <div className="flex flex-col gap-2">
                  <span className="type-label-medium text-on-surface-variant">この予定の状態</span>
                  <div className="grid grid-cols-3 gap-2">
                    <StatusCard
                      selected={Boolean(event.tentative)}
                      disabled={readOnly || confirmBusy}
                      icon={<CircleDashed className="size-4" />}
                      label="仮予定"
                      onClick={() => void setTentative(!event.tentative)}
                    />
                    {EVENT_OUTCOME_KINDS.map((kind) => (
                      <StatusCard
                        key={kind}
                        selected={pickKind === kind}
                        disabled={readOnly || outcomeBusy}
                        icon={<EventOutcomeMark className="size-4" />}
                        label={EVENT_OUTCOME_KIND_LABELS[kind]}
                        onClick={() => setPickKind(pickKind === kind ? null : kind)}
                      />
                    ))}
                  </div>
                  {confirmError && <p className="text-xs text-destructive">{confirmError}</p>}

                  {pickKind && (
                    <>
                      <p className="type-body-small text-on-surface-variant">
                        {EVENT_OUTCOME_KIND_DESCRIPTIONS[pickKind]}。予定はカレンダーに残り、Google Calendar側は書き換えません。
                      </p>
                      <Textarea
                        id="event-outcome-note"
                        label="メモ（任意）"
                        rows={2}
                        value={outcomeNote}
                        disabled={readOnly || outcomeBusy}
                        onChange={(e) => setOutcomeNote(e.target.value)}
                        onClear={() => setOutcomeNote("")}
                      />
                      {outcomeError && <p className="text-xs text-destructive">{outcomeError}</p>}
                      <Button
                        className="w-full"
                        disabled={readOnly || outcomeBusy}
                        onClick={() => void saveOutcome()}
                      >
                        記録する
                      </Button>
                      {outcome && (
                        <Button
                          variant="destructive"
                          className="w-full"
                          disabled={readOnly || outcomeBusy}
                          onClick={() => void clearOutcome()}
                        >
                          記録を外す
                        </Button>
                      )}
                    </>
                  )}
                  {!pickKind && outcomeError && <p className="text-xs text-destructive">{outcomeError}</p>}
                </div>
              )}
            </Accordion>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            閉じる
          </Button>
        </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 操作のカード。枠付きで、アイコン・太字の名前・説明の3段。押すと別の画面が開く（issue #1567）。 */
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

/** 状態を選ぶカード。選んだものだけ primary-container で塗り、ほかは白（issue #1567）。 */
function StatusCard({
  selected,
  disabled,
  icon,
  label,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-sm font-bold transition-colors disabled:opacity-38",
        selected
          ? "border-primary bg-primary-container text-on-primary-container"
          : "border-outline-variant bg-surface-container-lowest hover:bg-primary/8",
      )}
    >
      {icon}
      {label}
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
