"use client";

import { useEffect, useState } from "react";
import { useOffline } from "next/offline";
import { Trash2 } from "lucide-react";

import { readErrorMessage } from "@/components/calendar/response-error";
import { ItemFormActions } from "@/components/calendar/item-form-actions";
import { describeSync, type SyncSummary } from "@/lib/work-sync/message";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { tagChipClass } from "@/components/tags/tag-color";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isTextInput } from "@/lib/text-input";
import { cn } from "@/lib/utils";
import {
  ANNUAL_LEAVE_OPTIONS,
  HOURLY_LEAVE_LABEL,
  hourlyLeaveName,
  maxHourlyLeaveHours,
} from "@/services/notion/work-database";
import type { TagOption } from "@/services/notion/tag-options";
import {
  annualLeaveHours,
  DEFAULT_WORK_MINUTES_PER_DAY,
  HOLIDAY_TITLE,
  isDefaultHolidayTitle,
  isPartialLeave,
  isTripPlace,
  normalizeWorkMinutes,
  WORK_TODO_LABELS,
  type WorkCapabilities,
  type WorkRecordItem,
} from "@/types/work";

/** 記録の種類。同時には立てられないため、スイッチではなく択一で持つ。 */
export type WorkKind = "work" | "trip" | "leave" | "holiday";

/**
 * 並びに出す名前。
 *
 * 会社休業日は画面では「休み」と呼ぶ。日別の一覧・今日カードでは、登録の無い土日祝を
 * 「休み」と表示している（docs/spec.md §34、issue #510）。そこから開いたこのタブが
 * 別の言葉だと、同じ状態を指す表記が揺れて分かりにくい（issue #522・#536）。
 * ダイアログの見出しも同じ「休み」を使うため（issue #536）、種類ごとに見出しを
 * 出し分ける必要はなく、この並びの名前をそのまま見出しにも使う。
 */
const KIND_LABELS: Record<WorkKind, string> = {
  work: "勤務",
  trip: "出張",
  leave: "年休",
  holiday: "休み",
};

/** 開くときに渡す下書き。新規はその日から、編集は既存の記録から始める。 */
export type WorkDraft =
  | { mode: "create"; startDate: string; kind: WorkKind }
  | { mode: "edit"; record: WorkRecordItem };

function kindOf(record: WorkRecordItem): WorkKind {
  if (record.companyHoliday) return "holiday";
  if (record.annualLeave) return "leave";
  return record.businessTrip ? "trip" : "work";
}

/**
 * 勤務場所・出張・年休・会社休業日の入力（docs/spec.md §34）。
 *
 * どれも1つのダイアログの中で切り替える。押す前に種類を決めさせると、入力の途中で違うと
 * 気付いたときに閉じて選び直すことになるため（追加UIと同じ考え方）。スイッチを種類の数だけ
 * 並べないのは、同時に立てられないものが並ぶと、どれを消せばよいのかが画面から読めないため。
 */
export function WorkRecordDialog({
  draft,
  placeOptions,
  tripPlaces,
  capabilities,
  todayKey,
  workMinutesPerDay = DEFAULT_WORK_MINUTES_PER_DAY,
  onClose,
  onSaved,
}: {
  draft: WorkDraft;
  placeOptions: TagOption[];
  /** 出張扱いにする勤務場所の名前（docs/spec.md §34）。 */
  tripPlaces: string[];
  capabilities: WorkCapabilities;
  /** 事後登録が押せるかどうかの判定に使う（終了日を過ぎるまでは押せない。issue #509）。 */
  todayKey: string;
  /** 1日の所定労働時間（分）。時間休として選べる時間数の上限を決める（issue #537）。 */
  workMinutesPerDay?: number;
  onClose: () => void;
  /** 勤務予定・移動の同期で知らせることがあれば、その文面を渡す。 */
  onSaved: (syncNote?: string | null) => void;
}) {
  const existing = draft.mode === "edit" ? draft.record : null;

  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // 新規のときの種類はdraftの指定どおり。ここで場所から出張の既定を立てると、
  // 日の行を押しただけの下書きが出張として開くことがある。出張扱い（docs/spec.md §34）が
  // 効くのは、場所のチップを押して選んだときだけにする。
  const [kind, setKind] = useState<WorkKind>(
    draft.mode === "edit" ? kindOf(draft.record) : draft.kind,
  );

  // 勤務タブでは、出張扱いの場所（門真・出張）を出さない。行けば必ず出張になる場所を
  // 通常の勤務として登録できると、出張のはずの日が勤務として集計される（issue #525）。
  // 年休・会社休業日のタブでは絞り込まない（半休の残り半日の勤務場所は勤務タブと同じ
  // 選択肢を出す必要がある。docs/spec.md §34）。出張タブは勤務場所そのものを出さない
  // （issue #549）。
  const workPlaceOptions =
    kind === "work"
      ? placeOptions.filter((option) => !isTripPlace(tripPlaces, option.name))
      : placeOptions;

  const [place, setPlace] = useState(existing?.place ?? workPlaceOptions[0]?.name ?? "");
  // 時間休だけは1つの選択肢名ではなく族（`1時間休`〜`7時間休`）なので、区分と時間数を
  // 別の状態で持ち、保存する値を `hourlyLeaveName()` で組み立てる（issue #537）。
  //
  // 区分は4択の enum ではなく**文字列そのもの**で持ち続ける。Notionで直接付けた「特別年休」の
  // ような、どのチップにも当たらない名前は、どれも選ばれていない状態で開いてそのまま保存される
  // （4択へ移すとその値の置き場が無くなり、開いて何も直さずに保存しただけで別の区分へ黙って
  // 書き換わる・計画レビューG1の指摘）。数え方も従来どおりで、丸一日として数える。
  const existingLeaveHours = annualLeaveHours(existing?.annualLeave ?? null);
  const [leaveKind, setLeaveKind] = useState<string>(
    existingLeaveHours !== null
      ? HOURLY_LEAVE_LABEL
      : (existing?.annualLeave ?? ANNUAL_LEAVE_OPTIONS[0].name),
  );
  const [leaveHours, setLeaveHours] = useState<number>(existingLeaveHours ?? 1);
  const [destination, setDestination] = useState(existing?.businessTrip ? existing.title : "");
  // 会社休業日の名称（「夏季休業」）。空のままでも登録できる（既定は「休み」）。
  // 名称を入れずに登録した記録はタイトルが既定のままなので、空欄として開く
  // （以前の既定タイトル「会社休業日」で保存済みの記録も名称なし扱いにする・issue #536）。
  // 名称を入れずに保存すると、save()が組み立てるタイトルは常にHOLIDAY_TITLE（「休み」）になる。
  // 旧既定タイトル「会社休業日」の記録を開いて（何も直さずに）保存しただけでも、Notion上の
  // タイトルが「休み」へ書き換わる。統一を進める意図した挙動として許容する（issue #536
  // 計画レビューG1の指摘）。
  const [holidayName, setHolidayName] = useState(
    existing?.companyHoliday && !isDefaultHolidayTitle(existing.title) ? existing.title : "",
  );

  const [startDate, setStartDate] = useState(
    draft.mode === "edit" ? draft.record.startDate : draft.startDate,
  );
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");
  const [memo, setMemo] = useState(existing?.memo ?? "");
  const [preApplied, setPreApplied] = useState(existing?.preApplied ?? false);
  const [postRegistered, setPostRegistered] = useState(existing?.postRegistered ?? false);

  const offline = useOffline();

  const businessTrip = kind === "trip";
  const isLeave = kind === "leave";
  const isHoliday = kind === "holiday";

  const [recentDestinations, setRecentDestinations] = useState<string[]>([]);
  // 出張タブを開いたときにだけ読む。`/work`のレンダーに含めると、月送り・今日のチップの
  // 1押し・保存後の再取得のたびに往復が増える（未対応の件数をドロワーを開いたときにだけ
  // 読むのと同じ扱い・issue #525 計画レビュー指摘）。一度取れたら開いている間は取り直さない。
  useEffect(() => {
    if (!businessTrip || recentDestinations.length > 0) return;
    let cancelled = false;
    fetch("/api/work/recent-destinations")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { destinations?: unknown } | null) => {
        if (!cancelled && data && Array.isArray(data.destinations)) {
          setRecentDestinations(data.destinations.filter((name): name is string => typeof name === "string"));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessTrip]);
  // 事後登録は出張の翌日以降にしかできない。「終了日」欄の表示値と同じ式で判定する
  // （既にtrueなら取り消して直せるようdisabledにしない・issue #509）。
  const postRegisterDisabled = !postRegistered && !((endDate || startDate) < todayKey);
  // 区分に保存する値。時間休だけは時間数を名前へ含める（`3時間休`・issue #537）。
  const hourlyLeave = leaveKind === HOURLY_LEAVE_LABEL;
  const annualLeave = hourlyLeave ? hourlyLeaveName(leaveHours) : leaveKind;
  // 時間休として選べる上限。所定労働時間ぶん取れば全休と同じで、区分を分ける意味が無い。
  const hourChoices = Array.from(
    { length: maxHourlyLeaveHours(normalizeWorkMinutes(workMinutesPerDay)) },
    (_, index) => index + 1,
  );
  // 半休・時間休の日は残りをどこで働いたかも要る（勤怠の提出で使う）。全休の日は入る値が無い。
  const partialDay = isLeave && isPartialLeave(annualLeave);
  // 期間を持てるのは出張・全休の年休・会社休業日。半休・時間休は単日に限る（半日ずつ2日ぶん
  // という形が無い）。会社休業日はお盆・年末年始のように続くため、出張と同じく期間で1件にする。
  const spanned = businessTrip || (isLeave && !partialDay) || isHoliday;
  /** 残りの勤務場所の呼び方。半休は半日、時間休は残りの時間ぶん。 */
  const restPlaceLabel = hourlyLeave ? "残りの勤務場所" : "残り半日の勤務場所";
  // 使える種類だけを出す。揃っていないプロパティの種類を出すと、押しても保存されない道が残る。
  const kinds: WorkKind[] = [
    "work",
    ...(capabilities.businessTrip ? (["trip"] as const) : []),
    ...(capabilities.annualLeave ? (["leave"] as const) : []),
    ...(capabilities.companyHoliday ? (["holiday"] as const) : []),
  ];

  /** 種類を手で選ぶ。 */
  const chooseKind = (next: WorkKind) => {
    setKind(next);
    // 勤務タブへ切り替えたとき、選ばれている場所が出張扱いのままだと、勤務タブのチップは
    // どれも選ばれていないのに保存するとその場所のまま記録されてしまう（issue #525 計画
    // レビュー指摘）。絞り込んだ一覧の先頭へ寄せる（無ければ空にする）。
    if (next === "work" && isTripPlace(tripPlaces, place)) {
      const fallback = placeOptions.find((option) => !isTripPlace(tripPlaces, option.name));
      setPlace(fallback?.name ?? "");
    }
  };

  // 事前申請のcheckboxは出張と年休で共用している（docs/spec.md §34）。出張⇔年休の切り替えは
  // 別々の申請への切り替えで、切り替わった時点でどちらの申請も実際には済んでいない。
  // サーバー側（`resetPreAppliedOnKindChange`）が保存時に強制的に未申請へ戻すため、ここでは
  // 「済ませた」への再チェックそのものを押せなくする。押せるままにすると、その場でもう一度
  // チェックを入れて保存したのに、サーバーが黙って外す体験になる（issue #648 計画レビュー
  // 指摘）。押し直しは保存して画面を開き直してから行う。
  //
  // 判定は「保存すると新しく出張・年休として書き込まれる種類が、元の記録の種類と違うか」。
  // 元が勤務・休みだった記録を初めて出張・年休へ切り替える場合も対象に含める（勤務を1回
  // 経由させるだけでリセットを回避できてしまうため・同計画レビュー指摘）。
  const originalKind = existing ? kindOf(existing) : null;
  const preApplyLockedByKindChange =
    Boolean(existing) && (kind === "trip" || kind === "leave") && kind !== originalKind;

  // 閉じる前に入力欄のフォーカスを外し、キーボードをダイアログが残っている間に閉じさせる
  // （issue #899）。iOSではボタンを押しても入力欄のフォーカスが外れず、キーボードを出したまま
  // 保存するとフォーカス中の欄ごとダイアログが消える。そのときiOSは、欄を見せるためにずらした
  // 文書のスクロールを戻さず、画面全体が上にずれたまま残る。戻し切らなかった分は
  // `StrandedScrollReset`（AppFrame）が拾う。
  const blurTextInput = () => {
    const active = document.activeElement;
    if (isTextInput(active)) active.blur();
  };

  const close = () => {
    blurTextInput();
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const finish = (syncNote: string | null = null) => {
    blurTextInput();
    setOpen(false);
    setTimeout(() => onSaved(syncNote), 150);
  };

  const send = async (path: string, init: RequestInit, fallback: string) => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, init);
      if (!response.ok) {
        setError(await readErrorMessage(response, fallback));
        return;
      }
      const body = (await response.json().catch(() => null)) as { sync?: SyncSummary } | null;
      finish(describeSync(body?.sync));
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!startDate) {
      setError("日付を入力してください。");
      return;
    }
    if (businessTrip && !destination.trim()) {
      setError("行き先を入力してください。");
      return;
    }
    if (partialDay && !place) {
      setError(`${restPlaceLabel}を選んでください。`);
      return;
    }
    if (!businessTrip && !isLeave && !isHoliday && !place) {
      setError("勤務場所を選んでください。");
      return;
    }

    // 通常の勤務は勤務場所の名前をそのままタイトルにする。Notionの一覧で開かずに読めるようにし、
    // 入力の欄も1つ減らす。出張は行き先が、年休は区分がタイトルになる。会社休業日は名称を
    // 入れなくても登録できるため、空なら種類の名前をそのまま置く。
    const title = isHoliday
      ? holidayName.trim() || HOLIDAY_TITLE
      : isLeave
        ? `年休（${annualLeave}）`
        : businessTrip
          ? destination.trim()
          : place;
    // 出張⇔年休の切り替えではpreAppliedのチェック自体を押せなくしているため、状態変数を
    // そのまま送ってよい。サーバー側（`resetPreAppliedOnKindChange`）でも同じ判定で強制する
    // （issue #648）。
    const nextPreApplied = preApplyLockedByKindChange ? false : preApplied;
    const body = {
      title,
      startDate,
      endDate: spanned && endDate ? endDate : startDate,
      // 全休の日と会社休業日に勤務場所は入らない。半休・時間休の日は残りの勤務場所を持つ。
      //
      // 出張は項目ごと送らない（`place: undefined` は toProperties() で「触らない」扱い・
      // issue #549）。画面から選べなくなったため、送ると利用者が選んでいない既定の場所
      // （selectの定義順の先頭）を書き込むことになる。かといって null で消すと、今日の
      // チップから作った出張（行き先＝場所名）が持っている場所まで消え、
      // work-screen の todayEditableByChip が偽になってチップから取り消せなくなる。
      ...(businessTrip
        ? {}
        : {
            place: isHoliday
              ? null
              : isLeave
                ? partialDay
                  ? place || null
                  : null
                : place,
          }),
      ...(capabilities.businessTrip ? { businessTrip } : {}),
      ...(capabilities.annualLeave ? { annualLeave: isLeave ? annualLeave : null } : {}),
      ...(capabilities.companyHoliday ? { companyHoliday: isHoliday } : {}),
      ...(capabilities.approval && businessTrip
        ? { preApplied: nextPreApplied, postRegistered }
        : {}),
      ...(capabilities.annualLeave && isLeave ? { preApplied: nextPreApplied } : {}),
      ...(capabilities.memo ? { memo: memo.trim() || null } : {}),
    };

    if (existing) {
      await send(
        `/api/work/records/${existing.id}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        "勤務記録を保存できませんでした。",
      );
      return;
    }

    await send(
      "/api/work/records",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      "勤務記録を保存できませんでした。",
    );
  };

  const remove = async () => {
    if (!existing) return;
    await send(
      `/api/work/records/${existing.id}`,
      { method: "DELETE" },
      "勤務記録を削除できませんでした。",
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-y-auto">
        <DialogTitle>{kind === "work" ? "勤務場所" : KIND_LABELS[kind]}</DialogTitle>
        <DialogDescription className="sr-only">
          勤務場所・出張・年休・休みの登録。出張では事前申請と事後登録、年休では事前申請の
          状況も持てます。
        </DialogDescription>

        {error && (
          <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
            {error}
          </p>
        )}

        {/* 種類。同時に立てられないので、スイッチを並べず1つの並びから選ばせる。 */}
        {kinds.length > 1 && (
          <div
            role="radiogroup"
            aria-label="記録の種類"
            className={cn(
              "grid overflow-hidden rounded-full border border-outline",
              // 使える種類の数で列を決める。4列に固定すると、年休だけを足したDBで空の枠が並ぶ。
              kinds.length === 4
                ? "grid-cols-4"
                : kinds.length === 3
                  ? "grid-cols-3"
                  : "grid-cols-2",
            )}
          >
            {kinds.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => chooseKind(option)}
                className={cn(
                  "type-label-large py-2 text-center transition-colors",
                  kind === option
                    ? "bg-secondary-container font-bold text-on-secondary-container"
                    : "text-on-surface-variant hover:bg-on-surface/8",
                )}
              >
                {KIND_LABELS[option]}
              </button>
            ))}
          </div>
        )}

        {isLeave && (
          <div className="flex flex-col gap-2">
            <span className="type-label-medium text-on-surface-variant">区分</span>
            <div className="flex flex-wrap gap-2">
              {[...ANNUAL_LEAVE_OPTIONS.map((option) => option.name), HOURLY_LEAVE_LABEL].map(
                (name) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={leaveKind === name}
                    onClick={() => setLeaveKind(name)}
                    className={cn(
                      "type-label-large rounded-full border px-4 py-2 transition-colors",
                      leaveKind === name
                        ? "border-transparent bg-tertiary-container font-bold text-on-tertiary-container"
                        : "border-outline text-on-surface hover:bg-on-surface/8",
                    )}
                  >
                    {name}
                  </button>
                ),
              )}
            </div>
          </div>
        )}

        {/* 時間数はチップで選ばせる（issue #537）。数値の欄にすると、いちばん多い1〜3時間を
            入れるのに毎回キーボードが出る。上限は所定労働時間から決まる（それ以上は全休と同じ）。 */}
        {isLeave && hourlyLeave && (
          <div className="flex flex-col gap-2">
            <span className="type-label-medium text-on-surface-variant">時間数</span>
            <div className="flex flex-wrap gap-2">
              {hourChoices.map((hours) => (
                <button
                  key={hours}
                  type="button"
                  aria-pressed={leaveHours === hours}
                  onClick={() => setLeaveHours(hours)}
                  className={cn(
                    "type-label-large rounded-full border px-3.5 py-1.5 transition-colors",
                    leaveHours === hours
                      ? "border-transparent bg-tertiary-container font-bold text-on-tertiary-container"
                      : "border-outline text-on-surface hover:bg-on-surface/8",
                  )}
                >
                  {hours}時間
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 会社休業日と全休の日に勤務場所は入らない。半休・時間休の日は残りぶんを選ばせる。
            出張の日にも出さない。読む値は行き先（Notionのtitle）で、勤務場所は月の集計でも
            カレンダーのチップでも使っておらず、「在宅」「出張」のように出張の行き先としては
            意味を持たない選択肢が並ぶだけになるため（issue #549）。 */}
        {workPlaceOptions.length > 0 && !businessTrip && !isHoliday && (!isLeave || partialDay) && (
          <div className="flex flex-col gap-2">
            <span className="type-label-medium text-on-surface-variant">
              {partialDay ? restPlaceLabel : "勤務場所"}
            </span>
            <div className="flex flex-wrap gap-2">
              {workPlaceOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={place === option.name}
                  onClick={() => setPlace(option.name)}
                  className={cn(
                    "type-label-large rounded-full border px-4 py-2 transition-colors",
                    place === option.name
                      ? cn("border-transparent font-bold", tagChipClass(option.color))
                      : "border-outline text-on-surface hover:bg-on-surface/8",
                  )}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 名称は任意。「夏季休業」「年末年始」のように名前が付いているときだけ入れれば足りる。 */}
        {isHoliday && (
          <Input
            id="work-holiday-name"
            label="名称（任意）"
            value={holidayName}
            onChange={(event) => setHolidayName(event.target.value)}
          />
        )}

        {/* 直近の出張の行き先から選べるようにする（issue #525）。選択肢ではなく入力の
            オートフィルなので、選んだあとも下のInputで自由に直せることが伝わるよう、
            aria-pressedや選択中のハイライトは付けない。 */}
        {businessTrip && recentDestinations.length > 0 && (
          <div className="flex min-w-0 flex-col gap-2">
            <span className="type-label-medium text-on-surface-variant">最近の行き先</span>
            {/* 折り返さず横に送る（issue #549）。5件を折り返すと、その下の行き先の欄と日付が
                画面の外へ押し出される。min-w-0が無いと、縮まないチップの合計幅がそのまま
                ダイアログの最小幅になり、画面ごと横に広がる。チップの枠やフォーカスリングが
                切れないよう左右と下に余白を取り、その分を負のマージンで戻す
                （予定の保存先を選ぶ calendar-chip-select と同じ形）。 */}
            <div className="-mx-1 flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 [scrollbar-width:thin]">
              {recentDestinations.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setDestination(name)}
                  className="type-label-large shrink-0 rounded-full border border-outline px-4 py-2 whitespace-nowrap text-on-surface transition-colors hover:bg-on-surface/8"
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {businessTrip && (
          <Input
            id="work-destination"
            label="行き先"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          />
        )}

        <div className={cn("grid gap-2", spanned && "grid-cols-2")}>
          <Input
            id="work-start-date"
            label={spanned ? "開始日" : "日付"}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          {/* 終了日は出張・全休の年休・会社休業日だけ。通常の勤務と半休・時間休は1日1件で、
              期間を持たせる意味が無い。 */}
          {spanned && (
            <Input
              id="work-end-date"
              label="終了日"
              type="date"
              value={endDate || startDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          )}
        </div>

        {/* 年休が持つのは事前申請だけ。休んだことを後から届け出る手続きは無い。 */}
        {isLeave && capabilities.annualLeave && (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-3 py-1.5">
              <Checkbox
                checked={preApplyLockedByKindChange ? false : preApplied}
                disabled={preApplyLockedByKindChange}
                onCheckedChange={(next) => setPreApplied(next === true)}
              />
              <span
                className={cn(
                  "type-body-medium",
                  preApplyLockedByKindChange && "text-on-surface-variant",
                )}
              >
                {WORK_TODO_LABELS.preApplied}を済ませた
              </span>
            </label>
            {preApplyLockedByKindChange && (
              <p className="type-body-small pl-[30px] text-on-surface-variant">
                種類を変更したため、保存後に改めて事前申請してください
              </p>
            )}
          </div>
        )}

        {businessTrip && capabilities.approval && (
          <div className="flex flex-col gap-1">
            {(["preApplied", "postRegistered"] as const).map((todo) => {
              const checked = todo === "preApplied" ? preApplied : postRegistered;
              const setChecked = todo === "preApplied" ? setPreApplied : setPostRegistered;
              // 事前申請は出張⇔年休の切り替え直後は押せない（下記）。事後登録は出張の翌日
              // 以降にしかできない（issue #509）。
              const todoDisabled =
                todo === "preApplied" ? preApplyLockedByKindChange : postRegisterDisabled;
              return (
                <label key={todo} className="flex items-center gap-3 py-1.5">
                  <Checkbox
                    checked={todo === "preApplied" && preApplyLockedByKindChange ? false : checked}
                    disabled={todoDisabled}
                    onCheckedChange={(next) => setChecked(next === true)}
                  />
                  <span
                    className={cn(
                      "type-body-medium",
                      todoDisabled && "text-on-surface-variant",
                    )}
                  >
                    {WORK_TODO_LABELS[todo]}を済ませた
                  </span>
                </label>
              );
            })}
            {/* 押せない理由が伝わるよう添える。押せないだけでは、いつ押せるようになるか分からない。 */}
            {preApplyLockedByKindChange && (
              <p className="type-body-small pl-[30px] text-on-surface-variant">
                種類を変更したため、保存後に改めて事前申請してください
              </p>
            )}
            {postRegisterDisabled && (
              <p className="type-body-small pl-[30px] text-on-surface-variant">
                出張終了後に登録できます
              </p>
            )}
          </div>
        )}

        {capabilities.memo && (
          <Textarea
            id="work-memo"
            label="メモ"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
          />
        )}

        {/* 削除は必ず確認を挟む。押し間違えても画面上に戻す手立てが無いため（docs/spec.md §15）。
            ただしNotionのゴミ箱には残るので、確認の文にもそれを書く。 */}
        {confirming ? (
          <div className="flex flex-col gap-2 rounded-xl bg-error-container p-3 text-on-error-container">
            <p className="type-body-small">
              この記録を削除します。Notionのゴミ箱へ移るため、Notion側から戻せます。
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                やめる
              </Button>
              <Button variant="destructive" className="flex-1" disabled={busy} onClick={remove}>
                <Trash2 className="size-4" />
                削除する
              </Button>
            </div>
          </div>
        ) : (
          <ItemFormActions
            saveDisabled={busy || offline}
            onSave={save}
            onDelete={existing ? () => setConfirming(true) : undefined}
            deleteDisabled={busy || offline}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
