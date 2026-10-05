import {
  workWindow,
  type WorkLegOverride,
  type WorkRecordOverride,
} from "@/lib/work-sync/plan";

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
  routes: Array<{ origin: string; destination: string; minutes: number }>;
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

/** 設定（既定）だけから作る初期値。 */
export function defaultForm(config: SyncConfig, context: SyncContext): SyncForm {
  const def =
    config.defaults.find((row) => row.key === context.key && row.isTrip === context.isTrip) ?? null;
  const home = config.homeOrigin?.trim() || null;
  const route = (origin: string, destination: string) =>
    config.routes.find((row) => row.origin === origin && row.destination === destination)?.minutes;

  const common = {
    startMinutes: def?.startMinutes ?? config.startMinutes,
    endMinutes: def?.endMinutes ?? config.endMinutes,
  };
  // 半休・時間休は、既定の置き方（昼休み基準・終了側から差し引き）で求めた時間帯から始める。
  const window =
    workWindow({ companyHoliday: false, annualLeave: context.annualLeave }, { ...config, ...common }) ??
    { start: common.startMinutes, end: common.endMinutes };

  const out = home && context.key ? route(home, context.key) : undefined;
  const back = home && context.key ? route(context.key, home) : undefined;
  return {
    workEnabled: def?.workEnabled ?? true,
    start: toTime(window.start),
    end: toTime(window.end),
    outEnabled: def?.outboundEnabled ?? true,
    outMinutes: out ? String(out) : "",
    backEnabled: def?.returnEnabled ?? true,
    backMinutes: back ? String(back) : "",
  };
}

/** 記録で保存した指定を、既定の上に重ねる。 */
export function applyOverride(base: SyncForm, override: WorkRecordOverride | null): SyncForm {
  if (!override) return base;
  const leg = (value: WorkLegOverride | undefined, enabled: boolean, minutes: string) => ({
    enabled: value?.enabled ?? enabled,
    minutes: value?.minutes != null ? String(value.minutes) : minutes,
  });
  const out = leg(override.outbound, base.outEnabled, base.outMinutes);
  const back = leg(override.return, base.backEnabled, base.backMinutes);
  return {
    workEnabled: override.workEnabled ?? base.workEnabled,
    start: override.startMinutes != null ? toTime(override.startMinutes) : base.start,
    end: override.endMinutes != null ? toTime(override.endMinutes) : base.end,
    outEnabled: out.enabled,
    outMinutes: out.minutes,
    backEnabled: back.enabled,
    backMinutes: back.minutes,
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
      enabled: boolean,
      text: string,
    ): WorkLegOverride | string => {
      if (!enabled) return { enabled: false, minutes: null };
      const minutes = Number(text);
      if (text.trim() === "" || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        return `${label}の所要時間（分）を入力してください。入力しない場合は${label}の反映をオフにしてください。`;
      }
      return { enabled: true, minutes };
    };
    const out = leg("往路", form.outEnabled, form.outMinutes);
    if (typeof out === "string") return { ok: false, message: out };
    const back = leg("復路", form.backEnabled, form.backMinutes);
    if (typeof back === "string") return { ok: false, message: back };
    payload.outbound = out;
    payload.return = back;
  }
  return { ok: true, payload };
}

/** 反映する内容の確認用の文面。反映OFFの項目は出さない。 */
export function describePlan(
  form: SyncForm,
  config: SyncConfig,
  context: SyncContext,
  dates: { startDate: string; endDate: string },
): string[] {
  const lines: string[] = [];
  const start = fromTime(form.start);
  const end = fromTime(form.end);
  const range = (from: number, to: number) => `${toTime(((from % 1440) + 1440) % 1440)}–${toTime(((to % 1440) + 1440) % 1440)}`;
  const span = dates.endDate && dates.endDate !== dates.startDate;
  if (form.workEnabled && start !== null && end !== null && end > start) {
    lines.push(`勤務予定 ${range(start, end)}${span ? "（期間の各日）" : ""}`);
  }
  if (commutes(config, context) && start !== null && end !== null && end > start) {
    const out = Number(form.outMinutes);
    if (form.outEnabled && out > 0) {
      lines.push(`往路 ${range(start - out, start)}${span ? `（${dates.startDate}）` : ""}`);
    }
    const back = Number(form.backMinutes);
    if (form.backEnabled && back > 0) {
      lines.push(`復路 ${range(end, end + back)}${span ? `（${dates.endDate}）` : ""}`);
    }
  }
  return lines;
}
