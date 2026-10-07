"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { useState, useTransition } from "react";
import { Clock3, Moon, Settings2, Square, Timer } from "lucide-react";

import { invalidEnd, invalidStartAt, savedRangeLabel } from "@/components/activity/activity-time";
import { formatElapsed } from "@/components/calendar/activity-format";
import { DateTimeInput } from "@/components/calendar/date-time-input";
import { isoToLocalInput, localInputToIso } from "@/components/calendar/datetime-fields";
import { useNowIso, useSecondNowIso } from "@/components/calendar/use-clock";
import { AppMenuButton } from "@/components/nav/app-drawer";
import { AppFrame } from "@/components/nav/app-frame";
import { BottomNav } from "@/components/nav/main-nav";
import { OfflineNotice } from "@/components/offline/offline-notice";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LinearProgress } from "@/components/ui/linear-progress";
import { ACTIVITY_ICONS, resolveActivityIcon } from "@/lib/activity-icons";
import { submitActivityOp, type SubmitInput, type SubmitResult } from "@/lib/activity-queue/flush";
import { useEffectiveRunning } from "@/lib/activity-queue/use-effective-running";
import type { ActivityPresetItem, RunningActivityItem } from "@/types/activity";

/**
 * 活動記録の画面（docs/spec.md §27）。
 *
 * いましていることを押して記録を始め、止めた時点までをGoogle Calendarの予定にする。
 * カレンダーの中ではなく独立した画面にしてあるのは、記録を始める・終えるのが
 * 「いま」その瞬間の操作で、カレンダーのどの期間を見ているかとは関係が無いため。
 */
export function ActivityScreen({
  presets,
  initialRunning,
  timeZone,
}: {
  presets: ActivityPresetItem[];
  initialRunning: RunningActivityItem | null;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // 記録の開始・停止はオフラインでも受け付け、端末にためて通信が戻ったときに同期する
  // （issue #974・docs/spec.md §21）。ほかの書き込みと違い、ここだけは止めない。
  const offline = useOffline();
  useReconnectRefresh();

  // オフラインでこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  // ナビからの移動はソフトナビゲーションで、Service Worker が保存できないため。
  useWarmOfflinePage("/activity");

  // サーバーから受け取った記録。まだ届いていない操作は useEffectiveRunning が重ねる。
  const [serverRunning, setRunning] = useState(initialRunning);
  const running = useEffectiveRunning(serverRunning);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  // 開始時刻の修正欄。押し忘れて後から気付くほうが多いため、記録中でも直せるようにする。
  const [editingStart, setEditingStart] = useState(false);
  const [startInput, setStartInput] = useState("");

  // 終了時刻を指定して止めるときの欄。止め忘れに気付いてから止めるための経路で、
  // 押した時点で止める「停止して保存」はそのまま残す。
  const [editingEnd, setEditingEnd] = useState(false);
  const [endInput, setEndInput] = useState("");

  /*
    欄の初期値（「いま」）は端末の時計で作る一方、未来かどうかを決めるのはサーバーの時計。
    端末が1〜2分進んでいると、何も直さずに押しただけで「未来の時刻」として断られる。
    直していないなら時刻を添えずに送り、従来どおりサーバーの時計で決めさせる。
  */
  const [startAtTouched, setStartAtTouched] = useState(false);
  const [endTouched, setEndTouched] = useState(false);

  // 開始時刻を指定して始めるときの欄。開いている間だけ、押した項目がこの時刻から始まる。
  // 常に出しておかないのは、記録を始める操作が押す回数のいちばん多い操作で、
  // 毎回時刻を確かめさせると、そのぶん記録そのものが遅れるため（docs/spec.md §27）。
  const [startAtOpen, setStartAtOpen] = useState(false);
  const [startAtInput, setStartAtInput] = useState("");

  const nowIso = useNowIso();

  // 開始・停止は画面側で先に反映するが、正はサーバーにある（別の端末で止めることもある）。
  // 取り直しでサーバーの値が変わったら、そちらへ戻す。
  const serverRunningKey = runningKey(initialRunning);
  const [knownRunningKey, setKnownRunningKey] = useState(serverRunningKey);
  if (knownRunningKey !== serverRunningKey) {
    setKnownRunningKey(serverRunningKey);
    setRunning(initialRunning);
  }

  /**
   * 記録の操作を受け付ける。オンラインならその場で送り、オフライン・通信の失敗ならためる。
   * 失敗の理由は画面へ出し、null を返す。
   */
  const submit = async (input: SubmitInput, fallback: string): Promise<SubmitResult | null> => {
    setBusy(true);
    setError(null);
    try {
      const result = await submitActivityOp(input, serverRunning, offline);
      if (result.status === "error") {
        setError(result.message || fallback);
        return null;
      }
      return result;
    } catch {
      setError(fallback);
      return null;
    } finally {
      setBusy(false);
    }
  };

  /**
   * 記録を始める。すでに記録中なら、そこまでを予定にしてから切り替わる。
   * 予定ができた場合はカレンダー側も古くなるため、サーバーから取り直させる。
   */
  const start = async (body: { presetId?: string; title?: string }) => {
    // 時刻の欄を開いて、実際に直したときだけその時刻を添える。閉じているあいだと
    // 初期値のままのときはサーバーの時計で決める（端末の時計のずれを、記録した
    // 時間帯そのもののずれにしないため）。
    const at =
      startAtOpen && startAtTouched && startAtInput
        ? localInputToIso(startAtInput, timeZone)
        : undefined;
    const name =
      body.title ?? presets.find((preset) => preset.id === body.presetId)?.name ?? "";

    const result = await submit(
      { kind: "start", presetId: body.presetId, title: name, at },
      "記録を開始できませんでした。",
    );
    if (!result) return;

    if (result.status === "done") setRunning(result.running ?? null);
    setTitle("");
    // 指定は1回ぶん。開いたままにすると、次に押した項目まで気付かないうちに
    // 過去の時刻から始まる。
    setStartAtOpen(false);
    startTransition(() => router.refresh());
  };

  /** 記録を止める。時刻を渡さなければ、サーバーがその時点で止める。 */
  const stop = async (endedAt?: string) => {
    const result = await submit({ kind: "stop", at: endedAt }, "記録を保存できませんでした。");
    if (!result) return;

    if (result.status === "done") setRunning(null);
    setEditingEnd(false);
    startTransition(() => router.refresh());
  };

  const discard = async () => {
    // 予定にせず捨てるため、押し間違えると記録した時間が戻らない。実行の前に確認する。
    const confirmed = window.confirm(
      `「${running?.title}」の記録を取り消します。\nカレンダーには保存されません。よろしいですか？`,
    );
    if (!confirmed) return;

    const result = await submit({ kind: "discard" }, "記録を取り消せませんでした。");
    if (!result) return;

    if (result.status === "done") setRunning(null);
    startTransition(() => router.refresh());
  };

  const saveStart = async () => {
    if (!startInput) return;

    const result = await submit(
      { kind: "updateStart", startedAt: localInputToIso(startInput, timeZone) },
      "開始時刻を変更できませんでした。",
    );
    if (!result) return;

    if (result.status === "done" && result.running) setRunning(result.running);
    setEditingStart(false);
    startTransition(() => router.refresh());
  };

  const beginEditStart = () => {
    if (!running) return;
    setStartInput(isoToLocalInput(running.startedAt, timeZone));
    // 開始と終了の欄を同時に出すと、どちらの日時を触っているのか読めなくなる。
    setEditingEnd(false);
    setEditingStart(true);
  };

  /** 終了時刻を指定して止める欄を開く。初期値は「いま」で、直さずに押せば停止と同じ結果になる。 */
  const beginEditEnd = () => {
    if (!running) return;
    setEndInput(isoToLocalInput(nowIso ?? new Date().toISOString(), timeZone));
    setEndTouched(false);
    setEditingStart(false);
    setEditingEnd(true);
  };

  const toggleStartAt = () => {
    if (startAtOpen) {
      setStartAtOpen(false);
      return;
    }
    setStartAtInput(isoToLocalInput(nowIso ?? new Date().toISOString(), timeZone));
    setStartAtTouched(false);
    setStartAtOpen(true);
  };

  // 現在時刻も入力欄と同じ分単位に落として比べる（useNowIso は分の頭で止まっている）。
  const nowInput = nowIso ? isoToLocalInput(nowIso, timeZone) : null;

  // 押す前に断れるものはここで断る。サーバー側でも同じ判定を行うが、押してから
  // 往復ぶん待たせて断ると、どの欄が悪いのかを確かめるまでが遠くなる。
  const startAtInvalid = startAtOpen
    ? invalidStartAt(startAtInput, nowInput, running, timeZone)
    : null;

  const disabled = busy;
  const startDisabled = disabled || startAtInvalid !== null;

  return (
    // 記録中のカードは本文にあるため、サイドバーの下端には出さない（記録中の帯を出さないのと同じ）。
    <AppFrame current="activity" activityRunning={running !== null}>
      <header className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
        {/* 768px未満は左上をメニューにする（issue #328・#463）。768px以上は左端のサイドバーから
            画面を移る（issue #636）。 */}
        <AppMenuButton current="activity" activityRunning={running !== null} />
        {/* いまどの画面にいるかは、ヘッダーのナビが無くなったぶんここで示す（issue #463）。
            狭い画面では下部ナビが同じことを示すため、PCだけに出す。 */}
        <div className="hidden shrink-0 items-center gap-1.5 font-semibold md:flex">
          <Timer className="size-5" />
          <span>記録</span>
        </div>

        <span className="flex-1" />

        {/* 睡眠は日をまたぐため、時間グリッドでは0時で切り詰められて2本の帯に割れる。
            何時間眠ったかを読むための面は別に置く（docs/spec.md §39）。 */}
        <Button variant="ghost" size="sm" asChild>
          <Link href="/activity/sleep">
            <Moon className="size-4" />
            <span className="hidden sm:inline">睡眠</span>
          </Link>
        </Button>

        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings/activities">
            <Settings2 className="size-4" />
            <span className="hidden sm:inline">項目を編集</span>
          </Link>
        </Button>
      </header>

      <LinearProgress active={pending || busy} />

      <OfflineNotice />

      {error && (
        <div className="bg-error-container/70 px-3 py-2 text-xs text-on-error-container">{error}</div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/*
          広い画面では、経過時間のカードを左に据えたまま右で項目を押す（issue #636）。
          この画面を開く理由のほとんどは「どれくらい経ったか」と「止めること」で、項目を探して
          下へ動かしてもカードが視界から外れないようにする。右の3つを1つの箱にまとめないのは、
          狭い画面の縦の並び（gap-4）を変えないため。左のカードが右の合計より高いときに、
          右の行の間が空かないよう最後の行を 1fr にしてそこで余りを受ける。
        */}
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 @4xl/main:grid @4xl/main:max-w-6xl @4xl/main:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @4xl/main:grid-rows-[auto_auto_1fr] @4xl/main:items-start @4xl/main:gap-6 @4xl/main:p-6">
          <div className="@4xl/main:sticky @4xl/main:top-0 @4xl/main:row-span-3">
            {running ? (
              <RunningCard
                running={running}
                timeZone={timeZone}
                disabled={disabled}
                editingStart={editingStart}
                startInput={startInput}
                onStartInputChange={setStartInput}
                onBeginEditStart={beginEditStart}
                onCancelEditStart={() => setEditingStart(false)}
                onSaveStart={saveStart}
                editingEnd={editingEnd}
                endInput={endInput}
                endTouched={endTouched}
                nowInput={nowInput}
                onEndInputChange={(value) => {
                  setEndInput(value);
                  setEndTouched(true);
                }}
                onBeginEditEnd={beginEditEnd}
                onCancelEditEnd={() => setEditingEnd(false)}
                onStop={stop}
                onDiscard={discard}
              />
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center gap-1 py-8 text-center">
                  <Timer className="size-8 text-on-surface-variant" />
                  <p className="type-title-medium">いま記録しているものはありません</p>
                  <p className="type-body-small text-on-surface-variant">
                    {/* 広い画面では項目は右に並ぶ。「下から」のままだと押す場所を探させる。 */}
                    <span className="@4xl/main:hidden">下から</span>
                    <span className="hidden @4xl/main:inline">右から</span>
                    項目を押すと、その時点から記録が始まります。
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="@container/start flex flex-col gap-2 @4xl/main:col-start-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="type-title-small text-on-surface-variant">
                {running ? "切り替える" : "記録を始める"}
              </h2>
              {/* 時刻を確かめるのは押し忘れたときだけ。常に欄を出すと、いちばん多い
                  「いま押して始める」操作が毎回そのぶん遅くなる。 */}
              <Button
                variant={startAtOpen ? "secondary" : "ghost"}
                size="sm"
                disabled={disabled}
                onClick={toggleStartAt}
              >
                <Clock3 className="size-4" />
                開始時刻を指定
              </Button>
            </div>

            {startAtOpen && (
              <div className="flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-low p-3">
                <DateTimeInput
                  id="activity-start-at"
                  dateLabel="開始日"
                  timeLabel="開始時刻"
                  value={startAtInput}
                  onChange={(value) => {
                    setStartAtInput(value);
                    setStartAtTouched(true);
                  }}
                />
                {startAtInvalid ? (
                  <p className="type-body-small text-destructive">{startAtInvalid}</p>
                ) : (
                  <p className="type-body-small text-on-surface-variant">
                    押した項目を {startAtInput.replace("T", " ")} から記録します。
                    {/* 切り替えでは前の記録の終わりも同じ時刻になる。記録の無い時間帯を
                        作らないための扱いだが、書かないと勝手に終わったように見える。 */}
                    {running && `記録中の「${running.title}」も同じ時刻で終わります。`}
                  </p>
                )}
              </div>
            )}

            {presets.length === 0 ? (
              <p className="type-body-medium text-on-surface-variant">
                項目がありません。「項目を編集」からよく記録するものを追加してください。
              </p>
            ) : (
              // 押す対象は指の幅で確保する。記録は歩きながら・作業を切り替えながら押すことが
              // 多く、狙って押さなければならない大きさだと、その場で押すのをやめてしまう。
              // 1段に並ぶ数は右の列の幅で増やす（issue #636）。768px未満では従来どおり2〜3列。
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:@lg/start:grid-cols-4">
                {presets.map((preset) => {
                  // 記録中の項目そのものを押しても、同じ内容で開始し直すだけになる。
                  const current = running?.title === preset.name;

                  return (
                    <Button
                      key={preset.id}
                      variant={current ? "secondary" : "outline"}
                      className="type-title-small h-16 justify-center rounded-lg px-3"
                      disabled={startDisabled || current}
                      onClick={() => start({ presetId: preset.id })}
                    >
                      <PresetIcon preset={preset} />
                      <span className="truncate">{preset.name}</span>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          {/*
            選択肢に無いことを1回だけ記録する欄。
            設定画面へ項目を足しに行かせると、いま始めたい記録がその間ずっと止まる。
          */}
          <div className="flex items-end gap-2 @4xl/main:col-start-2">
            {/* ラベル付きの入力欄は枠（fieldShell）が幅を持つため、伸ばすのは外側の箱にする。 */}
            <div className="min-w-0 flex-1">
              <Input
                id="activity-title"
                label="その他（1回だけ記録する）"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && title.trim() && !startDisabled) {
                    start({ title: title.trim() });
                  }
                }}
              />
            </div>
            <Button
              className="h-14 shrink-0"
              disabled={startDisabled || !title.trim()}
              onClick={() => start({ title: title.trim() })}
            >
              開始
            </Button>
          </div>

          <p className="type-body-small text-on-surface-variant @4xl/main:col-start-2">
            止めた時点までがGoogle Calendarの予定になります。保存先のカレンダーは「項目を編集」から選べます。
          </p>
        </div>
      </div>

      <BottomNav current="activity" activityRunning={running !== null} timeZone={timeZone} />
    </AppFrame>
  );
}

/**
 * 記録中の1件。経過時間をいちばん大きく出す。
 * この画面を開く理由のほとんどは「どれくらい経ったか」と「止めること」のため。
 */
function RunningCard({
  running,
  timeZone,
  disabled,
  editingStart,
  startInput,
  onStartInputChange,
  onBeginEditStart,
  onCancelEditStart,
  onSaveStart,
  editingEnd,
  endInput,
  endTouched,
  nowInput,
  onEndInputChange,
  onBeginEditEnd,
  onCancelEditEnd,
  onStop,
  onDiscard,
}: {
  running: RunningActivityItem;
  timeZone: string;
  disabled: boolean;
  editingStart: boolean;
  startInput: string;
  onStartInputChange: (value: string) => void;
  onBeginEditStart: () => void;
  onCancelEditStart: () => void;
  onSaveStart: () => void;
  editingEnd: boolean;
  endInput: string;
  /**
   * 終了時刻の欄を実際に直したか。直していないなら時刻を渡さず、サーバーの時計で止める
   * （端末の時計が進んでいるだけで「未来の時刻」として断られるのを避けるため）。
   */
  endTouched: boolean;
  /** 現在時刻を入力欄と同じ分単位にしたもの。未来を指定していないか比べるために使う。 */
  nowInput: string | null;
  onEndInputChange: (value: string) => void;
  onBeginEditEnd: () => void;
  onCancelEditEnd: () => void;
  onStop: (endedAt?: string) => void;
  onDiscard: () => void;
}) {
  const endInvalid = editingEnd ? invalidEnd(endInput, nowInput, running, timeZone) : null;
  // 経過時間だけ1秒刻みで進める（issue #1124）。他の表示は分単位のまま。
  const secondNowIso = useSecondNowIso();

  return (
    <Card className="bg-primary-container text-on-primary-container">
      <CardContent className="flex flex-col gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* 動いていることを形でも示す。色だけでは、止め忘れているかどうかが分からない。 */}
          <span aria-hidden className="size-2.5 shrink-0 animate-pulse rounded-full bg-primary" />
          <span className="type-title-medium clip-nowrap flex-1">{running.title}</span>
        </div>

        {/* この画面を開く理由のほとんどは「どれくらい経ったか」と「止めること」。
            経過時間は画面で最も大きい字にする（M3 Expressive へ更新したとき〈issue #705〉に
            display-small を足し、headline-small から上げた）。 */}
        {secondNowIso && (
          <div className="type-display-small tabular-nums">
            {formatElapsed(running.startedAt, secondNowIso, true)}
          </div>
        )}

        {editingStart ? (
          <div className="flex flex-col gap-2">
            <DateTimeInput
              id="activity-started-at"
              dateLabel="開始日"
              timeLabel="開始時刻"
              value={startInput}
              onChange={onStartInputChange}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={disabled} onClick={onCancelEditStart}>
                やめる
              </Button>
              <Button size="sm" disabled={disabled || !startInput} onClick={onSaveStart}>
                開始時刻を直す
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="type-body-medium">
              {isoToLocalInput(running.startedAt, timeZone).replace("T", " ")} から
            </span>
            {/* 押し忘れて後から始めることが多い。開始時刻をここで直せるようにする。 */}
            <Button variant="ghost" size="sm" disabled={disabled} onClick={onBeginEditStart}>
              開始時刻を直す
            </Button>
          </div>
        )}

        {editingEnd ? (
          <div className="flex flex-col gap-2">
            <DateTimeInput
              id="activity-ended-at"
              dateLabel="終了日"
              timeLabel="終了時刻"
              value={endInput}
              onChange={onEndInputChange}
            />
            {/* 保存される時間帯と長さを先に出す。指定するのは終わりの時刻だけで、
                結果として記録が何時間になるのかは、開始と見比べないと分からない。 */}
            <p className={`type-body-small ${endInvalid ? "text-destructive" : ""}`}>
              {endInvalid ?? savedRangeLabel(running.startedAt, endInput, timeZone)}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={disabled} onClick={onCancelEditEnd}>
                やめる
              </Button>
              <Button
                size="sm"
                disabled={disabled || endInvalid !== null}
                onClick={() => onStop(endTouched ? localInputToIso(endInput, timeZone) : undefined)}
              >
                この時刻で停止
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              {/* 押し間違えて始めた記録まで予定にすると、消しにいく手間のほうが大きい。 */}
              <Button variant="destructive" size="sm" disabled={disabled} onClick={onDiscard}>
                取り消す
              </Button>
              <Button size="lg" disabled={disabled} onClick={() => onStop()}>
                <Square className="fill-current" />
                停止して保存
              </Button>
            </div>
            {/* 止め忘れて後から気付くこともある。押した時点で止める道は上に残したまま、
                終わりの時刻を決めて止める道を足す。 */}
            <Button
              variant="ghost"
              size="sm"
              className="self-end"
              disabled={disabled}
              onClick={onBeginEditEnd}
            >
              <Clock3 className="size-4" />
              終了時刻を指定して停止
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 記録中の項目が同じものかを比べるための文字列。
 * サーバーから来る値は取り直しのたびに別のオブジェクトになるため、参照では比べられない。
 */
function runningKey(running: RunningActivityItem | null): string {
  return running ? `${running.title} ${running.startedAt}` : "";
}

/** 項目のアイコン（issue #907）。未設定で名前にも既定が無ければ何も出さない。 */
function PresetIcon({ preset }: { preset: ActivityPresetItem }) {
  const key = resolveActivityIcon(preset.name, preset.icon);
  if (!key) return null;

  const Icon = ACTIVITY_ICONS[key];
  return <Icon aria-hidden className="size-5 shrink-0" />;
}
