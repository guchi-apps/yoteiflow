"use client";

import { useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EMPTY_PLACE_CATALOG, type PlaceCatalog } from "@/services/notion/places";
import { EMPTY_TAG_CATALOG, type TagCatalog } from "@/services/notion/tag-options";
import type { WritableCalendar } from "@/types/calendar";

import { EventForm, type EventDraft } from "./event-form";
import { ReminderForm, type ReminderDraft } from "./reminder-form";
import { TaskForm, type TaskDraft } from "./task-form";
import { TravelForm, type TravelDraft } from "./travel-form";
import type { OptimisticEventChange } from "./optimistic-events";
import type { TouchedRange } from "./use-calendar-chunks";

export type ItemKind = "event" | "task" | "reminder" | "travel";

/**
 * カレンダーの「＋」から新しく作れる種類（docs/spec.md §15）。
 *
 * 押せば予定、長押しすればタスク（issue #1295）。種類の切り替えタブを持たない（issue #729）ため、
 * 開く種類は押し方で決め、入力が開いたあとに選び直させない。日付リマインドは専用一覧
 * （/reminders）、移動は予定の表示画面の「移動を追加」から作る。ほかに、予定の入力で保存先に移動
 * カレンダーを選び直したときの入口（`TravelEntryHint`・issue #895）からも入れる。
 */
export type AddableKind = Extract<ItemKind, "event" | "task">;

/**
 * 開く対象。開く種類のひな型を1つだけ渡す（`initialKind` と同じ種類）。
 * 種類の切り替えは持たない（issue #729）。予定をタスクに作り変えることもできない。
 */
export type ItemDrafts = {
  event?: EventDraft;
  task?: TaskDraft;
  reminder?: ReminderDraft;
  travel?: TravelDraft;
};

/**
 * 見出しに出す種類の名前。名前は仕様・カレンダー・一覧と同じ「日付リマインド」に揃える。
 * ここだけ「リマインド」と短くすると、後で思い出させてくれるもの（＝やることの置き場）と読めてしまう。
 */
const KIND_LABELS: Record<ItemKind, string> = {
  event: "予定",
  task: "タスク",
  reminder: "日付リマインド",
  travel: "移動",
};

/**
 * 予定・タスク・日付リマインドの入力ダイアログ（docs/spec.md §15）。
 *
 * 買い物リストの入力と同じく、画面の下から出るハーフモーダルにする（issue #729）。
 * 種類の切り替えタブは持たず、開いた入口が決めた種類だけを出す。
 * 枠をここが持ち、中身だけを差し替えるのは、Radixのダイアログを開いたまま
 * アンマウントすると<body>のpointer-events:noneが残ることがあるため。
 */
export function ItemDialog({
  initialKind,
  drafts,
  calendars = [],
  tagCatalog = EMPTY_TAG_CATALOG,
  placeCatalog = EMPTY_PLACE_CATALOG,
  timeZone,
  weekStartsOn = 0,
  onClose,
  onSaved,
  travelCalendarId,
  onOpenTravel,
  activityCalendarIds,
}: {
  initialKind: ItemKind;
  drafts: ItemDrafts;
  /** 予定の保存先。予定を扱わない画面（タスク・日付リマインド一覧）では渡さない。 */
  calendars?: WritableCalendar[];
  /** 登録済みのタグ・種類。設定画面で登録したものを入力の候補として渡す。 */
  tagCatalog?: TagCatalog;
  /** 登録済みの場所。予定の場所欄の入力候補として渡す。 */
  placeCatalog?: PlaceCatalog;
  timeZone: string;
  /** 繰り返す曜日を並べる順に使う。予定を扱わない画面では渡さない。 */
  weekStartsOn?: number;
  onClose: () => void;
  /** 保存後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  /** 第2引数は予定を保存したときの楽観的な反映（issue #787）。 */
  onSaved: (touched: TouchedRange[] | null, change?: OptimisticEventChange) => void;
  /** 移動の書き出し先カレンダー。予定の入力に移動への入口を出すのに使う（issue #895）。 */
  travelCalendarId?: string | null;
  onOpenTravel?: (range: { start: string; end: string }) => void;
  /** 活動記録の保存先カレンダー。予定の入力で終了の追従を止めるのに使う（issue #1309）。 */
  activityCalendarIds?: ReadonlySet<string>;
}) {
  const kind = initialKind;
  const [title, setTitle] = useState(() => draftTitle(initialKind, drafts));

  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const finish = (touched: TouchedRange[] | null, change?: OptimisticEventChange) => {
    setOpen(false);
    setTimeout(() => onSaved(touched, change), 150);
  };

  const editing = isEditing(kind, drafts);
  const label = KIND_LABELS[kind];

  const shared = {
    title,
    autoFocusTitle: true,
    onTitleChange: setTitle,
    onSaved: finish,
    timeZone,
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `${label}を編集` : `${label}を追加`}</DialogTitle>
        </DialogHeader>

        {kind === "event" && drafts.event && (
          <EventForm
            {...shared}
            draft={drafts.event}
            calendars={calendars}
            placeCatalog={placeCatalog}
            weekStartsOn={weekStartsOn}
            travelCalendarId={travelCalendarId}
            onOpenTravel={onOpenTravel}
            activityCalendarIds={activityCalendarIds}
          />
        )}
        {kind === "task" && drafts.task && (
          <TaskForm
            {...shared}
            draft={drafts.task}
            tagOptions={tagCatalog.task ?? []}
            progressOptions={tagCatalog.progress ?? null}
            weekStartsOn={weekStartsOn}
          />
        )}
        {kind === "reminder" && drafts.reminder && (
          <ReminderForm
            {...shared}
            draft={drafts.reminder}
            categories={tagCatalog.reminder ?? []}
          />
        )}
        {/* 移動はタイトルを持たない（出発地と目的地から決まる）。共通の項目のうち
            タイトルに関わるものは渡さない。 */}
        {kind === "travel" && drafts.travel && (
          <TravelForm
            draft={drafts.travel}
            placeCatalog={placeCatalog}
            timeZone={timeZone}
            onSaved={finish}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 開いた時点のタイトル。編集は既存の値、簡易入力からの引き継ぎは入力途中の値。 */
function draftTitle(kind: ItemKind, drafts: ItemDrafts): string {
  if (kind === "event") return drafts.event?.event?.title ?? drafts.event?.title ?? "";
  if (kind === "task") return drafts.task?.task?.title ?? "";
  // 移動のタイトルは出発地と目的地から決まるため、切り替えで引き継ぐ文字列を持たない。
  if (kind === "travel") return "";
  return drafts.reminder?.reminder?.title ?? "";
}

function isEditing(kind: ItemKind, drafts: ItemDrafts): boolean {
  if (kind === "event") return Boolean(drafts.event?.event);
  if (kind === "task") return Boolean(drafts.task?.task);
  if (kind === "travel") return Boolean(drafts.travel?.travel);
  return Boolean(drafts.reminder?.reminder);
}
