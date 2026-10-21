"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { type EventDraft } from "@/components/calendar/event-form";
import { ItemDialog } from "@/components/calendar/item-dialog";
import {
  DEFAULT_START_MINUTES,
  QuickEventSheet,
  toQuickEventDraft,
} from "@/components/calendar/quick-event-sheet";
import { readErrorMessage } from "@/components/calendar/response-error";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WritableCalendar } from "@/types/calendar";

type QuickEventData = {
  calendars: WritableCalendar[];
  timeZone: string;
  /** 活動記録の保存先（issue #1309）。古い応答には無いため任意にする。 */
  activityCalendarId?: string | null;
};

/**
 * メインナビのカレンダーを長押ししたときに出るシート（issue #652）。
 *
 * カレンダー画面自身はすでにcalendars/timeZoneを持っているため、この自己完結シートは
 * それ以外の4画面（記録・タスク・勤務・買い物リスト）専用。ActivityQuickSheetと同じく、
 * 開くまで中身（保存先カレンダー一覧）は取りにいかない。
 */
export function CalendarQuickSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<QuickEventData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState<EventDraft | null>(null);
  const activityCalendarId = data?.activityCalendarId ?? null;
  const activityCalendarIds = useMemo(
    () => new Set(activityCalendarId ? [activityCalendarId] : []),
    [activityCalendarId],
  );

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    void (async () => {
      setData(null);
      setDetailDraft(null);
      setError(null);
      try {
        const response = await fetch("/api/quick-event");
        if (!response.ok) {
          if (!cancelled) {
            setError(await readErrorMessage(response, "カレンダーを取得できませんでした。"));
          }
          return;
        }
        const body = (await response.json()) as QuickEventData;
        if (!cancelled) setData(body);
      } catch {
        // navigator.onLineはtrueの側を信用できない（WiFiには繋がっているが外へ出られない
        // 場合もtrueを返す）が、falseは信用できる。取得に失敗した時点でだけ読み、
        // オフライン向けの文言に切り替える（CLAUDE.md「オフラインかの判定」）。
        if (!cancelled) {
          setError(navigator.onLine === false ? OFFLINE_WRITE_MESSAGE : "カレンダーを取得できませんでした。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const close = () => onOpenChange(false);

  // 保存後は閉じるだけにする。この入口が渡すItemDrafts/QuickEventDraftは予定だけで、
  // 記録・タスク・勤務・買い物リストいずれの画面も予定を表示しないため、保存しても
  // その画面の表示は何も変わらない。router.refresh()を呼ぶとサーバー側の取得
  // （Notionの全件ページング等）がすべてやり直しになり、過剰なアクセスになる
  // （docs/spec.md §20）。ActivityQuickSheetがrefresh()するのは、記録の開始・停止が
  // ナビの印や記録中バーというその画面の表示自体を変えるためで、前提が違う。
  if (open && data && data.calendars.length > 0) {
    if (detailDraft) {
      return (
        <ItemDialog
          initialKind="event"
          drafts={{ event: detailDraft }}
          calendars={data.calendars}
          timeZone={data.timeZone}
          onClose={close}
          onSaved={close}
          activityCalendarIds={activityCalendarIds}
        />
      );
    }

    return (
      <QuickEventSheet
        draft={toQuickEventDraft(
          createCalendarDateUtils(data.timeZone).todayKey(),
          DEFAULT_START_MINUTES,
        )}
        calendars={data.calendars}
        timeZone={data.timeZone}
        onClose={close}
        onSaved={close}
        onOpenDetail={setDetailDraft}
        activityCalendarIds={activityCalendarIds}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position="bottom" className="gap-3 pb-[calc(1.5rem_+_env(safe-area-inset-bottom))]">
        <DialogHeader>
          <DialogTitle>予定を追加</DialogTitle>
        </DialogHeader>

        {error ? (
          <p className="rounded-md bg-error-container/70 px-3 py-2 text-xs text-on-error-container">
            {error}
          </p>
        ) : data && data.calendars.length === 0 ? (
          <>
            <p className="type-body-small text-on-surface-variant">
              書き込めるカレンダーがありません。設定 ▸ Google Calendar でカレンダーを接続してください。
            </p>
            <Button variant="outline" size="sm" asChild className="self-start">
              <Link href="/settings/google" onClick={close}>
                設定へ
              </Link>
            </Button>
          </>
        ) : (
          <p className="type-body-small text-on-surface-variant">読み込んでいます…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
