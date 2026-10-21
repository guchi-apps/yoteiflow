"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { WritableCalendar } from "@/types/calendar";

import { CalendarChipSelect } from "./calendar-chip-select";
import { localInputToIso } from "./datetime-fields";
import type { EventDraft } from "./event-form";
import { ItemFormActions } from "./item-form-actions";
import { MINUTES_PER_DAY } from "./item-layout";
import { buildOptimisticEvent, type OptimisticEventChange } from "./optimistic-events";
import { TravelEntryHint } from "./travel-entry-hint";
import type { TouchedRange } from "./use-calendar-chunks";

export type QuickEventDraft = {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  startTime: string;
  /** HH:mm */
  endTime: string;
};

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
): QuickEventDraft {
  return {
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
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(draft.date);
  const [startTime, setStartTime] = useState(draft.startTime);
  const [endTime, setEndTime] = useState(draft.endTime);
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

  const save = async () => {
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
          <DialogTitle>予定を追加</DialogTitle>
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

          {/* 日付は押した日から動かさないことが多い。時刻2つより幅を取らせない。 */}
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
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {/* 「詳細」は削除の位置（下段）に置く。ここにしか全項目の入力画面へ移る道が無いため、
            入力ダイアログと同じ形に揃えたうえで残す（docs/spec.md §15）。 */}
        <ItemFormActions
          saveDisabled={busy || !title.trim() || !calendarId || rangeError !== null}
          onSave={save}
        >
          <Button variant="ghost" className="w-full" disabled={busy} onClick={openDetail}>
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
