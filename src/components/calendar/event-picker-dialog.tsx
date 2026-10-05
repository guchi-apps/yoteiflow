"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getVisibleDays, parseMonthKey, shiftMonthKey } from "@/lib/calendar-range";
import { dayTone } from "@/lib/day-tone";
import { cn } from "@/lib/utils";
import { resolveStageDate } from "@/services/task-links/stage";
import {
  TASK_LINK_TARGET_LABELS,
  type CalendarEventItem,
  type TaskEventStage,
  type TaskLinkTarget,
  type TravelItem,
} from "@/types/calendar";

import { isoToLocalInput } from "./datetime-fields";
import { createCalendarDateUtils } from "./item-layout";
import { readErrorMessage } from "./response-error";
import { formatLinkedDate } from "./task-link-label";
import { TaskStagePicker } from "./task-stage-picker";

/** 入力画面が保留しておく紐づけ先。タスクを保存するときに紐づける。 */
export type PendingEventLink = {
  calendarId: string;
  eventId: string;
  eventTitle: string;
  /** 紐づけ先が移動のとき（issue #1079）。calendarId / eventId は空文字になる。 */
  travelId?: string;
  stage: TaskEventStage;
  /** 選んだ時点で決まる日時。入力画面に見せるための値で、実際に入る値は保存時にサーバーが決める。 */
  date: string;
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
// セルに並べる予定の数。それを超えた分は日付を押して下の一覧から選ぶ。
const CELL_LIMIT = 2;

/**
 * 予定を1つ選んで紐づけ先にする（issue #802・docs/spec.md §31）。
 *
 * 月表示と同じ見た目の簡易な月グリッドを出し、予定を押すと確認へ進む。ContinuousMonthView は
 * スワイプ・ドラッグ・長押しを前提にした作りで、ここで要るのは「1か月ぶんを見て1件選ぶ」だけのため使わない。
 * 予定は表示している月ぶんだけ取り、月を送ったときにだけ取り直す（外部APIへの往復を増やさない）。
 * 使用オフのカレンダーの予定も選べる。紐づけはGoogleへ書き込まないため。
 */
export function EventPickerDialog({
  target,
  timeZone,
  weekStartsOn,
  onCancel,
  onPick,
}: {
  target: TaskLinkTarget;
  timeZone: string;
  weekStartsOn: number;
  onCancel: () => void;
  onPick: (link: PendingEventLink) => void;
}) {
  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  const utils = useMemo(() => createCalendarDateUtils(timeZone), [timeZone]);

  const todayKey = useMemo(
    () => isoToLocalInput(new Date().toISOString(), timeZone).slice(0, 10),
    [timeZone],
  );
  const [monthKey, setMonthKey] = useState(() => todayKey.slice(0, 7));
  const [events, setEvents] = useState<CalendarEventItem[] | null>(null);
  // 紐づけ先の種類（予定・移動。issue #1079）。移動は予定と同じ形に直して以降は共通に扱う。
  const [source, setSource] = useState<"event" | "travel">("event");
  const [travels, setTravels] = useState<TravelItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 月グリッドか日付ごとの一覧か（issue #809）。端末には覚えさせない。
  const [mode, setMode] = useState<"month" | "list">("month");
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const [chosen, setChosen] = useState<(CalendarEventItem & { travelId?: string }) | null>(null);
  const [stage, setStage] = useState<TaskEventStage>("BEFORE_START");
  // 月を素早く送ったときに、遅れて届いた古い月の応答で上書きしない。
  const requestId = useRef(0);

  useEffect(() => {
    if (source !== "travel") return;
    let cancelled = false;

    fetch(`/api/travels?month=${monthKey}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readErrorMessage(response, "移動を取得できませんでした。"));
        return (await response.json()) as { travels: TravelItem[] };
      })
      .then((data) => {
        if (!cancelled) {
          setTravels(data.travels ?? []);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setTravels([]);
        setError(cause instanceof Error ? cause.message : "移動を取得できませんでした。");
      });

    return () => {
      cancelled = true;
    };
  }, [monthKey, source]);

  useEffect(() => {
    if (source !== "event") return;
    const id = ++requestId.current;
    let cancelled = false;

    fetch(`/api/events?month=${monthKey}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readErrorMessage(response, "予定を取得できませんでした。"));
        return (await response.json()) as {
          events: CalendarEventItem[];
          errors?: { reason: string }[];
        };
      })
      .then((data) => {
        if (cancelled || id !== requestId.current) return;
        setEvents(data.events ?? []);
        // Googleの取得に失敗しても空として返る。空の月と区別できるよう理由を出す。
        setError(data.errors?.[0]?.reason ?? null);
      })
      .catch((cause: unknown) => {
        if (cancelled || id !== requestId.current) return;
        setEvents([]);
        setError(cause instanceof Error ? cause.message : "予定を取得できませんでした。");
      });

    return () => {
      cancelled = true;
    };
  }, [monthKey, source]);

  const weeks = useMemo(
    () => getVisibleDays("month", parseMonthKey(monthKey), weekStartsOn).weeks,
    [monthKey, weekStartsOn],
  );

  const eventsOn = (dateKey: string): CalendarEventItem[] =>
    (events ?? [])
      .filter((event) => utils.eventCoversDay(event, dateKey))
      // 終日を先に、続いて開始の早い順。
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));

  const close = () => {
    setOpen(false);
    setTimeout(onCancel, 150);
  };

  const choose = (event: CalendarEventItem) => {
    setChosen(event);
    setStage("BEFORE_START");
  };

  const chooseTravel = (travel: TravelItem) => {
    choose({
      kind: "event",
      id: "",
      calendarId: "",
      title: travel.title,
      allDay: false,
      start: travel.start,
      end: travel.end,
      travelId: travel.id,
    } as unknown as CalendarEventItem & { travelId?: string });
  };

  const confirm = () => {
    if (!chosen) return;
    const resolved = resolveStageDate(chosen, stage);

    setOpen(false);
    setTimeout(
      () =>
        onPick({
          calendarId: chosen.calendarId,
          eventId: chosen.id,
          eventTitle: chosen.title,
          ...(chosen.travelId ? { travelId: chosen.travelId } : {}),
          stage,
          date: resolved.date,
        }),
      150,
    );
  };

  const targetLabel = TASK_LINK_TARGET_LABELS[target];
  const monthLabel = `${monthKey.slice(0, 4)}年${Number(monthKey.slice(5, 7))}月`;
  const listDays = useMemo(
    () =>
      weeks
        .flat()
        .filter((dateKey) => dateKey.slice(0, 7) === monthKey)
        .map((dateKey) => ({ dateKey, dayEvents: eventsOn(dateKey) }))
        .filter((day) => day.dayEvents.length > 0),
    // eventsOn は events と utils だけに依存する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weeks, monthKey, events, utils],
  );
  const focusEvents = focusDay ? eventsOn(focusDay) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {chosen ? (
          <>
            <DialogHeader>
              <DialogTitle>{chosen.travelId ? "この移動に紐づけますか" : "この予定に紐づけますか"}</DialogTitle>
              <DialogDescription className="sr-only">
                選んだ予定の段階から{targetLabel}の日時が決まります。
              </DialogDescription>
            </DialogHeader>

            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-0.5 rounded-lg bg-surface-container-high px-3 py-2">
                <b className="clip-nowrap text-sm">{chosen.title}</b>
                <span className="text-xs text-on-surface-variant">
                  {chosen.allDay
                    ? formatLinkedDate(chosen.start, timeZone)
                    : `${formatLinkedDate(chosen.start, timeZone)} 〜 ${formatLinkedDate(chosen.end, timeZone)}`}
                </span>
              </div>

              <TaskStagePicker value={stage} travel={Boolean(chosen.travelId)} onChange={setStage} />

              <p className="text-sm text-on-surface-variant">
                {targetLabel}は{" "}
                <b className="text-on-surface">
                  {formatLinkedDate(resolveStageDate(chosen, stage).date, timeZone)}
                </b>{" "}
                になります。{chosen.travelId ? "移動" : "予定"}を動かすと{targetLabel}も動きます。
                タスクを保存すると紐づけが確定します。
              </p>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setChosen(null)}>
                選び直す
              </Button>
              <Button onClick={confirm}>OK</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{targetLabel}にする{source === "travel" ? "移動" : "予定"}を選ぶ</DialogTitle>
              <DialogDescription className="type-body-small text-on-surface-variant">
                {source === "travel" ? "移動" : "予定"}を押すと確認に進みます。
              </DialogDescription>
            </DialogHeader>

            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex gap-1">
                {(["event", "travel"] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={source === value ? "secondary" : "outline"}
                    className={cn(source === value && "text-on-secondary-container")}
                    onClick={() => setSource(value)}
                  >
                    {value === "event" ? "予定" : "移動"}
                  </Button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="前の月"
                  onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <div className="flex items-center gap-2">
                  <b className="text-sm">{monthLabel}</b>
                  {monthKey !== todayKey.slice(0, 7) && (
                    <Button variant="ghost" size="sm" onClick={() => setMonthKey(todayKey.slice(0, 7))}>
                      今日
                    </Button>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="次の月"
                  onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>

              {source === "event" && (
              <div className="flex gap-1">
                {(["month", "list"] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={mode === value ? "secondary" : "outline"}
                    className={cn(mode === value && "text-on-secondary-container")}
                    onClick={() => setMode(value)}
                  >
                    {value === "month" ? "月" : "一覧"}
                  </Button>
                ))}
              </div>
              )}

              {source === "travel" ? (
                <div className="flex max-h-[50dvh] flex-col overflow-y-auto rounded-md border border-outline-variant">
                  {travels !== null && travels.length === 0 && (
                    <p className="px-3 py-3 text-sm text-muted-foreground">移動がありません。</p>
                  )}
                  {(travels ?? []).map((travel) => (
                    <button
                      key={travel.id}
                      type="button"
                      onClick={() => chooseTravel(travel)}
                      className="flex w-full items-center justify-between gap-3 border-b border-outline-variant px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface-container-high"
                    >
                      <span className="clip-nowrap">{travel.title}</span>
                      <span className="shrink-0 text-xs text-on-surface-variant">
                        {formatLinkedDate(travel.start, timeZone)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : mode === "list" ? (
                <div
                  className={cn(
                    "flex max-h-[50dvh] flex-col overflow-y-auto rounded-md border border-outline-variant transition-opacity",
                    events === null && "opacity-50",
                  )}
                >
                  {events !== null && listDays.length === 0 && (
                    <p className="px-3 py-3 text-sm text-muted-foreground">予定がありません。</p>
                  )}
                  {listDays.map(({ dateKey, dayEvents }) => (
                    <div key={dateKey}>
                      <p className="sticky top-0 border-b border-outline-variant bg-surface-container-high px-3 py-1 text-xs text-on-surface-variant">
                        {formatLinkedDate(dateKey, timeZone)}
                      </p>
                      {dayEvents.map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => choose(event)}
                          className="flex w-full items-center justify-between gap-3 border-b border-outline-variant px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface-container-high"
                        >
                          <span className="clip-nowrap">{event.title}</span>
                          <span className="shrink-0 text-xs text-on-surface-variant">
                            {event.allDay
                              ? "終日"
                              : formatLinkedDate(event.start, timeZone).split(" ")[1]}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
              <div
                className={cn(
                  "grid grid-cols-7 border-t border-l border-outline-variant transition-opacity",
                  events === null && "opacity-50",
                )}
              >
                {Array.from({ length: 7 }, (_, i) => WEEKDAYS[(weekStartsOn + i) % 7]).map((name) => (
                  <div
                    key={name}
                    className="border-r border-b border-outline-variant py-0.5 text-center text-[10px] text-on-surface-variant"
                  >
                    {name}
                  </div>
                ))}
                {weeks.flat().map((dateKey) => {
                  const inMonth = dateKey.slice(0, 7) === monthKey;
                  const dayEvents = inMonth ? eventsOn(dateKey) : [];

                  return (
                    <div
                      key={dateKey}
                      className={cn(
                        "flex min-h-14 min-w-0 flex-col gap-0.5 border-r border-b border-outline-variant p-0.5",
                        dateKey === focusDay && "bg-secondary-container/40",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setFocusDay(dateKey)}
                        className={cn(
                          "rounded px-0.5 text-right text-[10px]",
                          dayTone(dateKey) ?? "text-on-surface-variant",
                          !inMonth && "opacity-40",
                          dateKey === todayKey && "font-bold text-primary",
                        )}
                      >
                        {Number(dateKey.slice(8, 10))}
                      </button>
                      {dayEvents.slice(0, CELL_LIMIT).map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          title={event.title}
                          onClick={() => choose(event)}
                          className="clip-nowrap rounded-(--radius-item) border-l-[3px] border-primary bg-primary/10 px-1 text-left text-[10px] leading-4"
                        >
                          {event.title}
                        </button>
                      ))}
                      {dayEvents.length > CELL_LIMIT && (
                        <button
                          type="button"
                          onClick={() => setFocusDay(dateKey)}
                          className="text-left text-[10px] text-on-surface-variant"
                        >
                          他{dayEvents.length - CELL_LIMIT}件
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              )}

              {source === "event" && mode === "month" && focusDay && (
                <div className="flex flex-col rounded-md border border-outline-variant">
                  <p className="border-b border-outline-variant px-3 py-1.5 text-xs text-on-surface-variant">
                    {formatLinkedDate(focusDay, timeZone)}の予定
                  </p>
                  {focusEvents.length === 0 && (
                    <p className="px-3 py-3 text-sm text-muted-foreground">予定がありません。</p>
                  )}
                  {focusEvents.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => choose(event)}
                      className="flex items-center justify-between gap-3 border-b border-outline-variant px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface-container-high"
                    >
                      <span className="clip-nowrap">{event.title}</span>
                      <span className="shrink-0 text-xs text-on-surface-variant">
                        {event.allDay
                          ? "終日"
                          : formatLinkedDate(event.start, timeZone).split(" ")[1]}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {(source === "travel" ? travels === null : events === null) && <p className="text-xs text-muted-foreground">読み込んでいます…</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={close}>
                やめる
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
