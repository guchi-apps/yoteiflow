"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOffline } from "next/offline";

import { isOfflineNow } from "@/components/offline/offline-state";
import {
  getVisibleDays,
  parseDateKey,
  shiftAnchor,
  type CalendarView,
} from "@/lib/calendar-range";
import type {
  CalendarEventItem,
  CalendarLoadResult,
  ReminderItem,
  TaskItem,
  TravelItem,
  WritableCalendar,
} from "@/types/calendar";
import type { WorkRecordItem } from "@/types/work";

import { rangesWithin } from "./optimistic-events";
import { mergeRangeResponse } from "./range-data-merge";
import {
  FRESH_REQUEST_HEADER,
  withEventNotificationSettings,
  withEventOutcomes,
  withTaskLinks,
  withWorkRecords,
  type TouchedRange,
} from "./use-calendar-chunks";

/** 取得の失敗が続いても要求を出し続けないよう、再試行の間隔には下限を設ける。 */
const MIN_REFRESH_SECONDS = 30;

/**
 * 表示期間が変わってから取りにいくまでの待ち（issue #1377）。スワイプ・前へ／次へが続く間に
 * 期間ごとの要求を並行させると、追い越された要求もサーバーではGoogle・Notionへの往復を
 * 最後まで行い、Notionの回数制限で一部の取得元が失敗しやすくなる。前後1期間ぶんは先に
 * 取ってあるため、少し待っても動かした先は埋まっている。
 */
const FETCH_DEBOUNCE_MS = 250;

/**
 * 保存済み・取得元の一部失敗の応答を足し合わせたあと、確かな応答で置き換えるために
 * 取り直すまでの待ち（issue #1377）。
 */
const UNCERTAIN_RETRY_MS = 30_000;

const EMPTY_RESULT: CalendarLoadResult = {
  events: [],
  tasks: [],
  reminders: [],
  travels: [],
  workRecords: [],
  calendars: [],
  notionReady: false,
  reminderReady: false,
  errors: [],
};

function normalize(data: CalendarLoadResult): CalendarLoadResult {
  return {
    ...withWorkRecords(data),
    events: withEventNotificationSettings(withEventOutcomes(data.events)),
    tasks: withTaskLinks(data.tasks),
  };
}

function rangeKey(view: CalendarView, anchorKey: string): string {
  return `${view}:${anchorKey}`;
}

/**
 * `/api/calendar?view=&date=` が取る日の範囲（両端を含む日付キー）。サーバーの
 * `getSwipeFetchRange` と同じく前後1期間ぶんを含む（週の開始曜日は日・3日・週表示では使われない）。
 */
function coveredDays(view: CalendarView, anchorKey: string): { startKey: string; endKey: string } {
  const anchor = parseDateKey(anchorKey);
  const previous = getVisibleDays(view, shiftAnchor(view, anchor, -1), 0).days;
  const next = getVisibleDays(view, shiftAnchor(view, anchor, 1), 0).days;
  return { startKey: previous[0], endKey: next[next.length - 1] };
}

type RangeState = {
  key: string | null;
  data: CalendarLoadResult;
  /** 最新の内容を取れた要求を出した時刻（issue #787）。保存済み（stale）の応答では進めない。 */
  syncedAt: number;
  /** その内容が含む日の範囲。楽観的に重ねた予定を外してよいかの判定に使う。 */
  covered: { startKey: string; endKey: string } | null;
};

export type CalendarRangeData = {
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  travels: TravelItem[];
  workRecords: WorkRecordItem[];
  calendars: WritableCalendar[];
  notionReady: boolean;
  reminderReady: boolean;
  errors: CalendarLoadResult["errors"];
  /** 連携側ではなくアプリ側の取得失敗。 */
  loadError: string | null;
  /** いま表示中の期間を、まだ一度も取得できていない。予定が無いのか読み込み中なのかを描き分ける。 */
  pending: boolean;
  /**
   * 直近の取得が、通信が遅くてService Workerが代わりに返した保存済みだったか（issue #718）。
   * `use-calendar-chunks.ts` の `stale` と同じ判定・同じ扱い。
   */
  stale: boolean;
  /**
   * いま表示中の期間を取り直す。引数（変わった範囲）は使わない。範囲を1つしか持たず、
   * 月表示のように「かかる月だけ」を選んで取り直す必要が無いため。`useCalendarChunks` の
   * `invalidate` と同じ形にして、呼び出し側で表示形式ごとの分岐をさせない。
   */
  invalidate: (touched?: TouchedRange[] | null) => void;
  /** 指定した期間を、`since` より後に出した要求の最新の応答で取り直せたか（issue #787）。 */
  isSyncedSince: (ranges: TouchedRange[], since: number) => boolean;
};

/**
 * 日・3日・週表示のデータ。
 *
 * 月表示専用の `useCalendarChunks` は月単位で保持するが、日・3日・週表示にそのまま使うと
 * 表示中の数日ぶんのために月まるごとを取得することになり、過剰なアクセスになる
 * （docs/spec.md §20）。ここでは表示中の期間1つぶんだけを保持し、表示形式・日付が変わる
 * たびに `/api/calendar?view=&date=`（サーバーの `getSwipeFetchRange` と同じ範囲）から
 * 取り直す。取得の完了は待たず、表示形式・日付そのものの切り替えは別（`nav` の楽観値）が
 * 即座に反映する（issue #697）。
 */
export function useCalendarRangeData({
  enabled,
  view,
  anchorKey,
  dataPromise,
  seedView,
  seedAnchorKey,
  autoRefreshSeconds,
  onLoadingChange,
}: {
  /** 日・3日・週表示のときだけ働かせる。月表示ではこのフックの結果を使わない。 */
  enabled: boolean;
  view: CalendarView;
  anchorKey: string;
  /**
   * マウント時点でサーバーが描いた応答。マウント時点の表示形式が非月表示だったときだけ、
   * その期間の種として使う（以後に作られる新しい Promise は無視する。issue #697）。
   */
  dataPromise: Promise<CalendarLoadResult>;
  /** dataPromise が対応する表示形式・日付（マウント時点のもの）。 */
  seedView: CalendarView;
  seedAnchorKey: string;
  autoRefreshSeconds: number;
  onLoadingChange: (loading: boolean) => void;
}): CalendarRangeData {
  const [state, setState] = useState<RangeState>(() => ({
    key: null,
    data: EMPTY_RESULT,
    syncedAt: 0,
    covered: null,
  }));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const onLoadingChangeRef = useRef(onLoadingChange);
  useEffect(() => {
    onLoadingChangeRef.current = onLoadingChange;
  }, [onLoadingChange]);

  const offline = useOffline();
  const offlineRef = useRef(offline);
  useEffect(() => {
    offlineRef.current = offline;
  }, [offline]);

  const [seedPromise] = useState(() => dataPromise);
  const [seedKeyAtMount] = useState(() => rangeKey(seedView, seedAnchorKey));
  // マウント時点で月表示だった場合、dataPromise は月まるごとの範囲しか含んでおらず、
  // 日・3日・週表示の種としては使えない。その場合は最初から「種の判定は済んでいる」
  // 扱いにし、後段の取得（fetchRange）へそのまま任せる（issue #697）。
  const [seedSettled, setSeedSettled] = useState(() => seedView === "month");

  // 取得の管理はすべて ref で持つ。React state（再描画のもと）を読んで setState するのを
  // effect の中で行うと、更新が state から生まれているように見えて意図が伝わりにくいため、
  // 「いつ・どの期間まで取得できたか」は外部の記録（ref）として扱う。
  const inFlightKeyRef = useRef<string | null>(null);
  const fetchedRef = useRef<{ key: string | null; fetchedAt: number }>({ key: null, fetchedAt: 0 });
  // 表示形式・日付の連続切り替えでは、古い期間への要求が新しい期間への要求より後に
  // 届くことがある（ネットワークの遅延順は要求順と限らない）。単調増加するIDを
  // 要求ごとに発行し、応答が届いた時点で「自分が最後に発行した要求か」を確認してから
  // state/fetchedRef を更新する。一致しなければ、すでに用済みの古い応答として捨てる
  // （追い越された要求の分は fetchedRef も更新しないため、あとで同じ期間へ戻ってきたときは
  // 改めて取り直しになり、「上書きされたまま空表示に固定される」ことが無い。issue #702）。
  const latestRequestIdRef = useRef(0);
  // 最後に invalidate() された時刻と、まだその取り直しの要求を出していないか（issue #787）。
  // 取得中に invalidate しても、その要求は保存より前に出したものかもしれない。届いた応答の
  // 要求時刻が invalidate より古ければ、表示は更新しつつもう一度取りにいく。
  const invalidatedAtRef = useRef(0);
  const freshPendingRef = useRef(false);
  // 確かでない応答のあとの取り直し（issue #1377）。取り直しの応答も確かでなかったとき
  // （認可の失効のように続く失敗）に30秒ごとの要求を出し続けないよう、取り直しは1回に限る。
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryPendingRef = useRef(false);

  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (seedView === "month") return;

    let cancelled = false;

    seedPromise.then(
      (data) => {
        if (cancelled) return;
        fetchedRef.current = { key: seedKeyAtMount, fetchedAt: Date.now() };
        setState({
          key: seedKeyAtMount,
          data: normalize(data),
          syncedAt: 0,
          covered: coveredDays(seedView, seedAnchorKey),
        });
        setSeedSettled(true);
      },
      () => {
        if (!cancelled) setSeedSettled(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [seedPromise, seedKeyAtMount, seedView, seedAnchorKey]);

  const key = rangeKey(view, anchorKey);
  // invalidate() が押されたことを、下の取得判定の effect へ伝えるためだけの通し番号。
  // fetchedRef（ref）を古くするだけでは、effect の依存に何も変化が無く再実行されない。
  const [invalidateNonce, setInvalidateNonce] = useState(0);

  const fetchRange = useCallback(async (targetView: CalendarView, targetAnchorKey: string) => {
    const targetKey = rangeKey(targetView, targetAnchorKey);
    const requestId = ++latestRequestIdRef.current;
    const requestedAt = Date.now();
    const fresh = freshPendingRef.current;
    freshPendingRef.current = false;
    const isRetry = retryPendingRef.current;
    retryPendingRef.current = false;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    inFlightKeyRef.current = targetKey;
    onLoadingChangeRef.current(true);
    // 取り直しを始めた時点で、前の期間ぶんの印は一旦下ろす。届いた応答で改めて判定し直す。
    setStale(false);

    try {
      const params = new URLSearchParams({ view: targetView, date: targetAnchorKey });
      const response = await fetch(`/api/calendar?${params.toString()}`, {
        headers: fresh ? { [FRESH_REQUEST_HEADER]: "1" } : undefined,
      });
      if (!response.ok) throw new Error(`status ${response.status}`);

      // 通信が遅くてService Workerがタイムアウトで保存済みを代わりに返したとき（issue #718）。
      const responseStale = response.headers.get("X-Dayspan-Stale") === "1";

      const data = normalize((await response.json()) as CalendarLoadResult);
      // 自分より後に発行された要求があれば、追い越された古い応答として捨てる。
      if (latestRequestIdRef.current !== requestId) return;
      // 保存済み・取得元の一部失敗の応答では、表示中の項目を消さずに足し合わせる（issue #1377）。
      const uncertain = responseStale || data.errors.length > 0;
      setState((prev) => ({
        key: targetKey,
        data: mergeRangeResponse(prev.data, data, { stale: responseStale }).data,
        // 保存済みが返ったときは、同じ期間で前に最新を取れた時点のまま据え置く。
        syncedAt: responseStale ? (prev.key === targetKey ? prev.syncedAt : 0) : requestedAt,
        covered: coveredDays(targetView, targetAnchorKey),
      }));
      setLoadError(null);
      setStale(responseStale);

      if (invalidatedAtRef.current > requestedAt) {
        // 要求を出したあとに invalidate() された。この応答では足りないため、取得済みにせず
        // もう一度取りにいく（取得判定の effect を起こす）。
        fetchedRef.current = { key: null, fetchedAt: 0 };
        freshPendingRef.current = true;
        setInvalidateNonce((n) => n + 1);
      } else {
        fetchedRef.current = { key: targetKey, fetchedAt: Date.now() };
      }

      if (uncertain && !isRetry) {
        // 足し合わせたぶんには、他の端末で消した・完了した項目が残りうる。少し後に取り直し、
        // 確かな応答で置き換える。保存済みが返るほど遅い回線でも最新を待てるよう、
        // Service Workerのタイムアウトで保存済みへ倒さない（FRESH_REQUEST_HEADER）。
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          retryPendingRef.current = true;
          freshPendingRef.current = true;
          fetchedRef.current = { key: null, fetchedAt: 0 };
          setInvalidateNonce((n) => n + 1);
        }, UNCERTAIN_RETRY_MS);
      }
    } catch {
      if (latestRequestIdRef.current !== requestId) return;

      // 取得できなくても期間そのものは「試した」ことにする。刻まないと、
      // 取得できないまま同じ期間へ要求を出し続けることになる。
      fetchedRef.current = { key: targetKey, fetchedAt: Date.now() };

      // オフラインなら失敗として出さない（issue #321）。画面には既に OfflineNotice が出ている。
      setLoadError(
        isOfflineNow(offlineRef.current) ? null : "表示範囲の予定とタスクを取得できませんでした。",
      );
    } finally {
      // 追い越された要求は、自分がin-flightの主でなくなっている（新しい要求が
      // inFlightKeyRef・ローディング表示を引き継いでいる）ため、ここで下ろさない。
      if (latestRequestIdRef.current === requestId) {
        if (inFlightKeyRef.current === targetKey) inFlightKeyRef.current = null;
        onLoadingChangeRef.current(false);
      }
    }
  }, []);

  // 表示中の期間が変わった・古くなったら取りにいく。判定（inFlight・fetchedRef）は
  // どちらも ref のため、この effect 自体は React state を読んで setState してはいない
  // （fetchRange の中で setState するのは、あくまで fetch の応答が届いたときだけ）。
  useEffect(() => {
    if (!enabled || !seedSettled) return;
    if (inFlightKeyRef.current === key) return;

    const ttl = Math.max(autoRefreshSeconds, MIN_REFRESH_SECONDS) * 1000;
    const fetched = fetchedRef.current;
    const fresh = fetched.key === key && Date.now() - fetched.fetchedAt < ttl;
    if (fresh) return;

    const timer = setTimeout(() => void fetchRange(view, anchorKey), FETCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, seedSettled, key, view, anchorKey, autoRefreshSeconds, fetchRange, invalidateNonce]);

  /**
   * いま表示中の期間を取り直す。取得が終わるまでは、それまで持っていた内容を表示したままにする
   * （月表示の `invalidate` と同じ扱い。空へ戻すと、取り直しのたびに一瞬グリッドが空になる）。
   */
  const invalidate = useCallback((_touched?: TouchedRange[] | null) => {
    invalidatedAtRef.current = Date.now();
    freshPendingRef.current = true;
    fetchedRef.current = { key: null, fetchedAt: 0 };
    setInvalidateNonce((n) => n + 1);
  }, []);

  // 表示期間（view・anchorKey）が変わった直後は、新しい期間の取得がまだ終わっていない。
  // ここで EMPTY_RESULT へ落とすと、前へ・次へ・スワイプのたびに一瞬グリッドが空になり、
  // 直前まで表示できていた予定まで消える（issue #719）。`invalidate()` が同じキーのまま
  // 「取得が終わるまでは、それまで持っていた内容を表示したままにする」のと同じ考え方で、
  // 期間が変わったときも `state.data`（直前に取得できた期間の内容）を表示し続け、新しい
  // 期間の取得が終わった時点で `state` ごと入れ替わって更新される。
  const showing = state.data;

  const isSyncedSince = useCallback(
    (ranges: TouchedRange[], since: number) =>
      state.covered !== null &&
      state.syncedAt >= since &&
      rangesWithin(ranges, state.covered.startKey, state.covered.endKey),
    [state.covered, state.syncedAt],
  );

  return {
    events: showing.events,
    tasks: showing.tasks,
    reminders: showing.reminders,
    travels: showing.travels,
    workRecords: showing.workRecords,
    calendars: showing.calendars,
    notionReady: showing.notionReady,
    reminderReady: showing.reminderReady,
    errors: showing.errors,
    loadError,
    pending: state.key !== key,
    stale,
    invalidate,
    isSyncedSince,
  };
}
