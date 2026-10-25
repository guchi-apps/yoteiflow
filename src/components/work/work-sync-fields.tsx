"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  applyOverride,
  checkDays,
  checkForm,
  commutes,
  dayEditsFromOverride,
  defaultForm,
  describePlan,
  type DayEdits,
  rebase,
  resolveKey,
  trainMissing,
  trainsFor,
  trainWarnings,
  withDefaultTrains,
  toTime,
  type Leg,
  type SyncConfig,
  type SyncContext,
  type SyncField,
  type SyncForm,
} from "@/lib/work-sync/form";
import { enumerateDates, type WorkRecordOverride } from "@/lib/work-sync/plan";

const FIELD_LABELS: Record<SyncField, string> = {
  workEnabled: "勤務予定の反映",
  start: "勤務開始",
  end: "勤務終了",
  outEnabled: "往路の反映",
  outMinutes: "往路の所要時間",
  backEnabled: "復路の反映",
  backMinutes: "復路の所要時間",
  outTrainId: "往路の電車",
  backTrainId: "復路の電車",
};

/**
 * 勤務入力ダイアログの「カレンダーへの反映」欄（issue #1099・docs/spec.md §46）。
 *
 * 勤務先（出張は行き先）に応じて、設定の既定値を初期表示する。ここで変えた値はその勤務記録の値
 * として保存し、設定の既定は更新しない。設定が無くても、この欄だけで入力して保存できる。
 * 勤務先を変えたときは新しい既定を出しつつ、手で変えた項目は残してその旨を知らせる。
 */
export function useWorkSyncFields({
  recordId,
  text,
  isTrip,
  annualLeave,
  fullDayOff,
  startDate,
  endDate,
  segmented = false,
}: {
  recordId: string | null;
  /** 勤務場所、または出張の行き先の入力。 */
  text: string;
  isTrip: boolean;
  annualLeave: string | null;
  /** 全休・休みなど、勤務しない日。 */
  fullDayOff: boolean;
  startDate: string;
  endDate: string;
  /**
   * 時間帯の内訳を使っているか（issue #1155）。使っている間は勤務の時刻を区切りが決め、
   * 移動は場所が変わるたびに既定の移動時間で作るため、時刻・所要時間の欄を出さず反映の
   * オン・オフだけを選ばせる。
   */
  segmented?: boolean;
}) {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/work/sync-config${recordId ? `?recordId=${encodeURIComponent(recordId)}` : ""}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: SyncConfig | null) => {
        if (cancelled) return;
        if (data) setConfig(data);
        else setLoadFailed(true);
      })
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  const key = config
    ? resolveKey(text, [...config.defaults.map((row) => row.key), ...config.routes.map((row) => row.destination)])
    : text.trim();
  const context: SyncContext = { key, isTrip, annualLeave };
  const contextId = `${key}|${isTrip}|${annualLeave ?? ""}`;

  // 新規の記録だけ、デフォルトの電車を最初から選ぶ（既存の記録は保存した指定のまま・issue #1371）。
  const seedForm = (base: SyncForm) =>
    config && !recordId ? withDefaultTrains(base, config, context) : base;
  const [initialContextId] = useState(contextId);
  const [previousContextId, setPreviousContextId] = useState(contextId);
  const [edited, setEdited] = useState<SyncForm | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<SyncField>>(new Set());
  const [kept, setKept] = useState<SyncField[]>([]);

  // 勤務先などが変わったら新しい既定を出す。手で変えた項目は残し、残したことを知らせる。
  if (contextId !== previousContextId) {
    setPreviousContextId(contextId);
    if (config && edited) {
      const result = rebase(edited, touched, seedForm(defaultForm(config, context)));
      setEdited(result.form);
      setKept(result.kept);
    } else {
      setKept([]);
    }
  }

  const initial = config
    ? contextId === initialContextId
      ? applyOverride(seedForm(defaultForm(config, context)), config.override)
      : seedForm(defaultForm(config, context))
    : null;
  const form = edited ?? initial;

  const change = (patch: Partial<SyncForm>) => {
    if (!form) return;
    setEdited({ ...form, ...patch });
    setTouched(new Set([...touched, ...(Object.keys(patch) as SyncField[])]));
    setKept((current) => current.filter((field) => !(field in patch)));
  };

  // 期間の出張の日ごとの勤務時間（issue #1342）。内訳（時間帯）を使う間は区切りが決める。
  const [dayEdited, setDayEdited] = useState<DayEdits | null>(null);
  const dayEdits = dayEdited ?? dayEditsFromOverride(config?.override ?? null);
  const daysEnabled = isTrip && endDate > startDate && !segmented;
  const changeDay = (date: string, patch: Partial<{ start: string; end: string }>) => {
    if (!form) return;
    const current = dayEdits[date] ?? { start: form.start, end: form.end };
    setDayEdited({ ...dayEdits, [date]: { ...current, ...patch } });
  };

  const reset = () => {
    setDayEdited(null);
    setEdited(null);
    setTouched(new Set());
    setKept([]);
  };

  /** 保存前の検証。送る指定が無ければ payload は undefined（既存の指定・既定のまま）。 */
  const build = (): { payload?: WorkRecordOverride; error?: string } => {
    if (!config || !config.enabled || !form || fullDayOff) return {};
    if (segmented) {
      // 時刻・所要時間は区切りと既定の移動時間が決める。この記録の指定には反映の有無だけを残す。
      return {
        payload: {
          workEnabled: form.workEnabled,
          startMinutes: null,
          endMinutes: null,
          outbound: { enabled: form.outEnabled, minutes: null },
          return: { enabled: form.backEnabled, minutes: null },
        },
      };
    }
    const result = checkForm(form, config, context, { fullDayOff });
    if (!result.ok) return { error: result.message };
    if (!daysEnabled) return { payload: result.payload };
    const days = checkDays(dayEdits, form, { startDate, endDate });
    if (!days.ok) return { error: days.message };
    return {
      payload: Object.keys(days.days).length > 0 ? { ...result.payload, days: days.days } : result.payload,
    };
  };

  const withCommute = config ? commutes(config, context) : false;
  const lines = config && form && !fullDayOff ? describePlan(form, config, context, { startDate, endDate }, daysEnabled ? dayEdits : {}) : [];
  const warnings =
    config && form && !fullDayOff && !segmented
      ? trainWarnings(form, config, context, { startDate, endDate }, daysEnabled ? dayEdits : {})
      : [];

  const node = (() => {
    if (!config) {
      return loadFailed ? (
        <p className="type-body-small text-on-surface-variant">
          カレンダーへの反映の設定を読み込めませんでした。勤務記録だけを保存します。
        </p>
      ) : null;
    }
    if (!config.enabled) {
      return (
        <p className="type-body-small text-on-surface-variant">
          勤務予定・移動の自動作成はオフです（設定の「勤務」でオンにできます）。
        </p>
      );
    }
    if (fullDayOff) {
      return (
        <p className="type-body-small text-on-surface-variant">
          年休・休みの日は勤務予定・移動を作りません。以前に自動で作った分があれば保存時に削除します。
        </p>
      );
    }
    if (!form) return null;

    const timeInput = (id: string, label: string, field: "start" | "end", enabled: boolean) => (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="type-label-medium text-on-surface-variant">
          {label}
        </label>
        <Input
          id={id}
          type="time"
          value={form[field]}
          disabled={!enabled}
          onChange={(event) => change({ [field]: event.target.value })}
        />
      </div>
    );

    const leg = (
      label: string,
      kind: Leg,
      enabledField: "outEnabled" | "backEnabled",
      minutesField: "outMinutes" | "backMinutes",
      trainField: "outTrainId" | "backTrainId",
    ) => {
      const trains = trainsFor(config, context, kind);
      const trainId = form[trainField];
      const useTrain = trainId !== "";
      const missing = useTrain && trainMissing(config, context, kind, trainId);
      const enabled = form[enabledField];
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Switch
              aria-label={`${label}をカレンダーへ反映`}
              checked={enabled}
              onCheckedChange={(checked) => change({ [enabledField]: checked })}
            />
            <span className="type-body-medium w-8 shrink-0">{label}</span>
            <div role="group" aria-label={`${label}の指定方法`} className="inline-flex overflow-hidden rounded-lg border border-outline-variant">
              {(
                [
                  ["duration", "所要時間"],
                  ["train", "電車"],
                ] as const
              ).map(([value, text]) => {
                const selected = (value === "train") === useTrain;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    disabled={!enabled || (value === "train" && trains.length === 0 && !useTrain)}
                    className={`type-label-large px-3 py-1.5 disabled:opacity-38 ${selected ? "bg-secondary-container text-on-secondary-container" : ""}`}
                    onClick={() =>
                      change({ [trainField]: value === "train" ? (trains[0]?.id ?? "") : "" })
                    }
                  >
                    {text}
                  </button>
                );
              })}
            </div>
            {!useTrain && (
              <Input
                aria-label={`${label}の所要時間（分）`}
                inputMode="numeric"
                placeholder="所要（分）"
                className="min-w-0 flex-1"
                disabled={!enabled}
                value={form[minutesField]}
                onChange={(event) => change({ [minutesField]: event.target.value })}
              />
            )}
          </div>
          {useTrain && (
            <div className="flex flex-col gap-2 pl-1">
              <div className="flex flex-wrap gap-2">
                {trains.map((train) => {
                  const selected = train.id === trainId;
                  return (
                    <button
                      key={train.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={!enabled}
                      className={`type-body-small flex min-w-40 flex-1 flex-col rounded-lg border px-3 py-2 text-left disabled:opacity-38 ${selected ? "border-primary bg-secondary-container" : "border-outline-variant"}`}
                      onClick={() => change({ [trainField]: train.id })}
                    >
                      <span className="type-title-small tabular-nums">
                        {toTime(train.departMinutes)} → {toTime((train.departMinutes + train.durationMinutes) % 1440)}
                        {train.isDefault && (
                          <span className="type-label-small ml-2 rounded-sm bg-primary px-2 py-0.5 text-on-primary">
                            デフォルト
                          </span>
                        )}
                      </span>
                      <span className="text-on-surface-variant">
                        {train.label}・{train.durationMinutes}分
                      </span>
                    </button>
                  );
                })}
              </div>
              {trains.find((train) => train.id === trainId)?.note && (
                <p className="type-body-small whitespace-pre-line border-l-4 border-outline-variant pl-2 text-on-surface-variant">
                  {trains.find((train) => train.id === trainId)?.note}
                </p>
              )}
              {missing && (
                <p className="type-body-small text-error">
                  選んでいた電車が見つかりません（削除されたか、勤務先が変わりました）。電車を選び直すか、所要時間に切り替えてください。
                </p>
              )}
            </div>
          )}
          {!useTrain && enabled && trains.length === 0 && (
            <p className="type-body-small text-on-surface-variant">
              設定の「勤務」で電車を登録すると、時刻を指定して作れます。
            </p>
          )}
        </div>
      );
    };

    if (segmented) {
      const toggle = (
        id: string,
        label: string,
        field: "workEnabled" | "outEnabled" | "backEnabled",
      ) => (
        <div key={id} className="flex items-center gap-3">
          <Switch
            aria-label={`${label}をカレンダーへ反映`}
            checked={form[field]}
            onCheckedChange={(checked) => change({ [field]: checked })}
          />
          <span className="type-body-medium">{label}</span>
        </div>
      );
      return (
        <div className="flex flex-col gap-3">
          {toggle("work", "勤務予定", "workEnabled")}
          {toggle("out", "往路（自宅から・場所の移動）", "outEnabled")}
          {toggle("back", "復路（自宅へ）", "backEnabled")}
          <p className="type-body-small text-on-surface-variant">
            時間帯を分けている間は、区切りごとに勤務予定を作り、場所が変わるたびに移動を作ります。
            時刻は区切りから決まり、所要時間は設定の「勤務」の既定の移動時間を使います。
            電車の時刻を指定するには、時間帯の内訳を使わない記録にしてください。
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Switch
            aria-label="勤務予定をカレンダーへ反映"
            checked={form.workEnabled}
            onCheckedChange={(checked) => change({ workEnabled: checked })}
          />
          <span className="type-body-medium">勤務予定</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {timeInput("work-sync-start", "勤務開始", "start", true)}
          {timeInput("work-sync-end", "勤務終了", "end", true)}
        </div>
        {daysEnabled && (
          <div className="flex flex-col gap-2">
            <p className="type-label-medium text-on-surface-variant">日ごとの勤務時間（変える日だけ直す）</p>
            {enumerateDates(startDate, endDate).map((date, index, all) => {
              const value = dayEdits[date] ?? { start: form.start, end: form.end };
              const role = index === 0 ? "初日" : index === all.length - 1 ? "最終日" : "途中";
              return (
                <div key={date} className="flex items-center gap-2">
                  <span className="type-body-small w-20 shrink-0">
                    {Number(date.slice(5, 7))}/{Number(date.slice(8, 10))} {role}
                  </span>
                  <Input
                    aria-label={`${date}の勤務開始`}
                    type="time"
                    className="min-w-0 flex-1"
                    value={value.start}
                    onChange={(event) => changeDay(date, { start: event.target.value })}
                  />
                  <span>〜</span>
                  <Input
                    aria-label={`${date}の勤務終了`}
                    type="time"
                    className="min-w-0 flex-1"
                    value={value.end}
                    onChange={(event) => changeDay(date, { end: event.target.value })}
                  />
                </div>
              );
            })}
          </div>
        )}
        {withCommute && (
          <div className="flex flex-col gap-2">
            {leg("往路", "out", "outEnabled", "outMinutes", "outTrainId")}
            {leg("復路", "back", "backEnabled", "backMinutes", "backTrainId")}
            {warnings.map((warning) => (
              <p key={warning} role="alert" className="type-body-small text-error">
                {warning}
              </p>
            ))}
            <p className="type-body-small text-on-surface-variant">
              所要時間は、往路が勤務開始に着く時刻、復路が勤務終了に出発する時刻で作ります。電車は選んだ電車の時刻で作ります。
              {isTrip && "出張は初日に往路、最終日に復路です。"}
            </p>
          </div>
        )}
        <div className="type-body-small rounded-lg bg-surface-container px-3 py-2">
          {lines.length > 0 ? (
            <>
              <p className="text-on-surface-variant">保存すると次を反映します</p>
              <ul>
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-on-surface-variant">
              カレンダーへは反映せず、勤務記録だけを保存します（自動作成済みの分があれば削除します）。
            </p>
          )}
        </div>
        {kept.length > 0 && (
          <div className="type-body-small flex flex-col gap-1 text-on-surface-variant">
            <p>
              勤務先に合わせた既定を表示しています。変更済みの{" "}
              {kept.map((field) => FIELD_LABELS[field]).join("・")} は変えていません。
            </p>
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={reset}>
              すべて既定に戻す
            </Button>
          </div>
        )}
        <p className="type-body-small text-on-surface-variant">
          ここでの変更はこの記録だけの値で、設定の既定値は変わりません。
        </p>
      </div>
    );
  })();

  /** 時間帯を分け始めるときの初期の区切り（午前・午後）に使う、設定の勤務時間と昼休み。 */
  const window = config
    ? {
        start: config.startMinutes,
        end: config.endMinutes,
        lunchStart: config.lunchStartMinutes,
        lunchEnd: config.lunchEndMinutes,
      }
    : null;

  return { node, build, window };
}
