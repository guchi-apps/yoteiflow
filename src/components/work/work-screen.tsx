"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useOffline } from "next/offline";
import {
  Briefcase,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
} from "lucide-react";

import { readErrorMessage } from "@/components/calendar/response-error";
import { AppMenuButton } from "@/components/nav/app-drawer";
import { AppFrame } from "@/components/nav/app-frame";
import { BottomNav } from "@/components/nav/main-nav";
import { RunningActivityBar } from "@/components/nav/running-activity-bar";
import { describeSync, type SyncSummary } from "@/lib/work-sync/message";
import { OFFLINE_WRITE_MESSAGE, OfflineNotice } from "@/components/offline/offline-notice";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { SlowNetworkNotice } from "@/components/offline/slow-network-notice";
import { useApiResource } from "@/components/offline/use-api-resource";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshButton } from "@/components/ui/refresh-button";
import type { WorkMonthData } from "@/types/work";
import { MonthPickerDialog } from "@/components/work/month-picker-dialog";
import { WorkRecordDialog, type WorkDraft } from "@/components/work/work-record-dialog";
import { useWriteSynced } from "@/lib/offline-queue/use-write-synced";
import { dayTone, OFF_DAY_TONE } from "@/lib/day-tone";
import { japaneseHolidayName } from "@/lib/japanese-holidays";
import { isAutoOffDay, weekdayOf } from "@/lib/work-days";
import { cn } from "@/lib/utils";
import { segmentsOn, summarizeSegments } from "@/lib/work-segments";
import {
  annualLeaveDays,
  annualLeaveHours,
  coversDate,
  DEFAULT_WORK_MINUTES_PER_DAY,
  formatDays,
  formatLeaveHours,
  HOLIDAY_TITLE,
  isDefaultHolidayTitle,
  isPartialLeave,
  splitOpenWorkRecords,
  WORK_TODO_LABELS,
  workTodos,
  workTodoStates,
  type WorkCapabilities,
  type WorkRecordItem,
  type WorkTodo,
} from "@/types/work";
import type { RunningActivitySummary } from "@/types/activity";

/**
 * 勤務場所・出張・年休・会社休業日の画面（docs/spec.md §34）。
 *
 * 登録も確認もこの画面に閉じている。勤務場所は毎日押すものだが、記録（活動記録）のように
 * 「いま」その瞬間を押さえる操作ではなく、一日の終わりや翌朝にまとめて入れられる。
 * 記録画面へ混ぜず専用の画面に置いているのはそのため。
 */
export function WorkScreen({
  monthKey: initialMonthKey,
  ...rest
}: Omit<WorkMonthScreenProps, "monthKey" | "onMonthChange" | "onOpenMonthPicker"> & {
  monthKey: string;
}) {
  // 月送りはページ（RSC）の取り直しにしない。取り直しだと、オフライン・低速時に別の月が開けない
  // （issue #974）。月ごとの内容は GET /api/work/month から取り、Service Worker が保存済みへ倒す。
  const [monthKey, setMonthKey] = useState(initialMonthKey);

  const onMonthChange = useCallback((next: string) => {
    setMonthKey(next);
    // URLだけ合わせる。再読み込み・共有しても同じ月が開く。
    window.history.replaceState(null, "", `/work?month=${next}`);
  }, []);

  // 月を選ぶシート（issue #1271）は月ごとに作り直す子の外に置く。子の中に置くと、月を選んだ
  // 瞬間に開いたままのダイアログごと子がアンマウントされ、Radixが <body> に残す
  // `pointer-events: none` で画面全体が操作を受け付けなくなることがある。
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  // 月が変わったら内部の状態（取得結果・開いたダイアログ）を作り直す。
  return (
    <>
      <WorkMonthScreen
        key={monthKey}
        monthKey={monthKey}
        onMonthChange={onMonthChange}
        onOpenMonthPicker={() => setMonthPickerOpen(true)}
        {...rest}
      />
      <MonthPickerDialog
        // 開くたびに表示中の月の年から始める（閉じている間に月が変わっても古い年を残さない）。
        key={monthKey}
        open={monthPickerOpen}
        monthKey={monthKey}
        todayKey={rest.todayKey}
        onPick={(next) => {
          setMonthPickerOpen(false);
          if (next !== monthKey) onMonthChange(next);
        }}
        onClose={() => setMonthPickerOpen(false)}
      />
    </>
  );
}

type WorkMonthScreenProps = {
  /** YYYY-MM */
  monthKey: string;
  onMonthChange: (monthKey: string) => void;
  /** 月の見出しを押したとき。月を選ぶシートは親（`WorkScreen`）が持つ。 */
  onOpenMonthPicker: () => void;
  todayKey: string;
  /** 出張扱いにする勤務場所の名前（docs/spec.md §34）。 */
  tripPlaces: string[];
  capabilities: WorkCapabilities;
  /**
   * 記録中の項目（issue #629）。ナビの記録の項目へ印を出し、下部ナビの直上に記録中バーを
   * 出すために使う（docs/spec.md §27）。
   */
  runningActivity?: RunningActivitySummary | null;
  /** 下部ナビの「今日へ」に使うタイムゾーン（`UiSetting.timeZone`）。 */
  timeZone: string;
  /** 1日の所定労働時間（分）。入力ダイアログの時間休の上限に使う（issue #537）。 */
  workMinutesPerDay?: number;
};

function WorkMonthScreen({
  monthKey,
  onMonthChange,
  onOpenMonthPicker,
  todayKey,
  tripPlaces,
  capabilities,
  runningActivity = null,
  timeZone,
  workMinutesPerDay = DEFAULT_WORK_MINUTES_PER_DAY,
}: WorkMonthScreenProps) {
  // 記録の追加・変更はすべて書き込み。オフライン中は押せないようにする（docs/spec.md §21）。
  const offline = useOffline();
  useReconnectRefresh();

  // オフラインでもこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  useWarmOfflinePage("/work");

  // 月ごとの内容。取得できるまでは前回の保存済み（Service Worker）が出る（issue #974）。
  const resource = useApiResource<WorkMonthData>(
    `/api/work/month?month=${monthKey}`,
    "勤務記録を取得できませんでした。",
  );
  const records = useMemo(() => resource.data?.records ?? [], [resource.data]);
  const openTrips = useMemo(() => resource.data?.openTrips ?? [], [resource.data]);
  const openLeaves = useMemo(() => resource.data?.openLeaves ?? [], [resource.data]);
  const placeOptions = useMemo(() => resource.data?.placeOptions ?? [], [resource.data]);
  const loadError = resource.error;
  const loaded = resource.data !== null;
  useWriteSynced(resource.reload);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkDraft | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [proceduresOpen, setProceduresOpen] = useState(false);

  // 勤務予定・移動の再計算（docs/spec.md §46）。同期の契機は勤務記録の作成・更新・削除だけで、
  // Notionを直接編集した分は追従しないため、その取りこぼしを拾う手動の入口。
  const recalculate = async () => {
    setRecalculating(true);
    setSyncNote(null);
    try {
      const response = await fetch("/api/work/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: monthKey }),
      });
      const body = (await response.json().catch(() => null)) as
        | (SyncSummary & { message?: string; created?: number; updated?: number; deleted?: number })
        | null;
      if (!response.ok) {
        setSyncNote(body?.message ?? "勤務予定・移動を再計算できませんでした。");
      } else if (body?.status === "disabled") {
        setSyncNote("設定の「勤務」で、勤務予定・移動の自動作成をオンにしてください。");
      } else {
        const changed = (body?.created ?? 0) + (body?.updated ?? 0) + (body?.deleted ?? 0);
        setSyncNote(
          describeSync(body) ??
            (changed > 0
              ? `勤務予定・移動を反映しました（作成${body?.created ?? 0}・更新${body?.updated ?? 0}・削除${body?.deleted ?? 0}）。`
              : "変更はありませんでした。"),
        );
      }
    } catch {
      setSyncNote("勤務予定・移動を再計算できませんでした。");
    } finally {
      setRecalculating(false);
    }
  };

  const days = useMemo(() => daysOfMonth(monthKey), [monthKey]);
  const send = async (path: string, init: RequestInit, fallback: string): Promise<boolean> => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return false;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, init);
      if (!response.ok) {
        setError(await readErrorMessage(response, fallback));
        return false;
      }
      resource.reload();
      return true;
    } catch {
      setError(fallback);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** 手続きの済み・未済を切り替える。日付は動かさないため、重なりの確認は要らない。 */
  const toggleTodo = async (record: WorkRecordItem, todo: WorkTodo, done: boolean) => {
    await send(
      `/api/work/records/${record.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [todo]: done }),
      },
      "手続きの状況を変更できませんでした。",
    );
  };

  const openDay = (dateKey: string) => {
    const existing = records.find((record) => coversDate(record, dateKey));
    // 新規作成の既定は常に勤務のタブから始める（isAutoOffDayでも休みのタブへは寄せない）。
    // 会社休業日は「会社が決めた休み」で期間で1件のもの（docs/spec.md §34）。土日を1日ずつ
    // 休みとして登録すると、月の集計（`Tally()`）で本来のお盆・年末年始の休業日数と
    // 混ざって読めなくなる。休みとして明示的に記録したいときは、このダイアログの中でタブを切り替えて
    // 登録する（「休みを追加」などの追加ボタンは issue #1271 で撤去した）。
    setDraft(
      existing
        ? { mode: "edit", record: existing }
        : { mode: "create", startDate: dateKey, kind: "work" },
    );
  };

  const monthLabel = `${monthKey.slice(0, 4)}年${Number(monthKey.slice(5, 7))}月`;
  // 出張・年休の手続きは本文から外し、ヘッダー右上のアイコンとそこから開くシートへ移した
  // （issue #1271）。月ごとの勤務場所を画面の先頭に置くため。中身（いま片付けるものだけを
  // 並べ、1週間より先の事前申請は畳む・issue #571）は従来の区画のまま。
  const trips = splitOpenWorkRecords(openTrips, todayKey);
  const leaves = splitOpenWorkRecords(openLeaves, todayKey);
  // バッジが数えるのは「いま手を打つべき件数」（docs/spec.md §34）。畳んだぶん（1週間より先の
  // 事前申請）は足さない。足すと、全件が先の予定のときにバッジは「3」なのに、開いたシートには
  // 「いま対応が必要な手続きはありません。」が並び、同じ数字の意味が食い違う（issue #571 計画
  // レビューG2の指摘と同じ理由）。ドロワーのバッジ（`/api/work/alerts`）は総数のまま。あちらは
  // 「勤務の画面を開く理由があるか」を示すもので役割が違う。
  //
  // dueの記録の手続きは必ず全てdueになる。事後登録が未対応に数えられるのは終了日を過ぎた
  // ときだけ（`workTodos()`）で、そのとき開始日も当然過ぎており事前申請もdueになるため、
  // 「事後登録がdueで事前申請がlater」の組み合わせは起きない。
  const openTodos = trips.due.flatMap((trip) => workTodos(trip, todayKey));
  const openLeaveCount = leaves.due.length;
  const attentionCount = openTodos.length + openLeaveCount;
  // 出張・年休の手続きを1つでも持てるか。持てないDBでは右上のアイコンごと出さない。
  const hasProcedures = capabilities.approval || capabilities.annualLeave;

  return (
    <AppFrame current="work" activityRunning={runningActivity !== null} running={runningActivity}>
      <header className="flex items-center gap-1 bg-surface-container-low px-2 py-2">
        {/* 768px未満は左上をメニューにする（issue #328・#463）。768px以上は左端のサイドバーから
            画面を移る（issue #636）。 */}
        <AppMenuButton current="work" activityRunning={runningActivity !== null} />
        {/* いまどの画面にいるかは、ヘッダーのナビが無くなったぶんここで示す（issue #463）。
            狭い画面では下部ナビが同じことを示すため、PCだけに出す。 */}
        <div className="hidden shrink-0 items-center gap-1.5 font-semibold md:flex">
          <Briefcase className="size-5" />
          <span>勤務</span>
        </div>
        <span className="flex-1" />

        {/* 対応が必要な出張・年休（issue #1271）。件数はバッジで常に見え、押すとシートで開く。
            読み上げでは件数まで含めて名前にする（バッジは装飾として隠す）。 */}
        {hasProcedures && (
          <Button
            variant="ghost"
            size="icon"
            className="size-10 md:size-9"
            aria-label={
              attentionCount > 0 ? `対応が必要な手続き ${attentionCount}件` : "出張・年休の手続き"
            }
            onClick={() => setProceduresOpen(true)}
          >
            <ClipboardCheck className="size-5" />
            {attentionCount > 0 && (
              <span
                aria-hidden
                className="type-label-small absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 font-bold text-on-error tabular-nums"
              >
                {attentionCount > 99 ? "99+" : attentionCount}
              </span>
            )}
          </Button>
        )}
        <RefreshButton
          spinning={resource.loading || busy || recalculating}
          disabled={offline}
          onClick={resource.reload}
        />
      </header>
      <OfflineNotice />
      {!offline && resource.stale && <SlowNetworkNotice />}
      {syncNote && (
        <p
          role="status"
          className="type-body-small mx-4 mt-2 flex items-start justify-between gap-2 rounded-lg bg-secondary-container px-3 py-2 text-on-secondary-container"
        >
          <span>{syncNote}</span>
          <button type="button" className="shrink-0 underline" onClick={() => setSyncNote(null)}>
            閉じる
          </button>
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
          {/* 書き込みの失敗を先に出す。押した操作の結果のほうが、開いた時点の取得の失敗より新しい。 */}
          {(error ?? loadError) && (
            <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
              {error ?? loadError}
            </p>
          )}

          {/* この月の勤務場所。画面の先頭に置く（issue #1271）。月の見出しは押せるボタンにし、
              前へ・次へを何度も押さずに離れた月へ移れるようにする。 */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                aria-label="前の月"
                onClick={() => onMonthChange(shiftMonth(monthKey, -1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <h2 className="min-w-0">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={`${monthLabel}の勤務場所（表示する月を選ぶ）`}
                  onClick={onOpenMonthPicker}
                  className="type-title-small flex items-center gap-1 rounded-full px-3 py-1.5 tabular-nums hover:bg-on-surface/8"
                >
                  {monthLabel}の勤務場所
                  <ChevronDown className="size-4 text-on-surface-variant" />
                </button>
              </h2>
              <Button
                variant="ghost"
                size="sm"
                aria-label="次の月"
                onClick={() => onMonthChange(shiftMonth(monthKey, 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            {!loaded && !loadError && (
              <p className="type-body-small text-on-surface-variant">読み込んでいます…</p>
            )}

            <Tally records={records} days={days} />
            {/*
              日別の一覧は、カードの幅が36rem以上あれば前半・後半の2段に分け、1か月ぶんがスクロール
              せずに入るようにする（issue #636）。列優先で流すため、段の中は上から日付順のまま。
              1日1行・行の高さを揃える決まり（issue #521）は変えない。
            */}
            <Card className="@container/days py-2">
              <CardContent
                className="px-4 @xl/days:grid @xl/days:grid-flow-col @xl/days:grid-rows-(--work-day-rows) @xl/days:gap-x-6"
                style={
                  {
                    "--work-day-rows": `repeat(${Math.ceil(days.length / 2)}, auto)`,
                  } as React.CSSProperties
                }
              >
                {days.map((dateKey) => {
                  const record = records.find((item) => coversDate(item, dateKey));
                  const holiday = japaneseHolidayName(dateKey);
                  // 未対応の手続き。事後登録は終了日を過ぎるまで含まれないため、まだできない
                  // 手続きが未対応として並ぶことはない（判定は右上の手続きのシートと同じ関数に任せる）。
                  // 出張は期間の全ての日に同じ記録が並ぶため、印は開始日の行にだけ出す
                  // （同じ手続きの印が日数ぶん縦に重複しないように・issue #521）。
                  const marks =
                    record && dateKey === record.startDate ? workTodos(record, todayKey) : [];
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      onClick={() => openDay(dateKey)}
                      className={cn(
                        "flex w-full items-center gap-3 border-b border-outline-variant py-2.5 text-left last:border-b-0",
                        // 今日は行ごと淡く塗る（issue #571）。31行を上から追う面で、日付の印だけでは
                        // スクロール中に見つけにくい。塗りは項目名・祝日名・未対応のバッジの後ろに
                        // 敷くだけで、それらの色は変えない。
                        dateKey === todayKey
                          ? "bg-primary/8 hover:bg-primary/12"
                          : "hover:bg-on-surface/8",
                      )}
                    >
                      {/*
                        今日は塗りつぶしたピルにする（issue #571）。太字だけでは弱く、カレンダーの
                        月表示が今日を紫の丸で示しているのに、この一覧だけその流儀から外れていた。

                        余白（padding）でピルを作らず、**全ての行の日付を同じ高さの枠へ入れて今日だけ
                        塗る**。今日の行だけ高さが変わると、1日ぶんを必ず1行に収めて行の高さを揃える
                        決め（issue #521）が崩れ、日付を目で追う速さがそこで落ちる。
                      */}
                      <span className="flex w-16 shrink-0">
                        <span
                          className={cn(
                            "type-body-small inline-flex h-5 items-center rounded-full px-2 tabular-nums",
                            dateKey === todayKey
                              ? "bg-primary font-semibold text-primary-foreground"
                              : dateClass(dateKey),
                          )}
                        >
                          {dayLabel(dateKey)}
                        </span>
                      </span>
                      {/* 項目名・祝日名・印は同じ行に並べる。項目名に `flex-1` を持たせて残りの幅を
                          受け取らせ、印（`shrink-0`）を押し出さない。入れ子の箱にまとめると、その箱の
                          ほうが縮んで印が枠からはみ出す。狭いときに切れるのは項目名と祝日名の末尾で、
                          どちらも `truncate` で末尾から切れる。 */}
                      {record ? (
                        <span
                          className={cn(
                            "type-body-medium min-w-0 flex-1 truncate",
                            record.businessTrip && "font-bold text-travel",
                            // 年休は本人が取得して日数を消費する記録で、年休の画面の集計と結び付いて
                            // いる。休み（会社休業日・土日祝）とは読む理由が違うため色を分ける。
                            record.annualLeave && !record.companyHoliday && "font-bold text-tertiary",
                            // 休みは日付・祝日名と同じ赤にする（issue #582）。日付の色だけだと、
                            // 平日に入れた休み（夏季休業）がその日は働かない日だと行から読めない。
                            // 太字にはしない（休みは片付ける手続きではなく、その日の事実のため）。
                            record.companyHoliday && OFF_DAY_TONE,
                          )}
                        >
                          {recordLabel(record)}
                          {/* 時間帯の内訳（issue #1155）は項目名に続けて流し、1行に収める
                              （行の高さを揃える決め・issue #521）。狭いときは末尾から切れる。 */}
                          {segmentsOn(record, dateKey).length > 0 && (
                            <span className="type-label-small font-normal text-on-surface-variant">
                              {"　"}
                              {summarizeSegments(segmentsOn(record, dateKey), record.title)}
                            </span>
                          )}
                        </span>
                      ) : isAutoOffDay(dateKey) ? (
                        // 登録が無い土日祝は自動的に「休み」として扱う（表示だけ、docs/spec.md §34）。
                        // issue #536で登録済みの休み（会社休業日）の表記も「休み」にそろえたため、
                        // 色（太字・tertiary か on-surface-variant）だけでは両者を読み分けられない。
                        // 月間集計（`Tally()`）は登録済みの記録しか数えないため、「（自動）」を添えて
                        // 集計に入らない行だと分かるようにする（issue #536 計画レビューG1の指摘）。
                        // 色は登録済みの休みと同じ赤にし、読み分けは「（自動）」の表記が持つ
                        // （issue #582。灰色のままだと「未登録」と同じ色で、休みだと読めない）。
                        <span className={cn("type-body-medium flex-1", OFF_DAY_TONE)}>休み（自動）</span>
                      ) : (
                        <span className="type-body-medium flex-1 text-outline">未登録</span>
                      )}
                      {/* 祝日の名前。赤いだけでは何の日か分からず、色以外の手掛かりも要る。
                          色は日付・休みと同じ赤にそろえる（未対応の手続きの赤＝`error` とは
                          役割が違い、同じ行に強さの違う赤を並べない・issue #582）。 */}
                      {holiday && (
                        <span className={cn("type-label-small min-w-0 truncate", OFF_DAY_TONE)}>
                          {holiday}
                        </span>
                      )}
                      {/* 残っている手続きは印だけを出し、この行からは済ませられない（issue #521）。
                          チェックボックスを置くと手続きが残る日だけ2行になり、日ごとの行の高さが
                          揃わない。片付ける場所は右上のアイコンから開く出張・年休のシートと、行を押して開く入力
                          ダイアログに寄せる。色だけに意味を持たせないよう、シートの
                          「未対応 N件」と同じ印と読み上げ用の文字を添える。 */}
                      {marks.length > 0 && (
                        <span className="flex shrink-0 items-center gap-1 text-error">
                          {/* 印は手続きごとではなく群の先頭に1つだけ置く。バッジの中へ入れると、
                              2つ並ぶ日（終わった出張で両方残っている日）に項目名の幅が全角4文字まで
                              縮む。狭いときは印より行き先の名前を先に残す（issue #433 と同じ判断）。 */}
                          <CircleAlert className="size-3.5" />
                          <span className="sr-only">未対応の手続き:</span>
                          {marks.map((todo) => (
                            <span
                              key={todo}
                              className="type-label-small rounded-full bg-error-container px-2 py-0.5 text-on-error-container"
                            >
                              {WORK_TODO_LABELS[todo]}
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            {/* 勤務予定・移動の再計算は、月を開くたびに押すものではないため一番下に置く（issue #1271）。 */}
            {!offline && (
              <Button
                variant="ghost"
                size="sm"
                className="self-center"
                disabled={recalculating}
                onClick={() => void recalculate()}
              >
                {recalculating ? "再計算中…" : "勤務予定・移動を再計算"}
              </Button>
            )}
          </section>
        </div>
      </div>

      <RunningActivityBar running={runningActivity} />
      <BottomNav current="work" activityRunning={runningActivity !== null} timeZone={timeZone} />

      {/* 開閉は `open` で切り替え、閉じるときにアンマウントしない（Radixのダイアログを開いたまま
          アンマウントすると、<body> の `pointer-events: none` が残ることがあるため）。 */}
      {hasProcedures && (
        <ProceduresDialog
          open={proceduresOpen}
          capabilities={capabilities}
          trips={trips}
          leaves={leaves}
          openTodoCount={openTodos.length}
          openLeaveCount={openLeaveCount}
          todayKey={todayKey}
          writeDisabled={busy || offline}
          onToggle={toggleTodo}
          onOpen={(record) => {
            // シートを閉じてから入力画面を開く。重ねて開くと、入力を閉じたあとに手続きの
            // シートが残り、保存した結果がその下に隠れる。
            setProceduresOpen(false);
            setDraft({ mode: "edit", record });
          }}
          onClose={() => setProceduresOpen(false)}
        />
      )}

      {draft && (
        <WorkRecordDialog
          draft={draft}
          placeOptions={placeOptions}
          tripPlaces={tripPlaces}
          capabilities={capabilities}
          todayKey={todayKey}
          workMinutesPerDay={workMinutesPerDay}
          onClose={() => setDraft(null)}
          onSaved={(syncNote) => {
            setDraft(null);
            setSyncNote(syncNote ?? null);
            resource.reload();
          }}
        />
      )}
    </AppFrame>
  );
}

/**
 * ヘッダー右上のアイコンから開く、対応が必要な出張・年休のシート（issue #1271）。
 *
 * 以前は勤務画面の先頭に置いていた2つの区画をそのまま移した。月に限られない情報のため、
 * 月ごとの勤務場所と同じ面に並べると、月切替がこれらにも効くように見えていた（issue #510）。
 * シートに分ければ、画面の先頭を月ごとの勤務場所に譲れる。
 */
function ProceduresDialog({
  open,
  capabilities,
  trips,
  leaves,
  openTodoCount,
  openLeaveCount,
  todayKey,
  writeDisabled,
  onToggle,
  onOpen,
  onClose,
}: {
  open: boolean;
  capabilities: WorkCapabilities;
  trips: { due: WorkRecordItem[]; later: WorkRecordItem[] };
  leaves: { due: WorkRecordItem[]; later: WorkRecordItem[] };
  openTodoCount: number;
  openLeaveCount: number;
  todayKey: string;
  writeDisabled: boolean;
  onToggle: (record: WorkRecordItem, todo: WorkTodo, done: boolean) => void;
  onOpen: (record: WorkRecordItem) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        position="bottom"
        className="max-h-[85dvh] gap-6 overflow-y-auto pb-[calc(1.5rem_+_env(safe-area-inset-bottom))]"
      >
        <DialogHeader>
          <DialogTitle>対応が必要な手続き</DialogTitle>
        </DialogHeader>

        {/* 出張。事前申請・事後登録のプロパティが無いDBでは片付ける手続きそのものが持てないため、
            区画ごと出さない。 */}
        {capabilities.approval && (
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <h3 className="type-title-small">出張</h3>
              {openTodoCount > 0 && (
                <span className="type-label-medium flex items-center gap-1 text-error">
                  <CircleAlert className="size-3.5" />
                  未対応 {openTodoCount}件
                </span>
              )}
            </div>
            <OpenRecords
              split={trips}
              todayKey={todayKey}
              todos={["preApplied", "postRegistered"]}
              emptyLabel="未対応の手続きはありません。"
              writeDisabled={writeDisabled}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          </section>
        )}

        {/* 年休。出張と同じ形にする（開く理由がどちらも「まだ済ませていない手続きを片付けること」）。 */}
        {capabilities.annualLeave && (
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <h3 className="type-title-small">年休</h3>
              {openLeaveCount > 0 && (
                <span className="type-label-medium flex items-center gap-1 text-error">
                  <CircleAlert className="size-3.5" />
                  未申請 {openLeaveCount}件
                </span>
              )}
              {/* 年度の取得状況（docs/spec.md §34）。あちらは「あと何日使えるか」を見る画面で、
                  この区画（残っている申請を片付ける）とは開く理由が違う。入口はここ1つにし、
                  ドロワーには行を足さない。 */}
              <Link href="/work/leave" className="type-label-medium ml-auto text-primary underline">
                年度の取得状況
              </Link>
            </div>
            <OpenRecords
              split={leaves}
              todayKey={todayKey}
              todos={["preApplied"]}
              emptyLabel="未申請の年休はありません。"
              writeDisabled={writeDisabled}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 区画の1件をどちらとして描くか（issue #571）。 */
type RecordTone = "due" | "later";

/**
 * 出張・年休の区画の中身（issue #571）。
 *
 * 出す順は「いま片付けるもの」が先で、1週間より先の事前申請は畳んでおく。畳んだぶんは
 * 見出しではなく1行のボタンで開く（日付リマインドの「過ぎた日付」・タスクの「完了」と同じ形）。
 *
 * 開閉を端末に覚えさせないのは、この区画を開く理由が毎回「いま片付けるもの」から始まるため。
 * 前に開いたまま覚えていると、次に来たときも先の予定が並んだ状態から読むことになる。
 *
 * 開いた先の記録は `tone="later"` で描く。いま片付けるものと同じ赤枠のまま並べると、
 * 「まだ申請しなくてよい」と分けた意味が開いた瞬間に見え方の上では消える
 * （issue #571 計画レビューG1の指摘）。
 *
 * 出張と年休で作りを分けないのは、開く理由（まだ済ませていない手続きを片付ける）が同じで、
 * 別の形にすると同じことをするのに覚えることが2つに増えるため。違うのは出せる手続きの数と、
 * 1件も無いときの文言だけ。
 */
function OpenRecords({
  split,
  todayKey,
  todos,
  emptyLabel,
  writeDisabled,
  onToggle,
  onOpen,
}: {
  split: { due: WorkRecordItem[]; later: WorkRecordItem[] };
  todayKey: string;
  /** 行に出せる手続き。年休は事前申請だけ、出張は事前申請と事後登録。 */
  todos: WorkTodo[];
  /** どちらも0件のときの文言。 */
  emptyLabel: string;
  writeDisabled: boolean;
  onToggle: (record: WorkRecordItem, todo: WorkTodo, done: boolean) => void;
  onOpen: (record: WorkRecordItem) => void;
}) {
  const [laterOpen, setLaterOpen] = useState(false);

  const row = (record: WorkRecordItem, tone: RecordTone) => (
    <RecordRow
      key={record.id}
      record={record}
      todayKey={todayKey}
      todos={todos}
      tone={tone}
      writeDisabled={writeDisabled}
      onToggle={onToggle}
      onOpen={() => onOpen(record)}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      {split.due.length === 0 ? (
        <p className="type-body-small text-on-surface-variant">
          {/* 先のぶんが残っているときは「ありません」と言い切らない。畳んだ先に件数があるのに
              何も無いと読めてしまう。 */}
          {split.later.length === 0 ? emptyLabel : "いま対応が必要な手続きはありません。"}
        </p>
      ) : (
        split.due.map((record) => row(record, "due"))
      )}

      {split.later.length > 0 && (
        <>
          <button
            type="button"
            className="type-label-large flex items-center gap-1.5 self-start rounded-full px-2 py-1 text-left text-on-surface-variant hover:bg-on-surface/8"
            aria-expanded={laterOpen}
            onClick={() => setLaterOpen(!laterOpen)}
          >
            {laterOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            1週間より先
            <span className="type-label-small opacity-70">{split.later.length}件</span>
          </button>
          {laterOpen && split.later.map((record) => row(record, "later"))}
        </>
      )}
    </div>
  );
}

/**
 * 出張・年休1件ぶんの行。済み・未済はその場で切り替えられる。
 *
 * 出張と年休で作りを変えないのは、開く理由（まだ済ませていない手続きを片付ける）が同じで、
 * 別の形にすると同じことをするのに覚えることが2つに増えるため。違うのは出せる手続きの数だけ。
 *
 * 日付をタイトルより上・左に置くのは、この行がまず「いつの記録か」を示すため（issue #509）。
 *
 * 行き先と手続きのチェックボックスは横1行に並べる（issue #519）。全幅の帯として縦に積むと
 * 1枠が144pxになり、未対応が8件あるだけで区画がスマートフォン3画面ぶんになる。行き先の右は
 * まるごと空いており、そこへ入れれば1枠は68pxで済む。行き先が入らないときは末尾を切る
 * （押せば入力画面で全文が読める）。左に80px（行き先5文字ぶん）も残らない幅のときだけ
 * チェックボックスを2行目へ落とす。`flex-1`は`basis-0`なので、行き先が長いだけでは
 * 折り返さず先に省略記号が出る。
 *
 * 手続きのラベルを`type-label-medium`（12px）へ落とすのは、行き先と同じ行へ収めるための寸法。
 * `type-body-medium`（14px）のままだとチップ側が202pxになり、幅360pxでは左に80pxが残らず
 * 折り返してしまう（12pxなら186pxで、360pxでも1行に収まる）。
 */
function RecordRow({
  record,
  todayKey,
  todos: shown,
  tone,
  writeDisabled,
  onToggle,
  onOpen,
}: {
  record: WorkRecordItem;
  todayKey: string;
  /** 出せる手続き。年休は事前申請だけ、出張は事前申請と事後登録。 */
  todos: WorkTodo[];
  /** いま片付けるものか、畳んだ先の記録か（issue #571）。 */
  tone: RecordTone;
  /** 書き込み中・オフライン中かどうか。項目単位の`disabled`（押せない手続き）とは別に持つ。 */
  writeDisabled: boolean;
  onToggle: (record: WorkRecordItem, todo: WorkTodo, done: boolean) => void;
  onOpen: () => void;
}) {
  const states = workTodoStates(record, todayKey, shown);
  // 半休・時間休の日は残りをどこで働いたかも持つ。行に出さないと、開かないと分からない。
  const sub =
    record.annualLeave && isPartialLeave(record.annualLeave) && record.place
      ? `${annualLeaveHours(record.annualLeave) === null ? "残り半日は" : "残りは"}${record.place}`
      : null;

  // 枠の色は「いま片付けるものか」で決める（issue #571）。畳んだ先の記録まで同じ赤枠で並べると、
  // 「まだ申請しなくてよい」と分けた意味が、開いた瞬間に見え方の上では消える。
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border p-3",
        tone === "due" ? "border-error" : "border-outline-variant",
      )}
    >
      {/* 日付・行き先。`min-w-20`を割る幅でだけチェックボックスが2行目へ落ちる。 */}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-20 flex-1 flex-col items-start gap-0.5 overflow-hidden text-left"
      >
        <span className="type-body-small tabular-nums text-on-surface-variant">
          {spanLabel(record)}
        </span>
        <span className="type-body-large max-w-full truncate font-bold">{record.title}</span>
        {sub && (
          <span className="type-body-small max-w-full truncate text-on-surface-variant">{sub}</span>
        )}
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {states.map(({ todo, done, disabled: todoDisabled }) => {
          // 押せるのに未対応なものだけを目立たせる。押せない項目（終了日前の事後登録）は
          // 目立たせても押すものが増えないため、淡いままにする。畳んだ先の記録（later）でも
          // 押すことはできるが、赤で押し出すのはいま片付けるものの側だけにする（issue #571）。
          // 未対応であることはチェックの外れた枠が示しており、色を足さなくても読める。
          const needsAttention = tone === "due" && !done && !todoDisabled;
          return (
            <label
              key={todo}
              className={cn(
                "flex items-center gap-2 rounded-full px-2 py-1 transition-colors",
                needsAttention && "bg-error-container",
                !todoDisabled && !writeDisabled && "cursor-pointer",
              )}
            >
              <Checkbox
                checked={done}
                disabled={writeDisabled || todoDisabled}
                onCheckedChange={(next) => onToggle(record, todo, next === true)}
              />
              <span
                className={cn(
                  "type-label-medium whitespace-nowrap",
                  needsAttention && "font-bold text-on-error-container",
                  todoDisabled && "text-on-surface-variant",
                )}
              >
                {WORK_TODO_LABELS[todo]}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** 月間集計の項目名。時間休だけは日ではなく時間で数えるため、年休とは別の項目にする。 */
const HOURLY_LEAVE_TALLY = "時間休";

/**
 * その月に何日ずつどこで働いたか。勤務場所ごとに数える。
 *
 * 半休の日は年休に 0.5 日、残り半日の勤務場所に 0.5 日を足す。勤怠の提出で見るのはこの数字
 * そのもので、半休を1日として数えると使えないため。
 *
 * **時間休の日は勤務場所に1日を数え、時間休は「時間」で別に足す**（issue #537）。半休と同じ
 * 按分（`1 - leave`）を当てると勤務場所が「18.6日 在宅」になるが、3時間休を取っても出勤した
 * 日は1日で、勤怠の提出で見る出勤日数は変わらない。日数へ換算して年休へ足し込むと、月の集計に
 * 0.4 日のような数字が現れる。
 */
function Tally({ records, days }: { records: WorkRecordItem[]; days: string[] }) {
  const counts = new Map<string, number>();
  const add = (name: string, days: number) => counts.set(name, (counts.get(name) ?? 0) + days);

  for (const dateKey of days) {
    const record = records.find((item) => coversDate(item, dateKey));
    if (!record) continue;

    if (record.companyHoliday) {
      add(HOLIDAY_TITLE, 1);
      continue;
    }
    if (record.annualLeave) {
      const hours = annualLeaveHours(record.annualLeave);
      if (hours !== null) {
        add(HOURLY_LEAVE_TALLY, hours);
        if (record.place) add(record.place, 1);
        continue;
      }
      const leave = annualLeaveDays(record.annualLeave);
      add("年休", leave);
      if (leave < 1 && record.place) add(record.place, 1 - leave);
      continue;
    }
    add(record.businessTrip ? "出張" : (record.place ?? "その他"), 1);
  }

  if (counts.size === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-1">
      {[...counts.entries()].map(([name, count]) => (
        <span key={name} className="type-body-small text-on-surface-variant">
          <b className="type-title-small mr-1 tabular-nums text-on-surface">
            {name === HOURLY_LEAVE_TALLY ? formatLeaveHours(count) : formatDays(count)}
          </b>
          {name}
        </span>
      ))}
    </div>
  );
}

// --- 表示のための小さな関数 ---

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function dayLabel(dateKey: string): string {
  return `${Number(dateKey.slice(8, 10))}(${WEEKDAYS[weekdayOf(dateKey)]})`;
}

/**
 * 日付の文字色。日曜と祝日は赤、土曜は青にする。
 *
 * 祝日を日曜と同じ色にするのは、勤務場所を入れるときに見ているのが曜日ではなく
 * 「その日が働く日かどうか」のため。月曜が祝日で灰色のままだと、入れ忘れなのか
 * そもそも働いていない日なのかが一覧から読めない。
 *
 * 色はカレンダー画面と同じ `dayTone()` から採る（issue #582）。ここで別のロール
 * （`error` / `travel`）を当てていたため、同じ日がカレンダーでは赤・青、この一覧では
 * 色なし・緑という状態になっていた（`--color-error` が `@theme` に無く `text-error` が
 * 捨てられていた／`travel` は青緑）。
 */
function dateClass(dateKey: string): string {
  return dayTone(dateKey) ?? "text-on-surface-variant";
}

function spanLabel(record: WorkRecordItem): string {
  const short = (dateKey: string) => `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;
  return record.startDate === record.endDate
    ? short(record.startDate)
    : `${short(record.startDate)} – ${short(record.endDate)}`;
}

function daysOfMonth(monthKey: string): string[] {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from(
    { length: lastDay },
    (_, index) => `${monthKey}-${String(index + 1).padStart(2, "0")}`,
  );
}

function shiftMonth(monthKey: string, delta: number): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 一覧の1行に出す文字列。
 *
 * 年休は区分（全休・午前半休）まで出し、半休なら残り半日の勤務場所を添える。「年休」だけでは
 * 丸一日休むのか半日働くのかが読めず、月の集計の 0.5 日と行の見え方が食い違う。
 * 休み（会社休業日）は名称（「夏季休業」）まで出す。
 */
function recordLabel(record: WorkRecordItem): string {
  // 名称（「夏季休業」）を入れずに登録すると、タイトルにも種類の名前がそのまま入る。
  // そのときに「休み（休み）」と出さない（以前の既定タイトル「会社休業日」で保存済みの
  // 記録も同じく名称なし扱いにする・issue #536）。
  if (record.companyHoliday) {
    return record.title && !isDefaultHolidayTitle(record.title)
      ? `${HOLIDAY_TITLE}（${record.title}）`
      : HOLIDAY_TITLE;
  }
  if (record.annualLeave) {
    const suffix = isPartialLeave(record.annualLeave) && record.place ? `・${record.place}` : "";
    return `年休（${record.annualLeave}）${suffix}`;
  }
  if (record.businessTrip) return `出張・${record.title}`;
  return record.place ?? record.title;
}
