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
  Plus,
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
import { tagChipClass } from "@/components/tags/tag-color";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { WorkMonthData } from "@/types/work";
import { WorkRecordDialog, type WorkDraft } from "@/components/work/work-record-dialog";
import { shouldQueueWrite, submitWrite } from "@/lib/offline-queue/flush";
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
  isTripPlace,
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
}: Omit<WorkMonthScreenProps, "monthKey" | "onMonthChange"> & { monthKey: string }) {
  // 月送りはページ（RSC）の取り直しにしない。取り直しだと、オフライン・低速時に別の月が開けない
  // （issue #974）。月ごとの内容は GET /api/work/month から取り、Service Worker が保存済みへ倒す。
  const [monthKey, setMonthKey] = useState(initialMonthKey);

  const onMonthChange = useCallback((next: string) => {
    setMonthKey(next);
    // URLだけ合わせる。再読み込み・共有しても同じ月が開く。
    window.history.replaceState(null, "", `/work?month=${next}`);
  }, []);

  // 月が変わったら内部の状態（取得結果・開いたダイアログ）を作り直す。
  return <WorkMonthScreen key={monthKey} monthKey={monthKey} onMonthChange={onMonthChange} {...rest} />;
}

type WorkMonthScreenProps = {
  /** YYYY-MM */
  monthKey: string;
  onMonthChange: (monthKey: string) => void;
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
  const todayRecord = records.find((record) => coversDate(record, todayKey)) ?? null;
  const showsToday = todayKey.slice(0, 7) === monthKey;

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

  /**
   * 今日の記録をチップから直せるか。
   *
   * 場所から出張になった単日の記録（行き先＝場所名）は、もう一度押して取り消せる必要がある。
   * 1押しで登録したものを1押しで戻せないと、消すためだけに日の行から入り直すことになる。
   * 手で作った出張は行き先が場所名と違う・複数日にまたがるため、チップで上書きすると
   * 行き先や期間が消える。年休・会社休業日は場所と無関係に決められたものなので、日別の
   * 一覧の行から直す。
   */
  const todayEditableByChip =
    !todayRecord?.annualLeave &&
    !todayRecord?.companyHoliday &&
    (!todayRecord?.businessTrip ||
      (todayRecord.startDate === todayRecord.endDate &&
        todayRecord.title === todayRecord.place &&
        isTripPlace(tripPlaces, todayRecord.place)));

  /**
   * 今日の勤務場所を1押しで決める。
   *
   * すでに同じ場所が入っているときは取り消す。押した先が変わらない操作を残すより、
   * 押し間違えたときに同じ場所をもう一度押せば戻せるほうが道が短い。
   *
   * 出張扱いの場所（docs/spec.md §34）はその場で出張として登録する。出張かどうかは毎回
   * 明示して送る。送らないとNotion側の既存のチェックが残り、出張扱いでない場所へ変えても
   * 出張のままになる。
   */
  const pickToday = async (place: string) => {
    if (!todayEditableByChip) return;

    // オフライン中・先にためた操作があるときは、意図（日付と場所）だけをためる。送信時にその日の
    // 記録を引き直して、取り消し・変更・新規を選ぶ（issue #1135）。キャッシュ上の記録は古いことがある。
    if (shouldQueueWrite(offline)) {
      setError(null);
      submitWrite({
        kind: "workToday",
        date: todayKey,
        place: todayRecord && todayRecord.place === place ? null : place,
        ...(capabilities.businessTrip ? { businessTrip: isTripPlace(tripPlaces, place) } : {}),
      });
      return;
    }

    const trip = capabilities.businessTrip
      ? { businessTrip: isTripPlace(tripPlaces, place) }
      : {};

    if (todayRecord && todayRecord.place === place) {
      await send(
        `/api/work/records/${todayRecord.id}`,
        { method: "DELETE" },
        "勤務場所を取り消せませんでした。",
      );
      return;
    }

    if (todayRecord) {
      await send(
        `/api/work/records/${todayRecord.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // 1押しは「その日まるごとこの場所」なので、時間帯の内訳があれば消す（issue #1155）。
          body: JSON.stringify({ place, title: place, ...trip, segments: [] }),
        },
        "勤務場所を変更できませんでした。",
      );
      return;
    }

    await send(
      "/api/work/records",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: todayKey, place, title: place, ...trip }),
      },
      "勤務場所を登録できませんでした。",
    );
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
    // 混ざって読めなくなる。休みとして明示的に記録したいときは、従来どおり「休みを追加」または
    // このダイアログの中でタブを切り替えて登録する。
    setDraft(
      existing
        ? { mode: "edit", record: existing }
        : { mode: "create", startDate: dateKey, kind: "work" },
    );
  };

  const monthLabel = `${monthKey.slice(0, 4)}年${Number(monthKey.slice(5, 7))}月`;
  // 上部の2つの区画に出すのは、手続きが残っている記録だけ（docs/spec.md §34）。済んだものを
  // 月のあいだ残すと、いま手を打つべきものがその中に埋もれる。出張の前の事後登録も同じ理由で
  // 落ちる（`workTodos()` が終了日を過ぎるまで数えないため、判定を二重に持たなくてよい）。
  // 済んだ記録を直したくなったときは、下の日別の一覧から入力ダイアログを開く（issue #412）。
  //
  // 並べるのは「いま片付けるもの」だけで、1週間より先の事前申請は畳んでおく（issue #571）。
  // 事前申請は先の予定にも付くため、絞り込まないと、まだ申請しなくてよい先の出張・年休が
  // 同じ枠へ積み上がり、期限が迫っている事前申請・終わった出張の事後登録がその中に埋もれる。
  // 見出しの件数は総数のまま（ドロワーのバッジが数えているのも総数で、片方だけ減ると同じ
  // 画面の中で数字が食い違う）。畳んだぶんの件数はボタンに出すので、総数＝表示中＋畳んだぶん
  // として読める。
  const trips = splitOpenWorkRecords(openTrips, todayKey);
  const leaves = splitOpenWorkRecords(openLeaves, todayKey);
  // 赤い件数が数えるのは「いま手を打つべき件数」（docs/spec.md §34）。畳んだぶんまで足すと、
  // 全件が先の予定の月に「未対応 3件」の直下へ「いま対応が必要な手続きはありません。」が並び、
  // 同じ見出しの中で意味が反対になる（issue #571 計画レビューG2の指摘）。畳んだぶんの件数は
  // 折りたたみのボタンが出すため、総数も画面から読める。ドロワーのバッジ（`/api/work/alerts`）は
  // 総数のままにする。あちらは「勤務の画面を開く理由があるか」を示すもので役割が違う。
  //
  // dueの記録の手続きは必ず全てdueになる。事後登録が未対応に数えられるのは終了日を過ぎた
  // ときだけ（`workTodos()`）で、そのとき開始日も当然過ぎており事前申請もdueになるため、
  // 「事後登録がdueで事前申請がlater」の組み合わせは起きない。
  const openTodos = trips.due.flatMap((trip) => workTodos(trip, todayKey));
  const openLeaveCount = leaves.due.length;
  // 出張・年休の区画を1つでも持つか。広い画面ではこの2つを左の列に、月の内容を右の列に置く。
  const hasProcedures = capabilities.approval || capabilities.annualLeave;

  return (
    <AppFrame current="work" activityRunning={runningActivity !== null} running={runningActivity}>
      <header className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
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
        {/*
          広い画面では「片付ける手続き（出張・年休）」を左、「この月」を右に分ける（issue #636）。
          縦に並べていたときは、月切替を2つの区画のあいだに置いて、上の手続きには月切替が
          効かないことを位置で示していた（issue #510）。左右に分ければ同じことが列で示せる。
        */}
        <div
          className={cn(
            "mx-auto flex w-full max-w-2xl flex-col gap-6 p-6",
            hasProcedures &&
              "@4xl/main:grid @4xl/main:max-w-6xl @4xl/main:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @4xl/main:items-start @4xl/main:gap-x-8",
          )}
        >
          {/* 書き込みの失敗を先に出す。押した操作の結果のほうが、開いた時点の取得の失敗より新しい。 */}
          {(error ?? loadError) && (
            <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container @4xl/main:col-span-full">
              {error ?? loadError}
            </p>
          )}

          {hasProcedures && (
            <div className="flex flex-col gap-6">
              {/* 出張。残っている手続きだけを出す。事前申請・事後登録のプロパティが無いDBでは片付ける
                  手続きそのものが持てないため、区画ごと出さない。 */}
              {capabilities.approval && (
                <section className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-2">
                    <h2 className="type-title-small">出張</h2>
                    {openTodos.length > 0 && (
                      <span className="type-label-medium flex items-center gap-1 text-error">
                        <CircleAlert className="size-3.5" />
                        未対応 {openTodos.length}件
                      </span>
                    )}
                  </div>

                  <OpenRecords
                    split={trips}
                    todayKey={todayKey}
                    todos={["preApplied", "postRegistered"]}
                    emptyLabel="未対応の手続きはありません。"
                    writeDisabled={busy || offline}
                    onToggle={toggleTodo}
                    onOpen={(record) => setDraft({ mode: "edit", record })}
                  />
                </section>
              )}

              {/* 年休。出張と同じ形にする。開く理由の多くは「まだ申請していないものを片付けること」で、
                  日別の一覧を上から探すのでは見つからないため。 */}
              {capabilities.annualLeave && (
                <section className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-2">
                    <h2 className="type-title-small">年休</h2>
                    {openLeaveCount > 0 && (
                      <span className="type-label-medium flex items-center gap-1 text-error">
                        <CircleAlert className="size-3.5" />
                        未申請 {openLeaveCount}件
                      </span>
                    )}
                    {/* 年度の取得状況（docs/spec.md §34）。あちらは「あと何日使えるか」を見る画面で、
                        この区画（残っている申請を片付ける）とは開く理由が違う。入口はここ1つにし、
                        ドロワーには行を足さない。 */}
                    <Link
                      href="/work/leave"
                      className="type-label-medium ml-auto text-primary underline"
                    >
                      年度の取得状況
                    </Link>
                  </div>

                  <OpenRecords
                    split={leaves}
                    todayKey={todayKey}
                    todos={["preApplied"]}
                    emptyLabel="未申請の年休はありません。"
                    writeDisabled={busy || offline}
                    onToggle={toggleTodo}
                    onOpen={(record) => setDraft({ mode: "edit", record })}
                  />
                </section>
              )}
            </div>
          )}

          {/* この月の勤務場所。今日のぶんだけは選択肢を並べ、1押しで決められるようにする。
              月切替はここへ添える（issue #510）。出張・年休の区画は月に限定されない情報のため、
              月切替をヘッダー直下に置くとそれらの区画にも効くように見えてしまう。月ごとの内容の
              直前に置くことで、上（出張・年休）と下（この月の勤務場所）の境目をはっきりさせる。 */}
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
              <h2 className="type-title-small tabular-nums">{monthLabel}の勤務場所</h2>
              <Button
                variant="ghost"
                size="sm"
                aria-label="次の月"
                onClick={() => onMonthChange(shiftMonth(monthKey, 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

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

            {showsToday && (
              <Card>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="type-label-large">今日の勤務場所</span>
                    <span className={cn("type-body-small ml-auto tabular-nums", dateClass(todayKey))}>
                      {dayLabel(todayKey)}
                      {japaneseHolidayName(todayKey) && (
                        <span className="ml-1">{japaneseHolidayName(todayKey)}</span>
                      )}
                    </span>
                  </div>

                  {/* 登録が無い土日祝は自動的に「休み」として扱う（表示だけで、Notionへは書き込まない・
                      docs/spec.md §34）。出社した場合は従来どおり下から勤務場所を選べる。 */}
                  {!todayRecord && isAutoOffDay(todayKey) && (
                    <p className="type-body-small text-on-surface-variant">
                      土日祝は自動的に「休み」として扱われます。出社した場合は下から勤務場所を選んでください。
                    </p>
                  )}

                  {!todayEditableByChip && todayRecord ? (
                    <p className="type-body-medium">
                      {recordLabel(todayRecord)}
                      <span className="type-body-small ml-2 text-on-surface-variant">
                        直すときは下の日付の一覧から
                      </span>
                    </p>
                  ) : !loaded ? (
                    <p className="type-body-small text-on-surface-variant">読み込んでいます…</p>
                  ) : placeOptions.length === 0 ? (
                    <p className="type-body-small text-on-surface-variant">
                      勤務場所の選択肢がありません。
                      <Link href="/settings/work" className="ml-1 underline">
                        設定 ▸ 勤務
                      </Link>
                      から追加してください。
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {placeOptions.map((option) => {
                        const selected = todayRecord?.place === option.name;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            disabled={busy || offline}
                            aria-pressed={selected}
                            onClick={() => pickToday(option.name)}
                            className={cn(
                              "type-label-large rounded-full border px-4 py-2 transition-colors disabled:opacity-38",
                              selected
                                ? cn("border-transparent font-bold", tagChipClass(option.color))
                                : "border-outline text-on-surface hover:bg-on-surface/8",
                            )}
                          >
                            {option.name}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* 場所から出張になったことは、押した本人にも見えている必要がある。
                      手続きの行き先を上の出張ではなく日別の一覧にするのは、この経路で作られるのが
                      単日の出張で、事前申請を済ませた時点で上の区画から消えるため（事後登録は
                      終了日を過ぎるまで未対応に数えない）。日別の一覧はいつ押しても同じ所へ着く。
                      一覧の行からは印が読めるだけになったため（issue #521）、押して開くことまで書く。 */}
                  {todayEditableByChip && todayRecord?.businessTrip && (
                    <p className="type-body-small text-travel">
                      この場所は出張扱いです。
                      {capabilities.approval && "事前申請・事後登録は下の日付の一覧の行を押して。"}
                    </p>
                  )}
                </CardContent>
              </Card>
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
                  // 手続きが未対応として並ぶことはない（判定は上の区画と同じ関数に任せる）。
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
                          揃わない。片付ける場所は上の出張・年休の区画と、行を押して開く入力
                          ダイアログに寄せる。色だけに意味を持たせないよう、上の区画の
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

            {/* 出張・年休・会社休業日は先の日付に入れるものが多い。日別の一覧をスクロールして
                押させるより、開いてから日付を選ばせるほうが短い。 */}
            {(capabilities.businessTrip || capabilities.annualLeave || capabilities.companyHoliday) && (
              <div
                className={cn(
                  "grid grid-cols-1 gap-2",
                  [capabilities.businessTrip, capabilities.annualLeave, capabilities.companyHoliday]
                    .filter(Boolean).length >= 3
                    ? "sm:grid-cols-3"
                    : "sm:grid-cols-2",
                )}
              >
                {capabilities.businessTrip && (
                  <Button
                    variant="outline"
                    disabled={offline}
                    onClick={() =>
                      setDraft({
                        mode: "create",
                        startDate: defaultDate(monthKey, todayKey),
                        kind: "trip",
                      })
                    }
                  >
                    <Plus className="size-4" />
                    出張を追加
                  </Button>
                )}
                {capabilities.annualLeave && (
                  <Button
                    variant="outline"
                    disabled={offline}
                    onClick={() =>
                      setDraft({
                        mode: "create",
                        startDate: defaultDate(monthKey, todayKey),
                        kind: "leave",
                      })
                    }
                  >
                    <Plus className="size-4" />
                    年休を追加
                  </Button>
                )}
                {capabilities.companyHoliday && (
                  <Button
                    variant="outline"
                    disabled={offline}
                    onClick={() =>
                      setDraft({
                        mode: "create",
                        startDate: defaultDate(monthKey, todayKey),
                        kind: "holiday",
                      })
                    }
                  >
                    <Plus className="size-4" />
                    休みを追加
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <RunningActivityBar running={runningActivity} />
      <BottomNav current="work" activityRunning={runningActivity !== null} timeZone={timeZone} />

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

/** 追加を押したときの初期の日付。表示中の月に今日があればその日、無ければ月の初日。 */
function defaultDate(monthKey: string, todayKey: string): string {
  return todayKey.slice(0, 7) === monthKey ? todayKey : `${monthKey}-01`;
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
