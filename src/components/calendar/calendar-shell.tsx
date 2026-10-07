"use client";

import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Plus,
  RefreshCw,
} from "lucide-react";

import { AppMenuButton } from "@/components/nav/app-drawer";
import { AppFrame } from "@/components/nav/app-frame";
import { BottomNav } from "@/components/nav/main-nav";
import { fabBottomOffsetClass, RunningActivityBar } from "@/components/nav/running-activity-bar";
import { OFFLINE_WRITE_MESSAGE, OfflineNotice } from "@/components/offline/offline-notice";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { SlowNetworkNotice } from "@/components/offline/slow-network-notice";
import { Button } from "@/components/ui/button";
import { LinearProgress } from "@/components/ui/linear-progress";
import { WorkRecordDialog, type WorkDraft } from "@/components/work/work-record-dialog";
import {
  addDays,
  getContinuousMonthWeeks,
  getContinuousMonthSpan,
  getVisibleDays,
  monthDistance,
  monthsOfWeeks,
  parseDateKey,
  parseMonthKey,
  shiftAnchor,
  shiftMonthKey,
  toDateKey,
  VIRTUAL_MONTHS_AROUND,
  type CalendarView,
} from "@/lib/calendar-range";
import { rememberCalendarView } from "@/lib/calendar-view-memory";
import { HANDOFF_QUERY_KEYS, handoffLocationText, hasHandoffQuery, linkedTravelTimes, parseShareHandoff } from "@/lib/share-import/handoff";
import { cn } from "@/lib/utils";
import { EMPTY_PLACE_CATALOG, type PlaceCatalog } from "@/services/notion/places";
import { EMPTY_TAG_CATALOG, type TagCatalog } from "@/services/notion/tag-options";
import type { RunningActivityItem } from "@/types/activity";
import {
  type CalendarEventItem,
  type CalendarLoadResult,
  type ReminderItem,
  type TaskEventStage,
  type TaskItem,
  type TaskLinkTarget,
  type TravelItem,
  type TravelMode,
} from "@/types/calendar";
import type { TravelSettings } from "@/services/travel/settings";
import { coversDate, type WorkCapabilities } from "@/types/work";
import { dayTone, weekdayLabel } from "@/lib/day-tone";

import { dateKeyPlusMinutes, isoToLocalInput, localInputToIso } from "./datetime-fields";
import { EventDetailDialog } from "./event-detail-dialog";
import { duplicateEventDraft, toEventDraft, type EventDraft } from "./event-form";
import { EventPickerDialog, type PickedItem } from "./event-picker-dialog";
import { ItemDialog, type AddableKind, type ItemDrafts, type ItemKind } from "./item-dialog";
import { createCalendarDateUtils, type CalendarDateUtils } from "./item-layout";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import { ContinuousMonthView } from "./continuous-month-view";
import {
  DEFAULT_START_MINUTES,
  QuickEventSheet,
  toQuickEventDraft,
  type QuickEventDraft,
} from "./quick-event-sheet";
import { ReminderDetailDialog } from "./reminder-detail-dialog";
import { toReminderDraft } from "./reminder-form";
import { TaskDetailDialog } from "./task-detail-dialog";
import { TaskLinkDialog } from "./task-link-dialog";
import { toTaskDraft } from "./task-form";
import { TimeGridView } from "./time-grid-view";
import {
  applyOptimisticEvents,
  buildOptimisticEvent,
  OPTIMISTIC_EVENT_TTL_MS,
  pendingOptimisticOps,
  type OptimisticEventChange,
  type OptimisticEventOp,
} from "./optimistic-events";
import { TravelDetailDialog } from "./travel-detail-dialog";
import { toTravelDraft } from "./travel-form";
import {
  monthsOfRanges,
  taskRanges,
  useCalendarChunks,
  type TouchedRange,
} from "./use-calendar-chunks";
import { useCalendarRangeData } from "./use-calendar-range-data";
import { useCalendarShortcuts, type CalendarShortcutActions } from "./use-calendar-shortcuts";
import type { AllDayDragCommit, DragCommit } from "./use-grid-drag";
import type { SlotRangeCommit } from "./use-slot-range";

// 移動の仮の長さ。押した時点では所要時間が分からないが、出発と到着を同じ時刻にすると
// 開いた瞬間に入力の注意が出るため、直す前提の長さを置いておく。
const DEFAULT_TRAVEL_MINUTES = 30;

// 日・3日・週表示は月ごとのチャンクを持たないため常に空（issue #697）。ContinuousMonthView
// にしか渡らない値で、その表示形式のときは使われない。
const NO_PENDING_MONTHS: ReadonlySet<string> = new Set();

// 期間の短い順に並べる。同じ並びの中で右へ行くほど広い範囲を見ることになり、
// 「今いる形式より広く／狭く見たい」がどちら向きに押せばよいか迷わずに済む。
const VIEW_LABELS: { view: CalendarView; label: string; desktopOnly?: boolean }[] = [
  { view: "day1", label: "1日" },
  { view: "day3", label: "3日" },
  { view: "day7", label: "週", desktopOnly: true },
  { view: "month", label: "月" },
];

/**
 * 勤務記録DB（docs/spec.md §34）のうち、日付ヘッダーのスロットから入力するのに要るもの。
 *
 * どれも `NotionConnection` の1行から決まる値で、カレンダーはその行を既に読んでいる。
 * Notionへの往復は増えない（勤務場所の選択肢もタグ・種類と同じ `loadTagCatalog` で読み終えている）。
 */
export type CalendarWorkContext = {
  /** データソースと必須プロパティが揃っているか。揃っていなければスロットを押せる形にしない。 */
  writable: boolean;
  /** 出張扱いにする勤務場所の名前。 */
  tripPlaces: string[];
  /** 出張・年休・会社休業日・申請・メモが使えるか。 */
  capabilities: WorkCapabilities;
  /** 1日の所定労働時間（分）。時間休として選べる時間数の上限を決める（issue #537）。 */
  minutesPerDay: number;
};

export function CalendarShell({
  view,
  anchorKey,
  days,
  weeks,
  dataPromise,
  tagCatalogPromise,
  placeCatalogPromise,
  initialRunningActivity,
  activityCalendarIds,
  holidayCalendarIds,
  travelSettings,
  work,
  weekStartsOn,
  timeZone,
  autoRefreshSeconds,
}: {
  view: CalendarView;
  anchorKey: string;
  days: string[];
  weeks: string[][];
  dataPromise: Promise<CalendarLoadResult>;
  /**
   * 登録済みのタグ・種類。予定・タスクの取得とは別に解決させる。
   * 月をまたぐたびに取り直す必要は無く、Notionへの往復をそのぶん増やさずに済む。
   */
  tagCatalogPromise: Promise<TagCatalog>;
  /** 登録済みの場所。タグ・種類と同じく、月をまたいでも変わらないため別に解決させる。 */
  placeCatalogPromise: Promise<PlaceCatalog>;
  /**
   * 記録中の活動（docs/spec.md §27）。開始・停止は記録の画面で行うため、ここでは表示だけに使う。
   * まだGoogleに予定が無いぶんを時間グリッドへ帯として描く。
   */
  initialRunningActivity: RunningActivityItem | null;
  /**
   * 活動記録の保存先に選ばれているカレンダー（issue #241）。
   * ここに入っている予定は、時間グリッドでは塗りを落として描き、月表示には出さない。
   */
  activityCalendarIds: string[];
  /**
   * 祝日として扱うカレンダー（issue #699）。ここに入っている予定は、カレンダー画面の
   * 終日の並びで他の予定より上に表示される。
   */
  holidayCalendarIds: string[];
  /** 移動の既定値（docs/spec.md §29）。予定から移動を足すときの初期値に使う。 */
  travelSettings: TravelSettings;
  /** 勤務記録の入力に要るもの（issue #532）。 */
  work: CalendarWorkContext;
  weekStartsOn: number;
  timeZone: string;
  autoRefreshSeconds: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // オフライン中は書き込みを止める（docs/spec.md §21）。ここで判定した結果を、
  // 追加ボタン・ドラッグ・編集への入口すべてへ配って、送る前に断つ。
  const offline = useOffline();
  useReconnectRefresh();

  // オフラインでこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  // ナビからの移動はソフトナビゲーションで、Service Worker が保存できないため。
  useWarmOfflinePage("/calendar");

  // 月・日/3日/週いずれかのデータを取りにいっているか。取得自体は `CalendarBody`
  // 配下（`useCalendarChunks`/`useCalendarRangeData`）の中で起きるが、進行の表示は
  // ヘッダー直下にあるため、`onLoadingChange` 経由でここまで上げてもらう。
  const [windowLoading, setWindowLoading] = useState(false);
  const utils = useMemo(() => createCalendarDateUtils(timeZone), [timeZone]);

  // いま描いている表示形式・日付を、次に開いたときの初期表示として覚える（issue #279）。
  // 覚えるのは「URLに出ている状態」で、開いた直後（サーバーが描いた状態）と、前へ・次へ・
  // スワイプ・表示形式の切り替えのあとがここを通る。月表示のスクロールだけは props が
  // 変わらないため、URLを書き換えている syncMonthUrl の側で覚える。
  useEffect(() => {
    rememberCalendarView(view, anchorKey);
  }, [view, anchorKey]);

  // 日ごとの列・終日エリアは memo で包んであるため、判定に使う集合の参照を保つ。
  // 描くたびに作り直すと、活動記録の有無に関わらず全ての列が描き直しになる。
  const activityCalendars = useMemo(
    () => new Set(activityCalendarIds),
    [activityCalendarIds],
  );

  // 祝日カレンダーの判定も同じ理由でSet化しておく（issue #699）。
  const holidayCalendars = useMemo(() => new Set(holidayCalendarIds), [holidayCalendarIds]);

  // 押した直後に見出しが変わるよう、遷移中は指定した期間を先に表示する。
  const [nav, setNav] = useOptimistic({ view, anchorKey });

  // 連続スクロール中の月は、サーバーの応答を待たずに見出しへ反映する。
  const [scrolledMonth, setScrolledMonth] = useState(anchorKey.slice(0, 7));

  // 画面中央にある週の先頭日。月表示→日表示へ切り替えるとき、この週を起点にする
  // （1日目固定だと、月の途中の週を見ていてもその月の1日目基準のタブへ飛んでしまうため。
  // 上端の週だと、半分だけ見えている週を起点に選んでしまうこともあるため中央を採る）。
  // 読むのは表示形式を切り替える操作の中だけなので、状態にせず ref で持つ。
  // 状態にすると、スクロールで週が変わるたびにカレンダー全体が描き直される。
  const centerWeekRef = useRef(anchorKey);

  // 保持している月の中心。ここを動かすと、前後の月ぶんの並びとデータが張り直される。
  const [monthCenter, setMonthCenter] = useState(anchorKey.slice(0, 7));

  // 月表示の移動はスクロールで行う。同じ月を続けて指しても効くよう、指示に通し番号を付ける。
  // day は特定の日を含む週へ位置合わせしたいときだけ指定する（今日・日表示からの切り替え）。
  // 前へ・次へは行き先の日が決まらないため、月単位のまま指定しない。
  const [scrollTarget, setScrollTarget] = useState<{ month: string; day?: string; nonce: number }>(
    () => ({
      month: anchorKey.slice(0, 7),
      // 今月を開いたときは、今日を含む週を画面中央へ置く（「今日」ボタンと同じ位置）。
      // 月の先頭週を上端に合わせるだけだと、月末の今日が画面の外に出ることがある。
      // 別の月から開いたときは行き先に今日が無いため、従来どおり先頭週を上端にそろえる。
      day:
        anchorKey.slice(0, 7) === utils.todayKey().slice(0, 7) ? utils.todayKey() : undefined,
      nonce: 0,
    }),
  );

  // 月表示の週の並びは、サーバーの anchor ではなく保持中の窓から決まる。
  const monthWeeks = useMemo(
    () => getContinuousMonthWeeks(parseMonthKey(monthCenter), weekStartsOn).weeks,
    [monthCenter, weekStartsOn],
  );

  /*
   * スクロールできる範囲。保持している窓よりずっと広く取り、窓の外側は日付を並べない余白にする。
   *
   * 窓を張り直すたびに並びの長さが変わると、その上にあった週の位置も動き、見ていた場所へ
   * scrollTop を書き戻さなければならない。書き戻しは指でなぞっている最中には効かず、
   * 効かないまま週だけが増えると数ヶ月ぶん飛ぶ。余白で長さを固定しておけば、窓の張り直しは
   * 位置に影響しないため、スクロールの最中でも張り直せる（＝止まらずに読み込みが続く）。
   *
   * 起点を動かすのは位置合わせの指示があったときだけ。そのときは絶対位置で合わせ直す。
   */
  const virtual = useMemo(
    () =>
      getContinuousMonthSpan(
        parseMonthKey(scrollTarget.month),
        weekStartsOn,
        VIRTUAL_MONTHS_AROUND,
      ),
    [scrollTarget.month, weekStartsOn],
  );

  // iOS共有拡張から「予定に紐づけて追加」で渡された移動。紐づけ先の予定を選ぶ間だけ持つ（issue #1128）。
  const [sharedLink, setSharedLink] = useState<{
    origin: string;
    destination: string;
    mode: TravelMode;
    departAt: string;
    arriveAt: string;
    note: string;
  } | null>(null);

  // 画面に出しうる月と、サーバーが描いてよこした月。前者に足りないぶんをAPIから足す。
  const windowMonths = useMemo(() => monthsOfWeeks(monthWeeks), [monthWeeks]);
  const serverMonths = useMemo(() => monthsOfWeeks(weeks), [weeks]);

  // 予定・タスク・日付リマインドの入力。追加では作れる種類ぶんを渡し、
  // どれを作るかを開いてから選べるようにする（docs/spec.md §15）。
  const [itemDialog, setItemDialog] = useState<{
    initialKind: ItemKind;
    drafts: ItemDrafts;
  } | null>(null);
  // 空いているところを押したときの簡易入力。詳細な項目は「詳細」から入力画面へ引き継ぐ。
  const [quickDraft, setQuickDraft] = useState<QuickEventDraft | null>(null);
  // クリックした直後は表示専用画面を開く。編集アイコンを押したときだけ draft へ切り替える。
  const [viewingEvent, setViewingEvent] = useState<CalendarEventItem | null>(null);
  const [viewingTask, setViewingTask] = useState<TaskItem | null>(null);
  const [viewingReminder, setViewingReminder] = useState<ReminderItem | null>(null);
  const [viewingTravel, setViewingTravel] = useState<TravelItem | null>(null);
  // タスクを紐づける相手の予定（docs/spec.md §31）。予定の詳細から開く。
  const [linkingEvent, setLinkingEvent] = useState<CalendarEventItem | null>(null);

  // キーボードショートカット一覧（issue #635）。`?` キーとヘッダーのアイコンの両方から開く。
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // 「今日」を押すたびに増やし、時間グリッドが現在時刻を縦の中央へ合わせる契機にする（issue #1020）。
  const [centerNowRequest, setCenterNowRequest] = useState(0);

  /**
   * 記録中の帯を押したとき。開始・停止は記録の画面で行う（docs/spec.md §27）。
   * カレンダーに出しているのは、まだ予定になっていないぶんの表示だけ。
   */
  const openActivity = () => {
    startTransition(() => router.push("/activity"));
  };

  // iOS共有拡張から渡された場所・経路（issue #1083）。マウント時に1回だけ読み、
  // 予定・移動の入力を開く。クエリは検証し、読んだらURLから外して再読み込みで再度開かないようにする。
  useEffect(() => {
    // 同期でsetStateしない（react-hooks/set-state-in-effect）。StrictModeの再実行でも、
    // 解析とURLの掃除をタイマー内で行うため、取り消された1回目に読み取りを奪われない。
    const timer = setTimeout(() => {
    const handoff = parseShareHandoff(window.location.search);
    const failed = !handoff && hasHandoffQuery(window.location.search);
    if (!handoff && !failed) return;

    const url = new URL(window.location.href);
    for (const key of HANDOFF_QUERY_KEYS) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url.toString());
    if (!handoff) {
      // 月表示だけが黙って開く状態にしない（issue #1143）
      window.alert("共有内容を読み取れませんでした。共有元のアプリからもう一度共有してください。");
      return;
    }

    const date = utils.todayKey();
    if (handoff.kind === "place") {
      const draft = toQuickEventDraft(date, DEFAULT_START_MINUTES);
      setItemDialog({
        initialKind: "event",
        drafts: {
          event: {
            allDay: false,
            start: `${draft.date}T${draft.startTime}`,
            end: `${draft.date}T${draft.endTime}`,
            title: handoff.title || undefined,
            location: handoffLocationText(handoff) || undefined,
            description: handoff.url ?? undefined,
          },
        },
      });
      return;
    }
    if (handoff.link) {
      setSharedLink({ origin: handoff.origin, destination: handoff.destination, mode: handoff.mode, ...handoff.link });
      return;
    }
    const start = toQuickEventDraft(date, DEFAULT_START_MINUTES);
    const departAt = `${start.date}T${start.startTime}`;
    const minutes = handoff.minutes ?? 30;
    const arrive = new Date(new Date(`${departAt}:00Z`).getTime() + minutes * 60_000).toISOString().slice(0, 16);
    setItemDialog({
      initialKind: "travel",
      drafts: {
        travel: {
          origin: handoff.origin,
          destination: handoff.destination,
          mode: handoff.mode,
          departAt,
          arriveAt: arrive,
        },
      },
    });
      }, 0);
    return () => clearTimeout(timer);
  }, [utils]);

  /** 紐づけ先の予定を選んだら、予定の日へ寄せた発着時刻で移動の入力を開く（issue #1128）。 */
  const openSharedTravel = (item: PickedItem) => {
    const link = sharedLink;
    if (!link) return;
    setSharedLink(null);
    const sharedDepart = isoToLocalInput(link.departAt, timeZone);
    const sharedArrive = isoToLocalInput(link.arriveAt, timeZone);
    const times = linkedTravelTimes(isoToLocalInput(item.start, timeZone), sharedDepart, sharedArrive);
    const dateDiffers = sharedArrive.slice(0, 10) !== times.arriveAt.slice(0, 10);
    const notice = [
      dateDiffers ? "共有の検索日と予定の日が違うため、日付は予定の日に合わせ、時刻だけ取り込みました（メモは共有された検索結果のままです）。" : null,
      // メモを渡せなかった（旧拡張など）ときだけ、手動で補う案内を残す
      link.note ? null : "経路の詳細は、下のメモへ貼り付けて追加できます。",
    ]
      .filter(Boolean)
      .join("");
    setItemDialog({
      initialKind: "travel",
      drafts: {
        travel: {
          origin: link.origin,
          destination: link.destination,
          mode: link.mode,
          departAt: times.departAt,
          arriveAt: times.arriveAt,
          note: link.note || undefined,
          linkedEvent: { id: item.eventId, calendarId: item.calendarId, startAt: item.start, endAt: item.end },
          notice,
        },
      },
    });
  };

  const closeDialogs = () => {
    setItemDialog(null);
    setQuickDraft(null);
    setViewingEvent(null);
    setViewingTask(null);
    setViewingReminder(null);
    setViewingTravel(null);
    setLinkingEvent(null);
    setSharedLink(null);
  };

  /**
   * `CalendarBody` 側の `data.invalidate` を、ヘッダー・ドラッグなど外側の操作からも
   * 呼べるようにする（issue #697）。`dataPromise` はマウント時点の1回しか消費しないため、
   * 明示的な再取得（再取得ボタン・ドラッグ確定後の同期）はこちらを経由する必要がある。
   */
  const invalidateDataRef = useRef<(() => void) | null>(null);
  const registerInvalidate = useCallback((fn: (() => void) | null) => {
    invalidateDataRef.current = fn;
  }, []);

  /**
   * 再取得ボタン・キーボードショートカット（`r`）。カレンダーのデータは `invalidate` で
   * 即座に取り直し、それ以外のサーバー由来の値（記録中の活動・移動の既定値など）は
   * 従来どおり `router.refresh()` でまとめて取り直す。
   */
  const refreshAll = () => {
    invalidateDataRef.current?.();
    startTransition(() => router.refresh());
  };

  const [dragError, setDragError] = useState<string | null>(null);

  /**
   * 取り直しを待たずに画面へ重ねる予定の変更（issue #787・optimistic-events.ts）。
   *
   * ドラッグ（この `CalendarShell`）と入力ダイアログ（`CalendarBody`）の両方から積むため、
   * こちらに持つ。どれを重ね続けるか（まだ取り直しで確かめられていないか）は、データを持つ
   * `CalendarBody` が描くたびに決める。確かめられた操作は重ねなくなるだけで、配列からは
   * 上限（OPTIMISTIC_EVENT_TTL_MS）が来たときに外す。
   */
  const [optimisticOps, setOptimisticOps] = useState<OptimisticEventOp[]>([]);
  const optimisticSeqRef = useRef(0);

  /**
   * 変更を積む。`settled` が false のときは、書き込みの結果が出るまで確かめたことにしない
   * （`savedAt` を無限大にしておき、`settleOptimisticEvent` で成否を決める）。ドラッグは離した
   * 瞬間から動かした位置に描きたいが、その時点ではまだGoogleへ書けていないため。
   */
  const addOptimisticEvent = useCallback((change: OptimisticEventChange, settled = true) => {
    const seq = ++optimisticSeqRef.current;
    const savedAt = settled ? Date.now() : Number.POSITIVE_INFINITY;
    setOptimisticOps((prev) => [...prev, { ...change, seq, savedAt }]);
    setTimeout(
      () => setOptimisticOps((prev) => prev.filter((op) => op.seq !== seq)),
      OPTIMISTIC_EVENT_TTL_MS,
    );
    return seq;
  }, []);

  /** 書き込みの成否が出たとき。失敗したら重ねるのをやめ、元の位置へ戻す。 */
  const settleOptimisticEvent = useCallback((seq: number, ok: boolean) => {
    const savedAt = Date.now();
    setOptimisticOps((prev) =>
      ok
        ? prev.map((op) => (op.seq === seq ? { ...op, savedAt } : op))
        : prev.filter((op) => op.seq !== seq),
    );
  }, []);

  /**
   * ドラッグで変わった時刻を保存する。失敗しても画面の見た目は元へ戻す（再取得する）ので、
   * 保存できたつもりのまま作業が進まないようにする。
   */
  const commitDrag = async (commit: DragCommit) => {
    setDragError(null);

    // ドラッグ自体もオフラインでは始まらないようにしてあるが、通信が落ちるのは操作の途中でも
    // 起こる。送る直前でもう一度見て、保存できたつもりのまま画面だけ動くことを防ぐ。
    if (offline) {
      setDragError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    const startIso = localInputToIso(dateKeyPlusMinutes(commit.dayKey, commit.startMinutes), timeZone);
    // 離した位置に、書き込みの結果を待たずに描く（issue #787）。失敗したら元へ戻す。
    let optimisticSeq: number | null = null;
    let saved = false;

    try {
      let response: Response;

      if (commit.target.kind === "event") {
        const event = commit.target.item;
        const payload = {
          calendarId: event.calendarId,
          title: event.title,
          allDay: false,
          start: startIso,
          end: localInputToIso(dateKeyPlusMinutes(commit.dayKey, commit.endMinutes), timeZone),
        };
        optimisticSeq = addOptimisticEvent(
          {
            type: "upsert",
            item: buildOptimisticEvent(payload, event.id, [], event),
            ranges: [
              { start: event.start, end: event.end },
              { start: payload.start, end: payload.end },
            ],
          },
          false,
        );
        response = await fetch(`/api/events/${encodeURIComponent(event.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        // 掴んだのが期限の枠か予定日の枠かで、書き換える日付が違う。
        response = await fetch(`/api/tasks/${encodeURIComponent(commit.target.item.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [commit.target.field]: startIso }),
        });
      }

      saved = response.ok;
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setDragError(body?.message ?? "変更を保存できませんでした。");
      }
    } catch {
      setDragError("変更を保存できませんでした。");
    } finally {
      if (optimisticSeq !== null) settleOptimisticEvent(optimisticSeq, saved);
      // ページ全体を router.refresh() で描き直さず、カレンダーのデータだけを取り直す
      // （issue #697）。動かした予定・タスクのぶんだけでなく表示中の期間すべてを対象にする
      // （ドラッグの成否によらず、見えている範囲全体をサーバーの真の状態へそろえるため）。
      invalidateDataRef.current?.();
    }
  };

  /** 終日エリアのドラッグ。動かせるのは日付だけなので、日数分ずらして保存する。 */
  const commitAllDayDrag = async (commit: AllDayDragCommit) => {
    setDragError(null);

    if (offline) {
      setDragError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    let optimisticSeq: number | null = null;
    let saved = false;

    try {
      let response: Response;

      if (commit.target.kind === "event") {
        const event = commit.target.item;
        const payload = {
          calendarId: event.calendarId,
          title: event.title,
          allDay: true,
          start: shiftDateKey(event.start, commit.deltaDays),
          end: shiftDateKey(event.end, commit.deltaDays),
        };
        optimisticSeq = addOptimisticEvent(
          {
            type: "upsert",
            item: buildOptimisticEvent(payload, event.id, [], event),
            ranges: [
              { start: event.start, end: event.end },
              { start: payload.start, end: payload.end },
            ],
          },
          false,
        );
        response = await fetch(`/api/events/${encodeURIComponent(event.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        response = await fetch(`/api/tasks/${encodeURIComponent(commit.target.item.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [commit.target.field]: commit.dayKey }),
        });
      }

      saved = response.ok;
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setDragError(body?.message ?? "変更を保存できませんでした。");
      }
    } catch {
      setDragError("変更を保存できませんでした。");
    } finally {
      if (optimisticSeq !== null) settleOptimisticEvent(optimisticSeq, saved);
      // ページ全体を router.refresh() で描き直さず、カレンダーのデータだけを取り直す
      // （issue #697）。動かした予定・タスクのぶんだけでなく表示中の期間すべてを対象にする
      // （ドラッグの成否によらず、見えている範囲全体をサーバーの真の状態へそろえるため）。
      invalidateDataRef.current?.();
    }
  };

  const openEvent = (event: CalendarEventItem) => setViewingEvent(event);

  const editEvent = (event: CalendarEventItem) => {
    if (offline) return;
    setViewingEvent(null);
    setItemDialog({ initialKind: "event", drafts: { event: toEventDraft(event, timeZone) } });
  };

  const duplicateEvent = (event: CalendarEventItem) => {
    if (offline) return;
    setViewingEvent(null);
    setItemDialog({
      initialKind: "event",
      drafts: { event: duplicateEventDraft(event, timeZone) },
    });
  };

  const editTask = (task: TaskItem) => {
    if (offline) return;
    setViewingTask(null);
    setItemDialog({ initialKind: "task", drafts: { task: toTaskDraft(task, timeZone) } });
  };

  const editReminder = (reminder: ReminderItem) => {
    if (offline) return;
    setViewingReminder(null);
    setItemDialog({
      initialKind: "reminder",
      drafts: { reminder: toReminderDraft(reminder, timeZone) },
    });
  };

  // 月表示ではスクロール位置が、それ以外では選択中の期間が見出しになる。
  const headerLabel =
    nav.view === "month"
      ? formatMonthLabel(scrolledMonth)
      : formatRangeLabel(
          nav.view,
          nav.anchorKey,
          getVisibleDays(nav.view, parseDateKey(nav.anchorKey), weekStartsOn).days,
        );
  const openTask = (task: TaskItem) => setViewingTask(task);
  const openReminder = (reminder: ReminderItem) => setViewingReminder(reminder);
  const openTravel = (travel: TravelItem) => setViewingTravel(travel);

  /**
   * 予定の表示画面から、その予定に紐づく移動へ移る（issue #327）。
   *
   * 移動は時間グリッドでは予定の背面に置くため、時間が丸ごと重なると押せない。
   * 予定の側からたどれば、画面のどこに何が乗っているかに関係なく開ける。
   */
  const openTravelFromEvent = (travel: TravelItem) => {
    setViewingEvent(null);
    setViewingTravel(travel);
  };

  /**
   * 予定の表示画面から、その予定に紐づくタスクへ移る（issue #835）。
   *
   * 移動と同じく、画面のどこに何が乗っているかに関係なく、予定の側からたどれるようにする。
   */
  const openTaskFromEvent = (task: TaskItem) => {
    setViewingEvent(null);
    setViewingTravel(null);
    setViewingTask(task);
  };

  const editTravel = (travel: TravelItem) => {
    if (offline) return;
    setViewingTravel(null);
    setItemDialog({ initialKind: "travel", drafts: { travel: toTravelDraft(travel, timeZone) } });
  };

  /**
   * 予定から移動を足す（docs/spec.md §29）。
   *
   * 目的地はその予定の場所、到着時刻は予定の開始時刻を初期値にする。出発地は設定の既定の
   * 出発地（自宅など）から入れる。押した時点では所要時間が分からないが、出発と到着を同じ時刻に
   * すると開いた瞬間に「到着が出発より後になるように」と出る。仮の長さを置いてから、
   * Googleマップの共有経路URLを貼るか、手入力で直してもらう。
   */
  const addTravelForEvent = (event: CalendarEventItem) => {
    if (offline) return;
    setViewingEvent(null);
    setItemDialog({
      initialKind: "travel",
      drafts: {
        travel: {
          origin: travelSettings.defaultOrigin ?? "",
          destination: event.location ?? "",
          mode: travelSettings.defaultMode,
          departAt: isoToLocalInput(
            new Date(new Date(event.start).getTime() - DEFAULT_TRAVEL_MINUTES * 60_000).toISOString(),
            timeZone,
          ),
          arriveAt: isoToLocalInput(event.start, timeZone),
          linkedEvent: { id: event.id, calendarId: event.calendarId, startAt: event.start, endAt: event.end },
        },
      },
    });
  };

  /** 予定の詳細から、この予定にタスクを紐づける（docs/spec.md §31）。 */
  const linkTaskForEvent = (event: CalendarEventItem) => {
    if (offline) return;
    setViewingEvent(null);
    setLinkingEvent(event);
  };

  /**
   * 紐づけダイアログから「新しいタスクを作る」。入力画面を紐づけ先つきで開く。
   * 行き先の日付はタスクを作ったあとの紐づけで入るため、ここでは未設定のままにする。
   */
  const createTaskForEvent = (
    event: CalendarEventItem,
    stage: TaskEventStage,
    target: TaskLinkTarget,
  ) => {
    if (offline) return;
    setViewingEvent(null);
    setLinkingEvent(null);
    setItemDialog({
      initialKind: "task",
      drafts: {
        task: {
          dueMode: "none",
          due: "",
          linkTo: {
            calendarId: event.calendarId,
            eventId: event.id,
            eventTitle: event.title,
            stage,
            target,
          },
        },
      },
    });
  };

  /** 移動の詳細から「新しいタスクを作る」。入力画面を移動への紐づけつきで開く（issue #1079）。 */
  const createTaskForTravel = (
    travel: TravelItem,
    stage: TaskEventStage,
    target: TaskLinkTarget,
  ) => {
    if (offline) return;
    setViewingTravel(null);
    setItemDialog({
      initialKind: "task",
      drafts: {
        task: {
          dueMode: "none",
          due: "",
          linkTo: {
            calendarId: "",
            eventId: "",
            travelId: travel.id,
            eventTitle: travel.title,
            stage,
            target,
          },
        },
      },
    });
  };

  /** 新規作成の初期値。指定の日時から1時間ぶんで開く。 */
  const newEventDraft = (dateKey: string, minutes: number): EventDraft => ({
    allDay: false,
    start: dateKeyPlusMinutes(dateKey, minutes),
    end: dateKeyPlusMinutes(dateKey, Math.min(minutes + 60, 23 * 60 + 30)),
  });

  /**
   * 予定の入力から、予定に紐づかない移動の入力へ移る（issue #895）。
   *
   * 保存先に移動カレンダーを選び直した入力に出る入口から呼ばれる。日時は入力中の値
   * （時刻あり）をそのまま出発・到着の初期値にし、乗換案内の貼り付けで上書きされる。
   * 予定が無いので復路は作らない。
   */
  const openStandaloneTravel = (range: { start: string; end: string }) => {
    if (offline) return;
    setQuickDraft(null);
    setItemDialog({
      initialKind: "travel",
      drafts: {
        travel: {
          origin: travelSettings.defaultOrigin ?? "",
          destination: "",
          mode: travelSettings.defaultMode,
          departAt: range.start,
          arriveAt: range.end,
        },
      },
    });
  };

  /** 簡易入力から通常の入力画面へ移る。入力済みの値はそのまま引き継ぐ。 */
  const openEventForm = (draft: EventDraft) => {
    setQuickDraft(null);
    setItemDialog({ initialKind: "event", drafts: { event: draft } });
  };

  const navigate = (nextView: CalendarView, nextAnchorKey: string) => {
    startTransition(() => {
      setNav({ view: nextView, anchorKey: nextAnchorKey });
      router.push(`/calendar?view=${nextView}&date=${nextAnchorKey}`);
    });
  };

  /**
   * 月表示の移動。読み込み済みの範囲の中なら、サーバーへ行かずスクロールするだけで済む。
   * 窓の外へ出る場合も、先に並びを張り直してから足りない月だけを取りにいく。
   */
  const goToMonth = (month: string, day?: string) => {
    setScrolledMonth(month);
    setMonthCenter(month);
    setScrollTarget((prev) => ({ month, day, nonce: prev.nonce + 1 }));
  };

  /**
   * 日表示から月表示へ切り替えるとき。その日を含む週へ位置合わせしてから遷移する。
   * 何もしないと、以前に月表示を見ていたときの位置（またはマウント時点の初期値）へ
   * スクロールが戻ってしまう。
   */
  const enterMonthView = (dateKey: string) => {
    const month = dateKey.slice(0, 7);
    setScrolledMonth(month);
    setMonthCenter(month);
    setScrollTarget((prev) => ({ month, day: dateKey, nonce: prev.nonce + 1 }));
    navigate("month", dateKey);
  };

  const move = (direction: 1 | -1) => {
    if (nav.view === "month") {
      goToMonth(shiftMonthKey(scrolledMonth, direction));
      return;
    }

    navigate(nav.view, toDateKey(shiftAnchor(nav.view, parseDateKey(nav.anchorKey), direction)));
  };

  /**
   * スワイプでの移動。前へ・次へと違い、期間ではなく日数で動かす。
   * 3日ずつしか動けないと、今日を真ん中に置くような見方に切り替えられないため。
   */
  const moveDays = (deltaDays: number) => {
    navigate(nav.view, toDateKey(addDays(parseDateKey(nav.anchorKey), deltaDays)));
  };

  const goToday = () => {
    if (nav.view === "month") {
      // 月の先頭週ではなく今日を含む週へ合わせる。月の先頭週に合わせると、今日が月の
      // どこにあるかで今日の週が何行目に来るかが変わり、日表示からの切り替え
      // （enterMonthView）とも位置がずれるため。
      const todayKey = utils.todayKey();
      goToMonth(todayKey.slice(0, 7), todayKey);
      return;
    }

    setCenterNowRequest((count) => count + 1);
    navigate(nav.view, utils.todayKey());
  };

  /** スクロールで見えている月が変わったとき。 */
  const handleVisibleMonthChange = (month: string) => {
    setScrolledMonth(month);

    // 窓の端へ近づいたら中心をずらし、先の月を前もって取りにいく。
    // 1ヶ月ごとにずらすと週の並びを組み直す回数が増えるため、2ヶ月離れてから動かす。
    // 張り直しても各週の位置は動かないため、スクロールの最中でも行ってよい。
    if (Math.abs(monthDistance(monthCenter, month)) >= 2) setMonthCenter(month);
  };

  /**
   * 月表示で見ている月をURLへ反映する（issue #848）。
   *
   * `history.replaceState` は Next.js の App Router にパッチされており、呼ぶと `ACTION_RESTORE`
   * が dispatch される。action queue は RESTORE を受けると保留中の action（`router.push` /
   * `router.refresh`）を破棄するため、回線が遅く1日・3日表示→月表示の `router.push` が応答を
   * 待っている間に月表示のスクロール通知からここが走ると、月表示への遷移そのものが捨てられる。
   * 遷移が終わると `nav`（useOptimistic）はサーバーの props（元の表示形式）へ戻り、URLだけ
   * `view=month` のまま画面は元の表示へ戻っていた。
   *
   * そのため、このシェルの transition（`navigate`・`refreshAll`・`openActivity`）が保留中の間は
   * 書き換えず、明けてから見ている月で1回だけ反映する。見出し（`scrolledMonth`）と先読み
   * （`monthCenter`）は従来どおり即時に動かす。なお別の `useTransition` で走る `router.refresh()`
   * （`useReconnectRefresh`・`useRunningActivityStop`）はこのガードの対象外で、保留中にスクロール
   * すると取り直しが捨てられうる（表示形式が戻る症状とは別のため、ここでは扱っていない）。
   */
  useEffect(() => {
    if (pending || nav.view !== "month") return;
    syncMonthUrl(scrolledMonth);
  }, [pending, nav.view, scrolledMonth]);

  /** スクロールで画面中央に来た週が変わったとき。 */
  const handleVisibleWeekChange = (weekKey: string) => {
    centerWeekRef.current = weekKey;
  };

  /**
   * 時間グリッドに並べる日。
   *
   * サーバーが渡してきた期間ではなく、押した直後に更新される nav（楽観値）を起点にする。
   * 前へ・次へ・スワイプだけでなく、表示形式そのものの切り替え（1日⇔3日⇔週）も含めて、
   * サーバーの応答（RSC往復・外部APIの取得）を待たずにその場で正しい日数へ切り替わる
   * 必要があるため（issue #697）。月表示では使わないので `days`（サーバー初期値）のままでよい。
   */
  const gridDays = useMemo(() => {
    if (nav.view === "month") return days;
    return getVisibleDays(nav.view, parseDateKey(nav.anchorKey), weekStartsOn).days;
  }, [nav.view, nav.anchorKey, weekStartsOn, days]);

  // 予定を追加するときの既定の日。月表示は広い範囲を並べているため、先頭の日ではなく今日を使う。
  // nav（楽観値）で判定するのは、表示形式の切り替え中でも正しい方を指すようにするため。
  const defaultDayKey = nav.view === "month" ? utils.todayKey() : gridDays[0];

  /** 右下の「＋」からの追加。予定の入力を下から開く（種類の切り替えは持たない・issue #729）。 */
  const openAdd = (available: Record<AddableKind, boolean>) => {
    if (!available.event) return;
    setItemDialog({
      initialKind: "event",
      drafts: { event: newEventDraft(defaultDayKey, DEFAULT_START_MINUTES) },
    });
  };

  // 表示形式を切り替えたときの移動先。月表示はスクロールで移動するため anchorKey が
  // 更新されない（URLだけが replaceState で追従する）。見えている週を起点にする。
  const viewSwitchAnchorKey = () => (nav.view === "month" ? centerWeekRef.current : anchorKey);

  /**
   * 月表示から3日・1日表示へ切り替えるときの日。中央の週の先頭日をそのまま使うと、
   * 3日表示の初日・1日表示の日が週の先頭の曜日（例: 日曜）に固定されてしまう。
   * 今日と同じ曜日の日を中央の週から選び、切り替えても見ている曜日の感覚がずれないようにする。
   */
  const viewSwitchDayAnchorKey = () => {
    const weekStart = parseDateKey(centerWeekRef.current);
    const offset = (parseDateKey(utils.todayKey()).getUTCDay() - weekStartsOn + 7) % 7;
    return toDateKey(addDays(weekStart, offset));
  };

  /**
   * 表示形式の切り替え。セグメンテッドボタンの押下とキーボードショートカット（issue #635）の
   * 両方から呼ぶため、月表示への特別な分岐を含めてここへまとめている。
   */
  const switchView = (view: CalendarView) => {
    if (view === "month") {
      // 月表示のまま押しても、以前の位置合わせを乱さないよう何もしない。
      if (nav.view !== "month") enterMonthView(viewSwitchAnchorKey());
      return;
    }

    if (nav.view === "month" && view !== "day7") {
      navigate(view, viewSwitchDayAnchorKey());
      return;
    }

    navigate(view, viewSwitchAnchorKey());
  };

  return (
    <AppFrame
      current="calendar"
      activityRunning={initialRunningActivity !== null}
      running={initialRunningActivity}
    >
      <header className="flex items-center gap-1 bg-surface-container-low px-1 py-1.5 md:gap-2 md:px-2 md:py-2 md:max-lg:flex-wrap md:max-lg:justify-end">
        {/* 768px未満は左上をメニューにする（issue #328・#463）。768px以上は左端のサイドバーから
            画面を移る（issue #636）。 */}
        <AppMenuButton current="calendar" activityRunning={initialRunningActivity !== null} />

        {/*
          アイコンはPCだけに出す。他の画面（タスク・日付リマインド）も同じ位置にアイコンがあり、
          カレンダーだけ日付から始まると、同じアプリの中で先頭の位置が揃わないため。
          カレンダーアイコンをクリックすると今日の日付に飛ぶ。狭い画面で今日へ戻る操作は、
          下部ナビの「カレンダー」が同じことをする（issue #175）。
          他の画面と違って画面名を添えないのは、この直後の年月の見出しがその役目を持つため
          （「カレンダー 2026年 8月」と並べても読める情報が増えない）。
        */}
        <Button
          variant="ghost"
          onClick={goToday}
          className="hidden shrink-0 px-2 py-1.5 font-semibold md:flex md:max-lg:size-10"
          aria-label="今日に飛ぶ"
        >
          <CalendarDays className="size-5" />
        </Button>

        {/* スマートフォンはスワイプで移動できるため、年月の表示幅を優先する。 */}
        <div className="hidden items-center md:flex">
          <Button
            variant="ghost"
            size="icon"
            className="size-10 md:size-9 md:max-lg:size-10"
            onClick={() => move(-1)}
            aria-label="前へ"
          >
            <ChevronLeft className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 md:size-9 md:max-lg:size-10"
            onClick={() => move(1)}
            aria-label="次へ"
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>

        {/*
          どの期間を見ているかは常に読めなければならない。他の操作より優先して幅を与える。
          年は控えめに、月日は大きく置く。年号まで同じ大きさで並べると、いま見ている
          月日がその中に埋もれて、目を留めないと読み取れないため。
        */}
        <h1 className="flex min-w-0 flex-1 items-baseline gap-1 md:gap-1.5">
          {headerLabel.year && (
            <span className="type-label-medium md:type-title-small shrink-0 text-on-surface-variant">
              {headerLabel.year}
            </span>
          )}
          <span className="type-title-medium font-bold md:type-headline-small truncate">
            {/*
              狭い画面では月だけに切り替える。日と曜日は列ヘッダーに出ているため、
              ここで繰り返すと入り切らずに truncate され、いま見ている期間そのものが読めなくなる。
              表示中の幅で文字列を選ぶとサーバーとブラウザで結果が変わるため、両方を描いてCSSで隠す。
            */}
            {headerLabel.compact ? (
              <>
                <span className="md:hidden">{headerLabel.compact}</span>
                <span className="hidden md:inline">{headerLabel.main}</span>
              </>
            ) : (
              headerLabel.main
            )}
          </span>
          {headerLabel.weekday && (
            <span
              className={cn(
                "type-label-medium md:type-title-small shrink-0",
                headerLabel.compact && "hidden md:inline",
                headerLabel.weekday.tone ?? "text-on-surface-variant",
              )}
            >
              ({headerLabel.weekday.label})
            </span>
          )}
        </h1>

        {/* iPad縦向きではサイドバーを除くと本文が576pxまで狭まる。期間の見出しを
            操作ボタンに押し潰させず、表示切替を次の段に置く（issue #1049）。 */}
        <span aria-hidden className="hidden md:max-lg:block md:max-lg:basis-full" />

        {/* M3のタップ対象は最低48dp。狭い画面では見た目より当たり判定を優先して高さを取る。 */}
        <Button variant="outline" size="xs" className="h-10 px-3 md:h-8 md:px-4 md:max-lg:h-10" onClick={goToday}>
          今日
        </Button>

        {/* M3のセグメンテッドボタン。排他的な選択であることを、隣接した枠で示す。 */}
        <div className="flex items-center overflow-hidden rounded-full border border-outline">
          {VIEW_LABELS.map((item) => (
            <Button
              key={item.view}
              variant={nav.view === item.view ? "secondary" : "ghost"}
              size="xs"
              className={cn(
                "type-label-medium h-10 rounded-none px-3 active:rounded-none md:type-label-large md:h-8 md:max-lg:h-10",
                nav.view === item.view && "text-on-secondary-container",
                item.desktopOnly && "hidden md:inline-flex",
              )}
              onClick={() => switchView(item.view)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="size-10 md:size-9 md:max-lg:size-10"
          // オフライン中に押しても、再接続まで終わらない読み込みが始まるだけになる。
          // 通信が戻った時点の取り直しは useReconnectRefresh が行う。
          disabled={pending || offline}
          aria-label="再取得"
          onClick={() => startTransition(() => router.refresh())}
        >
          <RefreshCw className="size-5" />
        </Button>

        {/*
          PCのキーボードショートカット（issue #635）。マウス操作が前提のスマートフォンでは
          そもそも押す機会が無いため、ほかのPC限定のボタンと同じく `hidden md:flex` にする。
        */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden size-9 md:flex md:max-lg:size-10"
          aria-label="キーボードショートカット"
          onClick={() => setShortcutsOpen(true)}
        >
          <Keyboard className="size-5" />
        </Button>
        {/* 勤務・場所・設定はヘッダーに置かない（issue #463）。どの画面幅でもドロワーが開くように
            なったため、この帯に3つ並べる理由が無くなった（docs/spec.md §4・§9・§34）。 */}
      </header>

      <LinearProgress active={pending || windowLoading} />

      <OfflineNotice />

      {/*
        グリッドの枠組み（どちらのコンポーネントを、どんな日付/週の並びで描くか）は
        `nav`（useOptimistic の楽観値）だけで決まり、予定・タスクの取得を待たない
        （issue #697）。`CalendarBody` はもう `use()` でPromiseを消費しないため、
        ここをSuspenseで包む必要は無い。取得中かどうかは `onLoadingChange` で
        上のヘッダー直下（LinearProgress）へ伝える。
        なお前へ・次へは startTransition の中で遷移するため、表示中の内容を保った
        まま差し替わる（操作のたびに画面が消えることはない）。
      */}
      {sharedLink && (
        <EventPickerDialog
          timeZone={timeZone}
          weekStartsOn={weekStartsOn}
          kinds="event"
          initialDate={isoToLocalInput(sharedLink.departAt, timeZone).slice(0, 10)}
          title="紐づける予定を選ぶ"
          description="この移動に結ぶ予定を押してください。"
          onCancel={() => setSharedLink(null)}
          onSelect={openSharedTravel}
        />
      )}
      <CalendarBody
        dataPromise={dataPromise}
        tagCatalogPromise={tagCatalogPromise}
        placeCatalogPromise={placeCatalogPromise}
        view={nav.view}
        anchorKey={nav.anchorKey}
        seedView={view}
        seedAnchorKey={anchorKey}
        days={gridDays}
        weeks={nav.view === "month" ? monthWeeks : weeks}
        weekStartsOn={weekStartsOn}
        utils={utils}
        timeZone={timeZone}
        windowMonths={windowMonths}
        serverMonths={serverMonths}
        scrollTarget={scrollTarget}
        autoRefreshSeconds={autoRefreshSeconds}
        offline={offline}
        dragError={dragError}
        itemDialog={itemDialog}
        quickDraft={quickDraft}
        viewingEvent={viewingEvent}
        viewingTask={viewingTask}
        viewingReminder={viewingReminder}
        viewingTravel={viewingTravel}
        linkingEvent={linkingEvent}
        virtual={virtual}
        onVisibleMonthChange={handleVisibleMonthChange}
        onVisibleWeekChange={handleVisibleWeekChange}
        onSwipe={moveDays}
        onSelectDay={(dateKey) => navigate("day1", dateKey)}
        onOpenEvent={openEvent}
        onOpenTask={openTask}
        onOpenReminder={openReminder}
        onOpenTravel={openTravel}
        onOpenTravelForEvent={openTravelFromEvent}
        onOpenTaskForEvent={openTaskFromEvent}
        onEditEvent={editEvent}
        onDuplicateEvent={duplicateEvent}
        onEditTask={editTask}
        onEditReminder={editReminder}
        onEditTravel={editTravel}
        onAddTravelForEvent={addTravelForEvent}
        onLinkTaskForEvent={linkTaskForEvent}
        onCreateTaskForEvent={createTaskForEvent}
        onCreateTaskForTravel={createTaskForTravel}
        onSelectSlot={(dateKey, minutes) => {
          if (offline) return;
          setQuickDraft(toQuickEventDraft(dateKey, minutes));
        }}
        onSelectRange={({ dateKey, startMinutes, endMinutes }) => {
          if (offline) return;
          setQuickDraft(toQuickEventDraft(dateKey, startMinutes, endMinutes));
        }}
        onQuickAddOnDay={(dateKey) => {
          if (offline) return;
          setQuickDraft(toQuickEventDraft(dateKey, DEFAULT_START_MINUTES));
        }}
        onOpenEventForm={openEventForm}
        travelCalendarId={travelSettings.calendarId}
        onOpenStandaloneTravel={openStandaloneTravel}
        onDragCommit={commitDrag}
        onAllDayDragCommit={commitAllDayDrag}
        onAdd={openAdd}
        onCloseDialogs={closeDialogs}
        onRefreshAll={refreshAll}
        registerInvalidate={registerInvalidate}
        optimisticOps={optimisticOps}
        onOptimisticEvent={addOptimisticEvent}
        onLoadingChange={setWindowLoading}
        runningActivity={initialRunningActivity}
        activityCalendars={activityCalendars}
        holidayCalendars={holidayCalendars}
        onOpenActivity={openActivity}
        work={work}
        onGoToday={goToday}
        centerNowRequest={centerNowRequest}
        onMove={move}
        onSwitchView={switchView}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      <RunningActivityBar running={initialRunningActivity} />
      <BottomNav
        current="calendar"
        activityRunning={initialRunningActivity !== null}
        onCalendarClick={goToday}
        // カレンダー画面ではすでにcalendars/timeZoneを持っているため、他画面向けの
        // 自己完結シート（取得を伴う）を使わず、既存のquickDraftへそのまま合流させる。
        // 保存後の再取得も変更範囲だけに絞られた既存のhandleSavedへ乗る。
        onLongPressCalendar={() => {
          if (offline || navigator.onLine === false) return;
          setQuickDraft(toQuickEventDraft(utils.todayKey(), DEFAULT_START_MINUTES));
        }}
      />

      {/* Suspenseの外に置く。取得中でもショートカット一覧はいつでも開けてよいため。 */}
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </AppFrame>
  );
}

/**
 * 見ている月をURLへ反映する。
 * replaceState はサーバーへ行かないため、これ自体では再取得を起こさない
 * （リロードや保存後の再取得のときに、見ていた月が起点になる）。
 */
function syncMonthUrl(month: string) {
  // すでにその月を指しているなら書き換えない。replaceState は Next.js の RESTORE になるため、
  // マウント直後や日表示からの切り替え直後（`date=YYYY-MM-DD` で同じ月）に余分に走らせない。
  // 共有の引き継ぎが未処理のあいだは書き換えない。クエリごと消えて紐づけ画面が開かなくなる（issue #1143）。
  if (hasHandoffQuery(window.location.search)) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "month" && params.get("date")?.slice(0, 7) === month) return;

  window.history.replaceState(null, "", `/calendar?view=month&date=${month}-01`);
  rememberCalendarView("month", `${month}-01`);
}

/** 取得した予定とタスクに依存する部分。ここだけが読み込みを待つ。 */
function CalendarBody({
  dataPromise,
  tagCatalogPromise,
  placeCatalogPromise,
  view,
  anchorKey,
  seedView,
  seedAnchorKey,
  days,
  weeks,
  weekStartsOn,
  utils,
  timeZone,
  windowMonths,
  serverMonths,
  scrollTarget,
  autoRefreshSeconds,
  offline,
  dragError,
  itemDialog,
  quickDraft,
  viewingEvent,
  viewingTask,
  viewingReminder,
  viewingTravel,
  linkingEvent,
  virtual,
  onVisibleMonthChange,
  onVisibleWeekChange,
  onSwipe,
  onSelectDay,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
  onOpenTravel,
  onOpenTravelForEvent,
  onOpenTaskForEvent,
  onEditEvent,
  onDuplicateEvent,
  onEditTask,
  onEditReminder,
  onEditTravel,
  onAddTravelForEvent,
  onLinkTaskForEvent,
  onCreateTaskForEvent,
  onCreateTaskForTravel,
  onSelectSlot,
  onSelectRange,
  onQuickAddOnDay,
  onOpenEventForm,
  travelCalendarId,
  onOpenStandaloneTravel,
  onDragCommit,
  onAllDayDragCommit,
  onAdd,
  onCloseDialogs,
  onRefreshAll,
  registerInvalidate,
  optimisticOps,
  onOptimisticEvent,
  onLoadingChange,
  runningActivity,
  activityCalendars,
  holidayCalendars,
  onOpenActivity,
  work,
  onGoToday,
  centerNowRequest,
  onMove,
  onSwitchView,
  onOpenShortcuts,
}: {
  /**
   * サーバーが最初に描いた応答。ここでは最初の1回（マウント時点のもの）だけを種として使い、
   * 以後の表示形式・日付の切り替えで作られる新しい Promise は待たない（issue #697）。
   */
  dataPromise: Promise<CalendarLoadResult>;
  tagCatalogPromise: Promise<TagCatalog>;
  placeCatalogPromise: Promise<PlaceCatalog>;
  /** いま表示すべき形式。押した直後に更新される nav（楽観値）で、サーバーの応答を待たない。 */
  view: CalendarView;
  /** いま表示すべき起点の日。view と同じく nav（楽観値）。 */
  anchorKey: string;
  /** dataPromise が対応する表示形式・日付（マウント時点のサーバー確定値）。 */
  seedView: CalendarView;
  seedAnchorKey: string;
  days: string[];
  weeks: string[][];
  weekStartsOn: number;
  utils: CalendarDateUtils;
  timeZone: string;
  windowMonths: string[];
  serverMonths: string[];
  scrollTarget: { month: string; day?: string; nonce: number };
  autoRefreshSeconds: number;
  offline: boolean;
  dragError: string | null;
  itemDialog: { initialKind: ItemKind; drafts: ItemDrafts } | null;
  quickDraft: QuickEventDraft | null;
  viewingEvent: CalendarEventItem | null;
  viewingTask: TaskItem | null;
  viewingReminder: ReminderItem | null;
  viewingTravel: TravelItem | null;
  /** タスクを紐づける相手の予定（docs/spec.md §31）。 */
  linkingEvent: CalendarEventItem | null;
  virtual: { firstWeekKey: string; weekCount: number };
  onVisibleMonthChange: (monthKey: string) => void;
  onVisibleWeekChange: (weekKey: string) => void;
  onSwipe: (deltaDays: number) => void;
  onSelectDay: (dateKey: string) => void;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
  onOpenTravel: (travel: TravelItem) => void;
  /** 予定の表示画面から、その予定に紐づく移動を開く（issue #327）。 */
  onOpenTravelForEvent: (travel: TravelItem) => void;
  /** 予定の表示画面から、その予定に紐づくタスクを開く（issue #835）。 */
  onOpenTaskForEvent: (task: TaskItem) => void;
  onEditEvent: (event: CalendarEventItem) => void;
  onDuplicateEvent: (event: CalendarEventItem) => void;
  onEditTask: (task: TaskItem) => void;
  onEditReminder: (reminder: ReminderItem) => void;
  onEditTravel: (travel: TravelItem) => void;
  /** 予定の詳細から移動を足す。目的地・到着時刻はその予定から埋める。 */
  onAddTravelForEvent: (event: CalendarEventItem) => void;
  /** 予定の詳細からタスクを紐づける（docs/spec.md §31）。 */
  onLinkTaskForEvent: (event: CalendarEventItem) => void;
  /** 紐づけダイアログから、紐づけた状態のタスクを新しく作る。 */
  onCreateTaskForTravel: (
    travel: TravelItem,
    stage: TaskEventStage,
    target: TaskLinkTarget,
  ) => void;
  onCreateTaskForEvent: (
    event: CalendarEventItem,
    stage: TaskEventStage,
    target: TaskLinkTarget,
  ) => void;
  onSelectSlot: (dateKey: string, minutes: number) => void;
  onSelectRange: (commit: SlotRangeCommit) => void;
  onQuickAddOnDay: (dateKey: string) => void;
  onOpenEventForm: (draft: EventDraft) => void;
  travelCalendarId: string | null;
  onOpenStandaloneTravel: (range: { start: string; end: string }) => void;
  onDragCommit: (commit: DragCommit) => void;
  onAllDayDragCommit: (commit: AllDayDragCommit) => void;
  /** 右下の「＋」。作れる種類を渡し、ひな型は呼び出し側で作る。 */
  onAdd: (available: Record<AddableKind, boolean>) => void;
  onCloseDialogs: () => void;
  onRefreshAll: () => void;
  /**
   * 外側（ヘッダーの再取得ボタン・ドラッグ確定後の同期）から `data.invalidate` を
   * 呼べるようにするための登録。`dataPromise` はマウント時点の1回しか消費しないため
   * （issue #697）、明示的な再取得はこの経路を経由する。
   */
  registerInvalidate: (fn: (() => void) | null) => void;
  /** 取り直しを待たずに重ねる予定の変更（issue #787）。 */
  optimisticOps: readonly OptimisticEventOp[];
  onOptimisticEvent: (change: OptimisticEventChange) => void;
  onLoadingChange: (loading: boolean) => void;
  runningActivity: RunningActivityItem | null;
  /** 活動記録の保存先に選ばれているカレンダー（issue #241）。 */
  activityCalendars: ReadonlySet<string>;
  /** 祝日として扱うカレンダー（issue #699）。終日の並びで他の予定より上に表示する。 */
  holidayCalendars: ReadonlySet<string>;
  /** 記録中の帯を押したとき。開始・停止は記録の画面で行う。 */
  onOpenActivity: () => void;
  /** 勤務記録の入力に要るもの（issue #532）。 */
  work: CalendarWorkContext;
  /** キーボードショートカット（issue #635）。 */
  onGoToday: () => void;
  centerNowRequest: number;
  onMove: (direction: 1 | -1) => void;
  onSwitchView: (view: CalendarView) => void;
  onOpenShortcuts: () => void;
}) {
  /**
   * タグ・場所は表示形式・日付が変わっても内容が変わらない（issue #697）。マウント時点の
   * Promise だけを消費し、表示形式を切り替えるたびに作られる新しい Promise（Notionへの
   * 無駄な再取得）は無視する。取得できるまでは空のカタログを出す。
   */
  const [seedTagPromise] = useState(() => tagCatalogPromise);
  const [seedPlacePromise] = useState(() => placeCatalogPromise);
  const [tagCatalog, setTagCatalog] = useState<TagCatalog>(EMPTY_TAG_CATALOG);
  const [placeCatalog, setPlaceCatalog] = useState<PlaceCatalog>(EMPTY_PLACE_CATALOG);

  useEffect(() => {
    let cancelled = false;

    seedTagPromise.then((catalog) => {
      if (!cancelled) setTagCatalog(catalog);
    });
    seedPlacePromise.then((catalog) => {
      if (!cancelled) setPlaceCatalog(catalog);
    });

    return () => {
      cancelled = true;
    };
  }, [seedTagPromise, seedPlacePromise]);

  // 月表示は前後の月ぶんを、それ以外はいま表示中の期間ぶんを、それぞれ背景で保持する。
  // どちらも dataPromise（サーバーが最初に描いた応答）はマウント時点の1回だけ種として使い、
  // 表示形式・日付の切り替えでは外部APIの応答を待たない（issue #697）。
  const monthData = useCalendarChunks({
    enabled: view === "month",
    windowMonths,
    dataPromise,
    serverMonths,
    autoRefreshSeconds,
    utils,
    onLoadingChange,
  });
  const rangeData = useCalendarRangeData({
    enabled: view !== "month",
    view,
    anchorKey,
    dataPromise,
    seedView,
    seedAnchorKey,
    autoRefreshSeconds,
    onLoadingChange,
  });

  /**
   * 月表示は月ごとのチャンク、それ以外は表示中の期間1つぶんと、保持の粒度が違うため
   * ここで同じ形にそろえる。invalidate は「変わった期間」を受け取り、月表示では
   * かかる月へ変換し、それ以外ではいま表示中の期間をまるごと取り直す。
   */
  const source = view === "month" ? monthData : rangeData;

  /**
   * 保存・削除・ドラッグのうち、まだ取り直しで確かめられていないものを重ねる（issue #787）。
   * 取り直しを待たずに保存した予定を出し、遅い回線でも書き込みが通った時点で画面へ反映する。
   * 確かめられたかは、保存より後に出した要求の最新の応答（保存済みの代用ではない）で、その
   * 期間を取り直せたかで決める（`isSyncedSince`）。
   */
  const pendingOps = useMemo(
    () => pendingOptimisticOps(optimisticOps, source.isSyncedSince),
    [optimisticOps, source.isSyncedSince],
  );
  const overlaidEvents = useMemo(
    () => applyOptimisticEvents(source.events, pendingOps),
    [source.events, pendingOps],
  );

  const data = useMemo(
    () =>
      view === "month"
        ? {
            ...monthData,
            events: overlaidEvents,
            invalidate: (touched: TouchedRange[] | null) =>
              monthData.invalidate(touched === null ? null : monthsOfRanges(touched)),
          }
        : {
            ...rangeData,
            events: overlaidEvents,
            pendingMonths: NO_PENDING_MONTHS,
          },
    [view, monthData, rangeData, overlaidEvents],
  );

  // ヘッダーの再取得ボタン・ドラッグ確定後の同期など、CalendarShell 側から
  // data.invalidate を呼べるように登録しておく（issue #697）。
  useEffect(() => {
    registerInvalidate(() => data.invalidate(null));
    return () => registerInvalidate(null);
  }, [data, registerInvalidate]);

  /**
   * 勤務場所の色（docs/spec.md §34）。選択肢はNotionのプロパティ定義が一次情報源で、
   * タグ・種類と同じ経路（loadTagCatalog）で既に読んでいる。参照を保って渡さないと、
   * memo で包んだ日ごとの列が毎回描き直しになる。
   */
  const workPlaceOptions = useMemo(() => tagCatalog.work ?? [], [tagCatalog.work]);

  /**
   * 日付ヘッダーの勤務スロットから開く入力（issue #532）。
   *
   * 勤務の画面（/work）と同じ `WorkRecordDialog` をそのまま開く。新しい入力画面は作らない。
   * その日に記録があれば編集、無ければ新規（その日付・勤務のタブ）で開くのも `openDay()` と
   * 同じ形にする。新規で送ると重なりをサーバーが断る（1日1件・docs/spec.md §34）ため、
   * 開く前にここで分けておく必要がある。
   *
   * 他の入力（`itemDialog` など）は状態を外側の `CalendarShell` に置いているが、あれらは
   * 日付だけからひな型を作れる。勤務はその日の**既存の記録**を引く必要があり、それが解決するのは
   * カレンダーのデータ（`data.workRecords`）を持つこの `CalendarBody` のここから。外側で待つと
   * 「ヘッダーは取得を待たずに描く」という作りが崩れるため、状態ごとこちらへ置く
   * （issue #532 計画レビューG1の指摘）。
   */
  const [workDraft, setWorkDraft] = useState<WorkDraft | null>(null);

  // DayHeaderPane は memo で包んである。参照が毎回変わると日付ヘッダーが描き直しになる。
  const workRecords = data.workRecords;
  const openWork = useCallback(
    (dateKey: string) => {
      const existing = workRecords.find((record) => coversDate(record, dateKey));
      setWorkDraft(
        existing
          ? { mode: "edit", record: existing }
          : { mode: "create", startDate: dateKey, kind: "work" },
      );
    },
    [workRecords],
  );

  /**
   * 月表示に出す予定。活動記録は除く（issue #241）。
   *
   * 月表示は1日に数件しか置けない。睡眠のように毎日必ず入る記録がその枠を占めると、
   * その日に何があるかが読めなくなる。記録は何時から何時までという時刻の情報が主で、
   * 日単位の一覧である月表示では読み取れないため、時間グリッド側にだけ残す。
   */
  const monthEvents = useMemo(
    () =>
      activityCalendars.size === 0
        ? data.events
        : data.events.filter((event) => !activityCalendars.has(event.calendarId)),
    [data.events, activityCalendars],
  );

  /**
   * 保存・削除のあとの取り直し。
   *
   * 月表示は変わった月だけを、日・3日・週表示はいま表示中の期間だけを取り直す
   * （`data.invalidate`、`useCalendarChunks`/`useCalendarRangeData` どちらも同じ形）。
   * ページごと描き直す（`router.refresh()`）と表示中の範囲すべてを外部APIから取り直す
   * ことになり、保存のたびにその待ち時間が乗るため使わない（issue #697）。
   */
  const handleSaved = (touched: TouchedRange[] | null, change?: OptimisticEventChange) => {
    onCloseDialogs();
    setWorkDraft(null);
    // 保存した予定は、取り直しを待たずに画面へ重ねる（issue #787）。
    if (change) onOptimisticEvent(change);
    data.invalidate(touched);
  };

  /**
   * 表示画面を開いたままの変更（紐づけの操作）。閉じずに、変わった期間だけ取り直す。
   * 続けて段階を選び直せるようにするため、押すたびにダイアログを閉じない。
   */
  const handleChanged = (touched: TouchedRange[] | null) => {
    data.invalidate(touched);
  };

  /** 表示画面のままの完了切り替え。編集フォームを経由しないため保存とは別経路で送る。 */
  const handleToggleTaskDone = async (task: TaskItem, done: boolean, skipped = false) => {
    if (offline) throw new Error(OFFLINE_WRITE_MESSAGE);

    const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // 繰り返しタスクは完了時に次回分が作られるため、通常の更新とは別の経路で送る。
      body: JSON.stringify({ done, completeAction: true, ...(skipped ? { skipped: true } : {}) }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? "更新できませんでした。");
    }

    // 完了にすると繰り返しの次回分が別の日に作られることもあるため、
    // 期限と予定日の両方がかかる範囲（月表示では月）を取り直す。
    data.invalidate(taskRanges(task));
  };

  // 右下の「＋」で作れる種類。キーボードショートカットの `c`（issue #635）も同じ条件で判定する。
  const addAvailable: Record<AddableKind, boolean> = {
    event: !offline && data.calendars.length > 0,
  };

  const shortcutActions: CalendarShortcutActions = {
    onGoToday,
    onMove,
    onSwitchView,
    onRefresh: onRefreshAll,
    onAdd,
    onOpenHelp: onOpenShortcuts,
  };

  // ダイアログが開いているかどうかの判定はフックの内側でDOMを見て行う（issue #635 計画
  // レビューG1の指摘）。ドロワー・下部ナビのシート等、このコンポーネントが状態を持たない
  // ダイアログも含めて、新しいダイアログが増えるたびに列挙し直す必要が無い。
  useCalendarShortcuts({
    offline,
    available: addAvailable,
    actions: shortcutActions,
  });

  return (
    <>
      {/* オフラインならすでに OfflineNotice が出ているため、二重に出さない（issue #718）。 */}
      {!offline && data.stale && <SlowNetworkNotice />}

      {(data.errors.length > 0 || data.loadError || dragError) && (
        <div className="flex flex-col gap-1 bg-error-container/70 text-on-error-container px-3 py-2 text-xs">
          {data.errors.map((error) => (
            <span key={`${error.source}-${error.reason}`}>{error.reason}</span>
          ))}
          {data.loadError && <span>{data.loadError}</span>}
          {dragError && <span>{dragError}</span>}
        </div>
      )}

      {view === "month" ? (
        <ContinuousMonthView
          weeks={weeks}
          events={monthEvents}
          tasks={data.tasks}
          reminders={data.reminders}
          travels={data.travels}
          workRecords={data.workRecords}
          workPlaceOptions={workPlaceOptions}
          holidayCalendarIds={holidayCalendars}
          weekStartsOn={weekStartsOn}
          utils={utils}
          scrollTarget={scrollTarget}
          pendingMonths={data.pendingMonths}
          virtual={virtual}
          onVisibleMonthChange={onVisibleMonthChange}
          onVisibleWeekChange={onVisibleWeekChange}
          onSelectDay={onSelectDay}
          onQuickAdd={onQuickAddOnDay}
          onOpenEvent={onOpenEvent}
          onOpenTask={onOpenTask}
          onOpenReminder={onOpenReminder}
          onOpenTravel={onOpenTravel}
        />
      ) : (
        <TimeGridView
          days={days}
          events={data.events}
          tasks={data.tasks}
          reminders={data.reminders}
          travels={data.travels}
          workRecords={data.workRecords}
          workPlaceOptions={workPlaceOptions}
          workWritable={work.writable}
          onOpenWork={openWork}
          runningActivity={runningActivity}
          activityCalendarIds={activityCalendars}
          holidayCalendarIds={holidayCalendars}
          utils={utils}
          onOpenEvent={onOpenEvent}
          onOpenTask={onOpenTask}
          onOpenReminder={onOpenReminder}
          onOpenTravel={onOpenTravel}
          onOpenActivity={onOpenActivity}
          onSelectSlot={onSelectSlot}
          onSelectRange={onSelectRange}
          onDragCommit={onDragCommit}
          onAllDayDragCommit={onAllDayDragCommit}
          onSwipe={onSwipe}
          readOnly={offline}
          centerNowRequest={centerNowRequest}
        />
      )}

      <AddButton
        available={addAvailable}
        onAdd={onAdd}
        hasRunningBar={runningActivity !== null}
      />

      {/*
        勤務・出張・年休・会社休業日の入力（docs/spec.md §34）。勤務の画面と同じダイアログで、
        保存後は他の入力と同じ取り直しの経路に乗せる。開くのは時間グリッドの日付ヘッダーからだけ
        （月表示はセルの押下が「1日表示へ移動」に決まっている・issue #532）。
      */}
      {workDraft && (
        <WorkRecordDialog
          draft={workDraft}
          placeOptions={workPlaceOptions}
          tripPlaces={work.tripPlaces}
          capabilities={work.capabilities}
          todayKey={utils.todayKey()}
          workMinutesPerDay={work.minutesPerDay}
          onClose={() => setWorkDraft(null)}
          onSaved={() => handleSaved(null)}
        />
      )}

      {itemDialog && (
        <ItemDialog
          initialKind={itemDialog.initialKind}
          drafts={itemDialog.drafts}
          calendars={data.calendars}
          tagCatalog={tagCatalog}
          placeCatalog={placeCatalog}
          timeZone={timeZone}
          weekStartsOn={weekStartsOn}
          onClose={onCloseDialogs}
          onSaved={handleSaved}
          travelCalendarId={travelCalendarId}
          onOpenTravel={onOpenStandaloneTravel}
        />
      )}

      {/* 保存先が1つも無いと入力しても保存できない。押しても何も起きない画面は出さない。 */}
      {quickDraft && data.calendars.length > 0 && (
        <QuickEventSheet
          draft={quickDraft}
          calendars={data.calendars}
          timeZone={timeZone}
          onClose={onCloseDialogs}
          onSaved={handleSaved}
          onOpenDetail={onOpenEventForm}
          travelCalendarId={travelCalendarId}
          onOpenTravel={onOpenStandaloneTravel}
        />
      )}

      {viewingEvent && (
        <EventDetailDialog
          event={viewingEvent}
          timeZone={timeZone}
          readOnly={offline}
          onClose={onCloseDialogs}
          onEdit={() => onEditEvent(viewingEvent)}
          onDuplicate={() => onDuplicateEvent(viewingEvent)}
          onAddTravel={() => onAddTravelForEvent(viewingEvent)}
          // この予定のために作った移動。往路・復路の2件が同じ予定を指す。
          linkedTravels={data.travels.filter(
            (travel) => travel.linkedEventId === viewingEvent.id,
          )}
          onOpenTravel={onOpenTravelForEvent}
          weekStartsOn={weekStartsOn}
          onTravelLinkChanged={handleSaved}
          onLinkTask={() => onLinkTaskForEvent(viewingEvent)}
          onBringChanged={() => handleChanged([{ start: viewingEvent.start, end: viewingEvent.end }])}
          // この予定に紐づいているタスク。通常表示では一覧を出し、削除の確認では
          // 消すと紐づけが外れるタイトルだけを取り出して示す（docs/spec.md §31・issue #835）。
          linkedTasks={data.tasks.filter((task) =>
            task.links.some((link) => link.eventId === viewingEvent.id),
          )}
          onOpenTask={onOpenTaskForEvent}
          // 場所を地図で開くとき、登録済みの場所なら座標で開く（issue #426）。
          places={placeCatalog.places}
          onDeleted={handleSaved}
          // 中止・不参加の記録（docs/spec.md §37）。続けて直せるようダイアログは閉じず、
          // 開いている予定だけ差し替えてから、その予定がかかる月を取り直す。
          onOutcomeChanged={(outcome) => {
            onOpenEvent({ ...viewingEvent, outcome });
            handleChanged([{ start: viewingEvent.start, end: viewingEvent.end }]);
          }}
          // 仮の予定の確定（issue #688）。続けて直せるようダイアログは閉じず、
          // 開いている予定だけ差し替えてから、その予定がかかる月を取り直す。
          onConfirmed={() => {
            onOpenEvent({ ...viewingEvent, tentative: false });
            handleChanged([{ start: viewingEvent.start, end: viewingEvent.end }]);
          }}
        />
      )}

      {viewingTask && (
        <TaskDetailDialog
          task={viewingTask}
          tagOptions={tagCatalog.task ?? []}
          progressOptions={tagCatalog.progress ?? null}
          timeZone={timeZone}
          readOnly={offline}
          onClose={onCloseDialogs}
          onEdit={() => onEditTask(viewingTask)}
          onDeleted={handleSaved}
          onToggleDone={handleToggleTaskDone}
          onChanged={handleChanged}
        />
      )}

      {/* 予定にタスクを紐づける（docs/spec.md §31）。 */}
      {linkingEvent && (
        <TaskLinkDialog
          event={linkingEvent}
          timeZone={timeZone}
          onCancel={onCloseDialogs}
          onCreateTask={(stage, target) => onCreateTaskForEvent(linkingEvent, stage, target)}
          onLinked={handleSaved}
        />
      )}

      {viewingTravel && (
        <TravelDetailDialog
          travel={viewingTravel}
          timeZone={timeZone}
          readOnly={offline}
          onClose={onCloseDialogs}
          onEdit={() => onEditTravel(viewingTravel)}
          onDeleted={handleSaved}
          // この移動に紐づくタスク。出発前に確かめるものなどを置く（issue #914）。
          linkedTasks={data.tasks.filter((task) =>
            task.links.some((link) => link.travelId === viewingTravel.id),
          )}
          onOpenTask={onOpenTaskForEvent}
          onLinked={handleSaved}
          weekStartsOn={weekStartsOn}
          linkedEventTitle={
            data.events.find((event) => event.id === viewingTravel.linkedEventId)?.title ?? null
          }
          linkedEventRange={
            data.events.find((event) => event.id === viewingTravel.linkedEventId) ?? null
          }
          onCreateTask={(stage, target) => onCreateTaskForTravel(viewingTravel, stage, target)}
        />
      )}

      {viewingReminder && (
        <ReminderDetailDialog
          reminder={viewingReminder}
          categoryOptions={tagCatalog.reminder ?? []}
          timeZone={timeZone}
          readOnly={offline}
          onClose={onCloseDialogs}
          onEdit={() => onEditReminder(viewingReminder)}
          onDeleted={handleSaved}
        />
      )}
    </>
  );
}

/** YYYY-MM-DD を日数分ずらす。UTC正午で扱い、タイムゾーンによる日付ずれを避ける。 */
function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * 画面右下の「＋」。押すと予定の入力が下から開く（docs/spec.md §15）。
 * タスク・日付リマインド・移動は作れない（AddableKind の理由を参照）。
 */
function AddButton({
  available,
  onAdd,
  hasRunningBar,
}: {
  available: Record<AddableKind, boolean>;
  onAdd: (available: Record<AddableKind, boolean>) => void;
  /** 記録中バー（issue #629）が下部ナビの直上に出ているか。出ていれば重ならない位置まで逃がす。 */
  hasRunningBar: boolean;
}) {
  if (!available.event) return null;

  return (
    <div className={cn("fixed right-4 z-30", fabBottomOffsetClass(hasRunningBar))}>
      {/* M3のFAB。角は完全な丸ではなく大きめの角丸で、面として置かれていることを示す。
          大きさ・角丸は M3 Expressive の medium FAB に寄せる（issue #705）。 */}
      <Button
        size="icon"
        aria-label="追加"
        className="elevation-3 size-16 rounded-[20px] bg-primary-container text-on-primary-container hover:brightness-95 active:rounded-[14px]"
        onClick={() => onAdd(available)}
      >
        <Plus className="size-6" />
      </Button>
    </div>
  );
}

/**
 * ヘッダーに出す年月日。1つの文字列ではなく年・月日・曜日に分けて返す。
 * 同じ大きさで並べると、探している月日が年号に埋もれて一目で拾えないため、
 * 画面側で字の大きさと濃さを変えられる形で渡す。
 */
type HeaderLabel = {
  /** 「2026年」。範囲が年をまたぐときは先頭の年だけを出し、またいだ先は main に入れる。
   *  1日・3日表示は幅が足りず見切れるため空文字にする */
  year: string;
  /** 「8月」「8月12日」「8月10日 – 16日」 */
  main: string;
  /**
   * 狭い画面で main の代わりに出す短い表記（「8月」「8月 – 9月」）。
   * null なら幅に関わらず main を使う。
   */
  compact: string | null;
  /** 1日表示のときだけ。曜日はグリッドと同じ配色にする */
  weekday: { label: string; tone: string | null } | null;
};

function formatMonthLabel(monthKey: string): HeaderLabel {
  return {
    year: `${monthKey.slice(0, 4)}年`,
    main: `${Number(monthKey.slice(5, 7))}月`,
    compact: null,
    weekday: null,
  };
}

function formatRangeLabel(view: CalendarView, anchorKey: string, days: string[]): HeaderLabel {
  if (view === "month") {
    return formatMonthLabel(anchorKey);
  }

  const first = days[0];
  const last = days[days.length - 1];
  // 1日・3日表示は月日だけでもスマートフォンの幅いっぱいになるため、年を足すと見切れる。
  // 週表示（desktopOnly）は幅に余裕があるため、そちらは従来どおり年も出す。
  const year = view === "day1" || view === "day3" ? "" : `${first.slice(0, 4)}年`;

  // 1日・3日表示は、狭い画面では月日を並べるだけで幅を使い切る。列ヘッダーに日と曜日が
  // 出ているため、狭いときは月だけに落として範囲が読めなくなるのを避ける。
  // 週表示（desktopOnly）は幅に余裕があり、月だけに落とす必要が無い。
  const compact =
    view === "day1" || view === "day3" ? formatMonthRange(first, last) : null;

  if (first === last) {
    return {
      year,
      main: formatMonthDay(first),
      compact,
      weekday: { label: weekdayLabel(first), tone: dayTone(first) },
    };
  }

  // 同じ月に収まる範囲では終わりの月を繰り返さない。読む必要があるのは変わる側だけで、
  // 繰り返すと数字の並びが長くなって、どこが範囲の切れ目か掴みにくくなる。
  // 年をまたぐときだけ終わりにも年を添える（週表示は年末年始をまたぐ）。
  const tail =
    first.slice(0, 4) !== last.slice(0, 4)
      ? `${last.slice(0, 4)}年${formatMonthDay(last)}`
      : first.slice(5, 7) === last.slice(5, 7)
        ? `${Number(last.slice(8, 10))}日`
        : formatMonthDay(last);

  return { year, main: `${formatMonthDay(first)} – ${tail}`, compact, weekday: null };
}

function formatMonthDay(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`;
}

/** 「8月」。月をまたぐ範囲だけ「8月 – 9月」にする */
function formatMonthRange(first: string, last: string): string {
  const firstMonth = `${Number(first.slice(5, 7))}月`;
  if (first.slice(0, 7) === last.slice(0, 7)) return firstMonth;
  return `${firstMonth} – ${Number(last.slice(5, 7))}月`;
}
