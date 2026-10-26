import {
  enumerateDates,
  workWindow,
  type WorkLegOverride,
  type WorkRecordOverride,
  type WorkTrainItem,
} from "@/lib/work-sync/plan";
import { pickDefaultRoute, type RouteModeRow } from "@/lib/work-sync/route-modes";
import { defaultTrain, earlyByForReturn, lateByForOutbound } from "@/lib/work-sync/train";
import type { TravelMode } from "@/types/calendar";

/**
 * 勤務入力ダイアログの「勤務予定・移動の反映」欄の状態を作る・検証する純粋関数
 * （docs/spec.md §46・issue #1099）。画面から切り離して、確かめられる形にしている。
 */

export type SyncConfigPlaceDefault = {
  key: string;
  isTrip: boolean;
  workEnabled: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
  outboundEnabled: boolean;
  returnEnabled: boolean;
};

export type SyncConfig = {
  enabled: boolean;
  startMinutes: number;
  endMinutes: number;
  lunchStartMinutes: number;
  lunchEndMinutes: number;
  remotePlaces: string[];
  homeOrigin: string | null;
  defaults: SyncConfigPlaceDefault[];
  /** 方法ごとの既定の移動（issue #1447）。古い応答には mode・isDefault が無いので欠けても受ける。 */
  routes: Array<{
    origin: string;
    destination: string;
    minutes: number;
    mode?: TravelMode;
    isDefault?: boolean;
  }>;
  /** よく使う電車（issue #1347）。古い応答には無いので欠けても受ける。 */
  trains?: WorkTrainItem[];
  override: WorkRecordOverride | null;
};

/** 画面で編集する値。時刻は `HH:MM`、所要時間は入力途中の文字列（空は未入力）。 */
export type SyncForm = {
  workEnabled: boolean;
  start: string;
  end: string;
  outEnabled: boolean;
  outMinutes: string;
  backEnabled: boolean;
  backMinutes: string;
  /** 移動方法（issue #1447）。空は指定なし＝勤務先のデフォルトの方法。 */
  outMode: TravelMode | "";
  backMode: TravelMode | "";
  /** 選んだ電車のID。空は「所要時間」で作る（issue #1347）。 */
  outTrainId: string;
  backTrainId: string;
};

export type SyncField = keyof SyncForm;

export const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const fromTime = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minutes <= 1439 ? minutes : null;
};

/** 入力中の行き先・勤務場所から、既定を引く勤務先名を決める（`名前 住所` の形も名前で当てる）。 */
export function resolveKey(text: string, candidates: string[]): string {
  const trimmed = text.trim();
  if (candidates.includes(trimmed)) return trimmed;
  const prefixed = candidates
    .filter((name) => trimmed.startsWith(`${name} `) || trimmed.startsWith(`${name}　`))
    .sort((a, b) => b.length - a.length)[0];
  return prefixed ?? trimmed;
}

export type SyncContext = {
  /** 勤務先名（勤務は勤務場所、出張は行き先）。空なら既定は引かない。 */
  key: string;
  isTrip: boolean;
  /** 半休・時間休の勤務時間帯の既定を決めるため。 */
  annualLeave: string | null;
};

/** 通勤・出張の移動を作る対象か。在宅・場所未選択は作らない。 */
export function commutes(config: SyncConfig, context: SyncContext): boolean {
  return Boolean(context.key) && (context.isTrip || !config.remotePlaces.includes(context.key));
}

export type Leg = "out" | "back";

/** その勤務先の往路・復路に選べる電車。往路は自宅→勤務先、復路は勤務先→自宅。出発時刻順。 */
export function trainsFor(config: SyncConfig, context: SyncContext, leg: Leg): WorkTrainItem[] {
  const home = config.homeOrigin?.trim();
  if (!home || !context.key) return [];
  const origin = leg === "out" ? home : context.key;
  const destination = leg === "out" ? context.key : home;
  return (config.trains ?? [])
    .filter((train) => train.origin === origin && train.destination === destination)
    .sort((a, b) => a.departMinutes - b.departMinutes);
}

/** 保存済みの電車が、いまの勤務先の候補に無い（削除された・勤務先が変わった）か。 */
export function trainMissing(
  config: SyncConfig,
  context: SyncContext,
  leg: Leg,
  trainId: string,
): boolean {
  return Boolean(trainId) && !trainsFor(config, context, leg).some((train) => train.id === trainId);
}

/** 往路・復路の既定の移動の行。方法の無い古い応答は、1組1件の公共交通のデフォルトとして扱う。 */
export function routesFor(config: SyncConfig, context: SyncContext, leg: Leg): RouteModeRow[] {
  const home = config.homeOrigin?.trim();
  if (!home || !context.key) return [];
  const origin = leg === "out" ? home : context.key;
  const destination = leg === "out" ? context.key : home;
  return config.routes
    .filter((row) => row.origin === origin && row.destination === destination)
    .map((row) => ({
      origin: row.origin,
      destination: row.destination,
      minutes: row.minutes,
      mode: row.mode ?? "PUBLIC_TRANSIT",
      isDefault: row.isDefault ?? true,
    }));
}

/** 電車（時刻指定）を使える方法か。 */
export const modeUsesTrain = (mode: TravelMode | ""): boolean => mode === "" || mode === "PUBLIC_TRANSIT";

/**
 * 移動方法を選んだときの変更。所要時間はその方法で登録済みの値へ差し替え（未登録は空）、
 * 公共交通以外では電車の選択を外す。電車は公共交通へ戻したとき選び直す。
 */
export function modeChange(
  config: SyncConfig,
  context: SyncContext,
  leg: Leg,
  mode: TravelMode,
): Partial<SyncForm> {
  const registered = routesFor(config, context, leg).find((row) => row.mode === mode);
  const minutes = registered ? String(registered.minutes) : "";
  return leg === "out"
    ? { outMode: mode, outMinutes: minutes, ...(modeUsesTrain(mode) ? {} : { outTrainId: "" }) }
    : { backMode: mode, backMinutes: minutes, ...(modeUsesTrain(mode) ? {} : { backTrainId: "" }) };
}

/** 設定（既定）だけから作る初期値。 */
export function defaultForm(config: SyncConfig, context: SyncContext): SyncForm {
  const def =
    config.defaults.find((row) => row.key === context.key && row.isTrip === context.isTrip) ?? null;

  const common = {
    startMinutes: def?.startMinutes ?? config.startMinutes,
    endMinutes: def?.endMinutes ?? config.endMinutes,
  };
  // 半休・時間休は、既定の置き方（昼休み基準・終了側から差し引き）で求めた時間帯から始める。
  const window =
    workWindow({ companyHoliday: false, annualLeave: context.annualLeave }, { ...config, ...common }) ??
    { start: common.startMinutes, end: common.endMinutes };

  const out = pickDefaultRoute(routesFor(config, context, "out"));
  const back = pickDefaultRoute(routesFor(config, context, "back"));
  return {
    workEnabled: def?.workEnabled ?? true,
    start: toTime(window.start),
    end: toTime(window.end),
    outEnabled: def?.outboundEnabled ?? true,
    outMinutes: out ? String(out.minutes) : "",
    outMode: out?.mode ?? "",
    backEnabled: def?.returnEnabled ?? true,
    backMinutes: back ? String(back.minutes) : "",
    backMode: back?.mode ?? "",
    outTrainId: "",
    backTrainId: "",
  };
}

/**
 * 新規の記録だけに使う初期選択（issue #1371）。往路・復路が有効で、まだ電車を選んでおらず、その勤務先に
 * デフォルトの電車があれば選んだ状態にする。**既存の記録には使わない**（開いただけで電車が選ばれ、
 * 保存で既存の予定・移動の時刻が書き換わるのを避けるため。呼び出し側が新規かを判断する）。
 */
export function withDefaultTrains(
  form: SyncForm,
  config: SyncConfig,
  context: SyncContext,
): SyncForm {
  if (!commutes(config, context)) return form;
  const pick = (leg: Leg, enabled: boolean, current: string, mode: TravelMode | "") => {
    if (!enabled || current !== "" || !modeUsesTrain(mode)) return current;
    return defaultTrain(trainsFor(config, context, leg))?.id ?? "";
  };
  return {
    ...form,
    outTrainId: pick("out", form.outEnabled, form.outTrainId, form.outMode),
    backTrainId: pick("back", form.backEnabled, form.backTrainId, form.backMode),
  };
}

/** 記録で保存した指定を、既定の上に重ねる。 */
export function applyOverride(
  base: SyncForm,
  override: WorkRecordOverride | null,
  config?: SyncConfig,
  context?: SyncContext,
): SyncForm {
  if (!override) return base;
  const leg = (
    value: WorkLegOverride | undefined,
    enabled: boolean,
    minutes: string,
    trainId: string,
    mode: TravelMode | "",
    registered: (mode: TravelMode) => number | undefined,
  ) => ({
    enabled: value?.enabled ?? enabled,
    mode: value?.mode ?? mode,
    // 方法だけ保存されていて所要時間が無い（電車・既定の値）ときは、その方法で登録済みの値を出す。
    minutes:
      value?.minutes != null
        ? String(value.minutes)
        : value?.mode && value.mode !== mode
          ? String(registered(value.mode) ?? "")
          : minutes,
    // 保存した電車はそのまま持つ（削除されていても消さず、画面で選び直しを促す）。
    trainId: value?.trainId ?? trainId,
  });
  const registered = (kind: Leg) => (mode: TravelMode) =>
    config && context ? routesFor(config, context, kind).find((row) => row.mode === mode)?.minutes : undefined;
  const out = leg(override.outbound, base.outEnabled, base.outMinutes, base.outTrainId, base.outMode, registered("out"));
  const back = leg(override.return, base.backEnabled, base.backMinutes, base.backTrainId, base.backMode, registered("back"));
  return {
    workEnabled: override.workEnabled ?? base.workEnabled,
    start: override.startMinutes != null ? toTime(override.startMinutes) : base.start,
    end: override.endMinutes != null ? toTime(override.endMinutes) : base.end,
    outEnabled: out.enabled,
    outMinutes: out.minutes,
    backEnabled: back.enabled,
    backMinutes: back.minutes,
    outMode: out.mode,
    backMode: back.mode,
    outTrainId: out.trainId,
    backTrainId: back.trainId,
  };
}

/**
 * 勤務先などが変わったとき、新しい既定を提示しつつ、この画面で手で変えた項目は残す。
 * 残した項目があれば `kept` に挙げる（無言で失わせず、画面で知らせるため）。
 */
export function rebase(
  current: SyncForm,
  touched: ReadonlySet<SyncField>,
  next: SyncForm,
): { form: SyncForm; kept: SyncField[] } {
  const kept: SyncField[] = [];
  const form = { ...next };
  for (const field of touched) {
    if (current[field] !== next[field]) {
      (form as Record<SyncField, string | boolean>)[field] = current[field];
      kept.push(field);
    }
  }
  return { form, kept };
}

export type SyncCheck =
  | { ok: true; payload: WorkRecordOverride }
  | { ok: false; message: string };

/**
 * 保存前の検証と、送る指定の組み立て。反映ONの項目に必要な時間だけを確かめ、
 * OFFの項目は時間が空・不正でも要求しない。足りない時間は推測しない。
 */
export function checkForm(
  form: SyncForm,
  config: SyncConfig,
  context: SyncContext,
  { fullDayOff }: { fullDayOff: boolean },
): SyncCheck {
  if (fullDayOff) return { ok: true, payload: {} };
  const withCommute = commutes(config, context);
  const legs = withCommute && (form.outEnabled || form.backEnabled);
  const needsWindow = form.workEnabled || legs;

  const start = fromTime(form.start);
  const end = fromTime(form.end);
  if (needsWindow) {
    if (start === null) return { ok: false, message: "勤務開始の時刻を入力してください。" };
    if (end === null) return { ok: false, message: "勤務終了の時刻を入力してください。" };
    if (end <= start) return { ok: false, message: "勤務終了は開始より後にしてください。" };
  }

  const payload: WorkRecordOverride = { workEnabled: form.workEnabled };
  if (start !== null && end !== null && end > start) {
    payload.startMinutes = start;
    payload.endMinutes = end;
  }

  if (withCommute) {
    if (legs && !config.homeOrigin?.trim()) {
      return {
        ok: false,
        message: "移動の出発地が未設定です。設定の「移動」で入れるか、往路・復路の反映をオフにしてください。",
      };
    }
    const leg = (
      label: string,
      kind: Leg,
      enabled: boolean,
      text: string,
      trainId: string,
      mode: TravelMode | "",
    ): WorkLegOverride | string => {
      if (!enabled) return { enabled: false, minutes: null };
      const modePart = mode ? { mode } : {};
      if (trainId && modeUsesTrain(mode)) {
        if (trainMissing(config, context, kind, trainId)) {
          return `${label}で選んだ電車が見つかりません。電車を選び直すか、所要時間に切り替えてください。`;
        }
        return { enabled: true, minutes: null, trainId, ...modePart };
      }
      const minutes = Number(text);
      if (text.trim() === "" || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        return `${label}の所要時間（分）を入力してください。入力しない場合は${label}の反映をオフにしてください。`;
      }
      return { enabled: true, minutes, ...modePart };
    };
    const out = leg("往路", "out", form.outEnabled, form.outMinutes, form.outTrainId, form.outMode);
    if (typeof out === "string") return { ok: false, message: out };
    const back = leg("復路", "back", form.backEnabled, form.backMinutes, form.backTrainId, form.backMode);
    if (typeof back === "string") return { ok: false, message: back };
    payload.outbound = out;
    payload.return = back;
  }
  return { ok: true, payload };
}

/** 画面で編集する日ごとの勤務時間（`HH:MM`）。指定した日だけ持つ。 */
export type DayEdits = Record<string, { start: string; end: string }>;

/** 保存済みの日ごとの指定を、画面の入力値へ直す。 */
export function dayEditsFromOverride(override: WorkRecordOverride | null): DayEdits {
  const edits: DayEdits = {};
  for (const [date, range] of Object.entries(override?.days ?? {})) {
    edits[date] = { start: toTime(range.start), end: toTime(range.end) };
  }
  return edits;
}

/**
 * 日ごとの入力を、記録の期間内の日だけ検証して送る形にする（issue #1342）。
 * 全日の時刻が共通の値と同じ日は送らない（指定なし＝共通の値）。
 */
export function checkDays(
  edits: DayEdits,
  form: Pick<SyncForm, "start" | "end">,
  dates: { startDate: string; endDate: string },
): { ok: true; days: NonNullable<WorkRecordOverride["days"]> } | { ok: false; message: string } {
  const days: NonNullable<WorkRecordOverride["days"]> = {};
  for (const date of enumerateDates(dates.startDate, dates.endDate)) {
    const edit = edits[date];
    if (!edit || (edit.start === form.start && edit.end === form.end)) continue;
    const start = fromTime(edit.start);
    const end = fromTime(edit.end);
    const label = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
    if (start === null || end === null) {
      return { ok: false, message: `${label}の勤務開始・終了の時刻を入力してください。` };
    }
    if (end <= start) return { ok: false, message: `${label}の勤務終了は開始より後にしてください。` };
    days[date] = { start, end };
  }
  return { ok: true, days };
}

/** 反映する内容の確認用の文面。反映OFFの項目は出さない。 */
export function describePlan(
  form: SyncForm,
  config: SyncConfig,
  context: SyncContext,
  dates: { startDate: string; endDate: string },
  dayEdits: DayEdits = {},
): string[] {
  const lines: string[] = [];
  const common = { start: fromTime(form.start), end: fromTime(form.end) };
  const range = (from: number, to: number) => `${toTime(((from % 1440) + 1440) % 1440)}–${toTime(((to % 1440) + 1440) % 1440)}`;
  const span = dates.endDate && dates.endDate !== dates.startDate;
  const dayLabel = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  /** その日の時間帯。日ごとの指定があればそれ、無ければ共通の値。決められなければ null。 */
  const windowOn = (date: string) => {
    const edit = dayEdits[date];
    const start = edit ? fromTime(edit.start) : common.start;
    const end = edit ? fromTime(edit.end) : common.end;
    return start !== null && end !== null && end > start ? { start, end } : null;
  };
  const first = windowOn(dates.startDate);
  const last = windowOn(span ? dates.endDate : dates.startDate);

  if (form.workEnabled) {
    if (span && Object.keys(dayEdits).length > 0) {
      for (const date of enumerateDates(dates.startDate, dates.endDate)) {
        const window = windowOn(date);
        if (window) lines.push(`勤務予定 ${dayLabel(date)} ${range(window.start, window.end)}`);
      }
    } else if (first) {
      lines.push(`勤務予定 ${range(first.start, first.end)}${span ? "（期間の各日）" : ""}`);
    }
  }
  if (commutes(config, context)) {
    const outTrain = form.outTrainId ? pickedTrain(config, context, "out", form.outTrainId) : null;
    const out = Number(form.outMinutes);
    if (form.outEnabled && outTrain) {
      lines.push(
        `往路 ${range(outTrain.departMinutes, outTrain.departMinutes + outTrain.durationMinutes)}（${outTrain.label}）${span ? `（${dates.startDate}）` : ""}`,
      );
    } else if (first && form.outEnabled && !form.outTrainId && out > 0) {
      lines.push(`往路 ${range(first.start - out, first.start)}${span ? `（${dates.startDate}）` : ""}`);
    }
    const backTrain = form.backTrainId ? pickedTrain(config, context, "back", form.backTrainId) : null;
    const back = Number(form.backMinutes);
    if (form.backEnabled && backTrain) {
      lines.push(
        `復路 ${range(backTrain.departMinutes, backTrain.departMinutes + backTrain.durationMinutes)}（${backTrain.label}）${span ? `（${dates.endDate}）` : ""}`,
      );
    } else if (last && form.backEnabled && !form.backTrainId && back > 0) {
      lines.push(`復路 ${range(last.end, last.end + back)}${span ? `（${dates.endDate}）` : ""}`);
    }
  }
  return lines;
}

function pickedTrain(
  config: SyncConfig,
  context: SyncContext,
  leg: Leg,
  trainId: string,
): WorkTrainItem | null {
  return trainsFor(config, context, leg).find((train) => train.id === trainId) ?? null;
}

/**
 * 選んだ電車と勤務時間のずれの警告（保存は止めない・issue #1347）。往路は到着が勤務開始より後、
 * 復路は出発が勤務終了より前のとき。往路は初日、復路は最終日の勤務時間に合わせる。
 */
export function trainWarnings(
  form: SyncForm,
  config: SyncConfig,
  context: SyncContext,
  dates: { startDate: string; endDate: string },
  dayEdits: DayEdits = {},
): string[] {
  if (!commutes(config, context)) return [];
  const span = dates.endDate && dates.endDate !== dates.startDate;
  const windowOn = (date: string) => {
    const edit = dayEdits[date];
    const start = edit ? fromTime(edit.start) : fromTime(form.start);
    const end = edit ? fromTime(edit.end) : fromTime(form.end);
    return start !== null && end !== null && end > start ? { start, end } : null;
  };
  const warnings: string[] = [];
  const outTrain = form.outEnabled && form.outTrainId ? pickedTrain(config, context, "out", form.outTrainId) : null;
  const first = windowOn(dates.startDate);
  if (outTrain && first) {
    const late = lateByForOutbound(outTrain, first.start);
    if (late !== null) {
      warnings.push(
        `往路の電車は勤務開始 ${toTime(first.start)} に間に合いません（到着 ${toTime((outTrain.departMinutes + outTrain.durationMinutes) % 1440)}・${late}分遅れ）。別の電車を選ぶか、勤務開始を直してください。`,
      );
    }
  }
  const backTrain = form.backEnabled && form.backTrainId ? pickedTrain(config, context, "back", form.backTrainId) : null;
  const last = windowOn(span ? dates.endDate : dates.startDate);
  if (backTrain && last) {
    const early = earlyByForReturn(backTrain, last.end);
    if (early !== null) {
      warnings.push(
        `復路の電車（${toTime(backTrain.departMinutes)}発）は勤務終了 ${toTime(last.end)} より前に出ます（${early}分早い）。別の電車を選ぶか、勤務終了を直してください。`,
      );
    }
  }
  return warnings;
}
