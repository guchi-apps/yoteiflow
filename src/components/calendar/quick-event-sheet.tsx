"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { classifyQuickTaskFailure, newQuickTaskClientId } from "@/lib/quick-task-create";
import { cn } from "@/lib/utils";
import type { WritableCalendar } from "@/types/calendar";

import { CalendarChipSelect } from "./calendar-chip-select";
import { localInputToIso } from "./datetime-fields";
import type { EventDraft } from "./event-form";
import { ItemFormActions } from "./item-form-actions";
import { MINUTES_PER_DAY } from "./item-layout";
import { buildOptimisticEvent, type OptimisticEventChange } from "./optimistic-events";
import type { TaskDraft } from "./task-form";
import { TravelEntryHint } from "./travel-entry-hint";
import { taskRanges, type TouchedRange } from "./use-calendar-chunks";

export type QuickEventDraft = {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  startTime: string;
  /** HH:mm */
  endTime: string;
  /**
   * 時刻まで押した位置で決まっているか。日付だけが決まっている追加（月表示の長押し・
   * 下部ナビの長押し）では false で、タスクへ切り替えたときは時刻を空（日付だけ）から始める
   * （issue #1313。予定の開始時刻 9:00 を期限に入れても意味が無いため）。
   */
  hasTime?: boolean;
};

/** 簡易入力で作る種類（issue #1313）。 */
type QuickKind = "event" | "task";

/** タスクの日時を入れる先。期限か予定日のどちらか1つだけを入れる。 */
type QuickTaskTarget = "due" | "planned";

const QUICK_KIND_LABELS: Record<QuickKind, string> = { event: "予定", task: "タスク" };
const TASK_TARGET_LABELS: Record<QuickTaskTarget, string> = { due: "期限", planned: "予定日" };

/** 日付だけが決まっている追加（右下の「＋」・月表示の長押し・下部ナビの長押し）で使う開始時刻。 */
export const DEFAULT_START_MINUTES = 9 * 60;

/**
 * 押した位置から作る初期値。既定の長さは1時間とし、日をまたがないところで止める。
 * 日をまたぐ予定はこの画面では作れないため、23:00より後を押した場合はその日の終わりまでになる。
 *
 * 範囲を引いて選んだ場合は、その終了時刻を endMinutes で渡す（issue #119）。
 * 24:00ちょうどまで引いた場合もその日の終わりへ丸める。時刻の入力欄は24:00を扱えないため。
 */
export function toQuickEventDraft(
  dateKey: string,
  startMinutes: number,
  endMinutes?: number,
  hasTime = true,
): QuickEventDraft {
  return {
    hasTime,
    date: dateKey,
    startTime: formatMinutes(startMinutes),
    endTime: formatMinutes(Math.min(endMinutes ?? startMinutes + 60, MINUTES_PER_DAY - 1)),
  };
}

/**
 * カレンダーの空いているところを押したときに出る簡易入力。
 *
 * 日付と時刻は押した位置ですでに決まっているため、全項目の入力欄を出すと
 * 直す欄より埋まっている欄のほうが多くなる。ここではタイトル・時間・カレンダーだけを受け取り、
 * 場所や説明を入れたい場合は「詳細」から通常の入力画面へ引き継ぐ。
 *
 * 画面の下側に寄せるのは、指の届く範囲へ入力欄と保存ボタンを置くため。
 *
 * `taskAvailable` を渡すと見出しが「予定｜タスク」の切り替えになり、同じ日時でタスクも作れる
 * （issue #1313。#729 で入力画面の切り替えは廃止したが、簡易入力は日時を押した位置で共有でき、
 * 種類だけ選べば足りるため例外にした）。
 */
export function QuickEventSheet({
  draft,
  calendars,
  timeZone,
  onClose,
  onSaved,
  onOpenDetail,
  travelCalendarId,
  onOpenTravel,
  activityCalendarIds,
  taskAvailable = false,
  onOpenTaskDetail,
}: {
  draft: QuickEventDraft;
  calendars: WritableCalendar[];
  timeZone: string;
  onClose: () => void;
  /** 保存後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  /** 第2引数は、取り直しを待たずに画面へ重ねる保存後の予定（issue #787）。 */
  onSaved: (touched: TouchedRange[] | null, change?: OptimisticEventChange) => void;
  /** 入力済みの値を持ったまま、通常の入力画面へ移る。 */
  onOpenDetail: (draft: EventDraft) => void;
  /** 移動の書き出し先カレンダー。設定が無ければ移動への入口は出さない（issue #895）。 */
  travelCalendarId?: string | null;
  /** 入力中の日時を持ったまま、予定に紐づかない移動の入力へ移る。 */
  onOpenTravel?: (range: { start: string; end: string }) => void;
  /** 活動記録の保存先カレンダー。ここへ保存する予定は開始を直しても終了を動かさない（issue #1309）。 */
  activityCalendarIds?: ReadonlySet<string>;
  /** タスクも作れるか（タスクDBが設定済みでオンライン）。false なら切り替えを出さない。 */
  taskAvailable?: boolean;
  /** タスクの入力中の値を持ったまま、通常のタスクの入力画面へ移る。 */
  onOpenTaskDetail?: (draft: TaskDraft) => void;
}) {
  const [kind, setKind] = useState<QuickKind>("event");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(draft.date);
  const [startTime, setStartTime] = useState(draft.startTime);
  const [endTime, setEndTime] = useState(draft.endTime);
  const [taskTarget, setTaskTarget] = useState<QuickTaskTarget>("due");
  // タスクの時刻は予定の開始と別に持つ。予定で開始を直したあとに切り替えても、押した位置の
  // 時刻（月表示から開いたときは空）のまま始める。空なら日付だけのタスクになる。
  const [taskTime, setTaskTime] = useState(draft.hasTime === false ? "" : draft.startTime);
  const [calendarId, setCalendarId] = useState(
    calendars.find((calendar) => calendar.isCreateDefault)?.calendarId ??
      calendars[0]?.calendarId ??
      "",
  );
  // 保存先に移動カレンダーを利用者が選び直したか（issue #895）。既定の保存先が移動
  // カレンダーでも、選んでいない間は入口を出さない。
  const [pickedTravel, setPickedTravel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // タスクの作成ID（issue #1316）。シートを開いた時点で1つ決め、保存の再試行でも同じ値を送る。
  // 作成が済んだあとに応答だけ失われても、押し直しで2件目を作らない（`POST /api/tasks` の冪等処理）。
  const [taskClientId, setTaskClientId] = useState(newQuickTaskClientId);
  // 前回の保存が届いたか分からず、同じIDでは作れない状態。利用者が確かめて作り直すときだけIDを変える。
  const [taskNeedsConfirmation, setTaskNeedsConfirmation] = useState(false);

  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);

  // 開いた直後のフォーカス先を自分で決めるために、シート自体を掴んでおく。
  const contentRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) close();
  };

  // 開始を動かしたら、それまでの長さを保ったまま終了も動かす。
  // 押した位置から作った1時間を、開始だけ直すたびに作り直さずに済む。
  // 活動記録は長さが決まっていないため動かさない（issue #1309）。
  const changeStartTime = (value: string) => {
    const previous = toMinutes(startTime);
    const next = toMinutes(value);
    const finish = toMinutes(endTime);

    if (
      previous !== null &&
      next !== null &&
      finish !== null &&
      finish > previous &&
      !activityCalendarIds?.has(calendarId)
    ) {
      setEndTime(formatMinutes(Math.min(next + (finish - previous), MINUTES_PER_DAY - 1)));
    }

    setStartTime(value);
  };

  // 同じ書式でゼロ埋めされているため、文字列のまま比較して前後関係が判定できる。
  const rangeError = (() => {
    if (!date || !startTime || !endTime) return "日付と時刻を入力してください。";
    return endTime <= startTime ? "終了時刻が開始時刻より後になるようにしてください。" : null;
  })();

  const isTask = taskAvailable && kind === "task";

  const taskDate = (): string => (taskTime ? localInputToIso(`${date}T${taskTime}`, timeZone) : date);

  const saveTask = async () => {
    setBusy(true);
    setError(null);
    try {
      const value = taskDate();
      const payload = {
        title,
        [taskTarget]: value,
        done: false,
        tags: [],
        clientId: taskClientId,
      };

      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as Parameters<typeof classifyQuickTaskFailure>[1];
        const failure = classifyQuickTaskFailure(response.status, body, "保存できませんでした。");
        setError(failure.message);
        setTaskNeedsConfirmation(failure.needsConfirmation);
        return;
      }

      const touched = taskRanges({
        due: taskTarget === "due" ? value : null,
        planned: taskTarget === "planned" ? value : null,
      });
      setOpen(false);
      setTimeout(() => onSaved(touched), 150);
    } catch (cause) {
      // 作成が届いたかは分からないが、作成IDは変えないため、もう一度保存しても二重には作らない。
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  // 前回の保存の結果が分からないとき、タスク一覧で確かめたうえで別のタスクとして作り直す。
  const recreateTask = () => {
    setTaskClientId(newQuickTaskClientId());
    setTaskNeedsConfirmation(false);
    setError(null);
  };

  const save = async () => {
    if (isTask) return saveTask();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        calendarId,
        title,
        allDay: false,
        start: localInputToIso(`${date}T${startTime}`, timeZone),
        end: localInputToIso(`${date}T${endTime}`, timeZone),
      };

      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        setError(await readErrorMessage(response, "保存できませんでした。"));
        return;
      }

      const created = (await response.json().catch(() => null)) as { id?: string } | null;
      const touched: TouchedRange[] = [{ start: payload.start, end: payload.end }];
      const change: OptimisticEventChange | undefined = created?.id
        ? {
            type: "upsert",
            item: buildOptimisticEvent(payload, created.id, calendars),
            ranges: touched,
          }
        : undefined;

      setOpen(false);
      setTimeout(() => onSaved(touched, change), 150);
    } catch (cause) {
      // 日時の変換など、リクエスト送信前に失敗することもある。黙って閉じないよう画面に出す。
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const openDetail = () => {
    if (isTask && onOpenTaskDetail) {
      const mode = taskTime ? "datetime" : "date";
      const value = taskTime ? join(date, taskTime) : date;
      const taskDraft: TaskDraft = {
        title,
        dueMode: taskTarget === "due" ? mode : "none",
        due: taskTarget === "due" ? value : "",
        ...(taskTarget === "planned" ? { plannedMode: mode, planned: value } : {}),
      };
      setOpen(false);
      setTimeout(() => onOpenTaskDetail(taskDraft), 150);
      return;
    }
    setOpen(false);
    setTimeout(
      () =>
        onOpenDetail({
          allDay: false,
          start: join(date, startTime),
          end: join(date, endTime),
          title,
          calendarId,
          fromQuick: true,
          pickedTravel: pickedTravel && calendarId === travelCalendarId,
        }),
      150,
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* 右上の ✕ を出す。下端のボタンは保存と詳細だけで「やめる」を持たないため、
          押せる出口がここに要る（docs/spec.md §15）。 */}
      <DialogContent
        ref={contentRef}
        position="bottom"
        className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto"
        // 開いた時点で入力欄へフォーカスを移さない。スマートフォンではその場でキーボードが
        // 立ち上がり、シートの下半分を覆ってしまう。時刻もカレンダーも押した位置から
        // 埋まっているため、開いてすぐ文字を打ちたいとは限らない。
        // Radixは既定で最初の入力欄へ移すため、シート自体へ移して打ち消す
        // （フォーカスはシートの中に留まり、Escで閉じられる状態は保たれる）。
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <DialogHeader>
          {taskAvailable ? (
            <>
              {/* 見出しの代わりに種類の切り替えを置く。読み上げには選んでいる種類の見出しを残す。 */}
              <DialogTitle className="sr-only">{`${QUICK_KIND_LABELS[kind]}を追加`}</DialogTitle>
              <div
                role="radiogroup"
                aria-label="追加する種類"
                className="grid w-48 grid-cols-2 overflow-hidden rounded-full border border-outline"
              >
                {(["event", "task"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={kind === option}
                    onClick={() => setKind(option)}
                    className={cn(
                      "type-label-large py-2 text-center transition-colors",
                      kind === option
                        ? "bg-secondary-container font-bold text-on-secondary-container"
                        : "text-on-surface-variant hover:bg-on-surface/8",
                    )}
                  >
                    {QUICK_KIND_LABELS[option]}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <DialogTitle>予定を追加</DialogTitle>
          )}
        </DialogHeader>

        {/* DialogContentはgrid。grid itemは既定でmin-width:autoのため、min-w-0が無いと
            保存先カレンダーのチップ列の幅がそのままシートの最小幅になり、行の中ではなく
            シートごと横に広がってしまう。 */}
        <div className="flex min-w-0 flex-col gap-3">
          <Input
            id="quick-event-title"
            label="タイトル"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onClear={() => setTitle("")}
          />

          {/* 予定とタスクの欄を同じセルに重ね、高い方に合わせる。切り替えるたびにシートの高さが
              変わって保存ボタンの位置がずれない（issue #1313）。選んでいない側は invisible と
              inert で、見えず・押せず・フォーカスも入らない。 */}
          <div className="grid min-w-0">
            <div
              className={cn("col-start-1 row-start-1 flex min-w-0 flex-col gap-3", isTask && "invisible")}
              inert={isTask}
            >
              <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)] gap-2">
                <Input
                  id="quick-event-date"
                  label="日付"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <Input
                  id="quick-event-start"
                  label="開始"
                  type="time"
                  value={startTime}
                  onChange={(e) => changeStartTime(e.target.value)}
                />
                <Input
                  id="quick-event-end"
                  label="終了"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>

              <CalendarChipSelect
                label="保存先カレンダー"
                value={calendarId}
                calendars={calendars}
                onChange={(next) => {
                  setCalendarId(next);
                  setPickedTravel(Boolean(travelCalendarId) && next === travelCalendarId);
                }}
              />

              {pickedTravel && calendarId === travelCalendarId && onOpenTravel && (
                <TravelEntryHint
                  onOpen={() => {
                    setOpen(false);
                    setTimeout(
                      () => onOpenTravel({ start: join(date, startTime), end: join(date, endTime) }),
                      150,
                    );
                  }}
                />
              )}

              {rangeError && <p className="text-sm text-destructive">{rangeError}</p>}
            </div>

            {taskAvailable && (
              <div
                className={cn("col-start-1 row-start-1 flex min-w-0 flex-col gap-3", !isTask && "invisible")}
                inert={!isTask}
              >
                <div className="flex flex-col gap-1.5">
                  <Label>入れる日付</Label>
                  <div className="flex gap-1">
                    {(["due", "planned"] as const).map((option) => (
                      <Button
                        key={option}
                        type="button"
                        variant={taskTarget === option ? "secondary" : "outline"}
                        size="sm"
                        aria-pressed={taskTarget === option}
                        onClick={() => setTaskTarget(option)}
                      >
                        {TASK_TARGET_LABELS[option]}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* 時刻を空にすると日付だけのタスクになる。 */}
                <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2">
                  <Input
                    id="quick-task-date"
                    label={`${TASK_TARGET_LABELS[taskTarget]}の日付`}
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                  <Input
                    id="quick-task-time"
                    label="時刻（任意）"
                    type="time"
                    value={taskTime}
                    onChange={(e) => setTaskTime(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {isTask && taskNeedsConfirmation && (
            <Button variant="outline" className="w-full" disabled={busy} onClick={recreateTask}>
              新しいタスクとして作り直す
            </Button>
          )}
        </div>

        {/* 「詳細」は削除の位置（下段）に置く。ここにしか全項目の入力画面へ移る道が無いため、
            入力ダイアログと同じ形に揃えたうえで残す（docs/spec.md §15）。 */}
        <ItemFormActions
          saveDisabled={
            busy ||
            !title.trim() ||
            (isTask && taskNeedsConfirmation) ||
            (isTask ? !date : !calendarId || rangeError !== null)
          }
          onSave={save}
        >
          <Button
            variant="ghost"
            className="w-full"
            disabled={busy || (isTask && !onOpenTaskDetail)}
            onClick={openDetail}
          >
            詳細
          </Button>
        </ItemFormActions>
      </DialogContent>
    </Dialog>
  );
}

function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** HH:mm を0:00からの分数へ。入力途中で読み取れない場合は null。 */
function toMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 日付と時刻を datetime-local と同じ形式へ。片方が空の間は結合できない。 */
function join(date: string, time: string): string {
  return date && time ? `${date}T${time}` : "";
}

/** サーバーが返した失敗理由を取り出す。無い場合は既定の文言にする。 */
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? fallback;
  } catch {
    return fallback;
  }
}
