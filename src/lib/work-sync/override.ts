import type { WorkLegOverride, WorkRecordOverride } from "@/lib/work-sync/plan";

/**
 * 入力画面から送られた「この記録だけの反映の指定」を検証して整える純粋関数
 * （docs/spec.md §46・issue #1099）。DBにも外部APIにも触らない。
 */

const isMinutes = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1439;

const isLegMinutes = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1440;

function parseLeg(raw: unknown, label: string): WorkLegOverride | string {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object") return `${label}の指定が正しくありません。`;
  const { enabled, minutes } = raw as Record<string, unknown>;
  const leg: WorkLegOverride = {};
  if (enabled !== undefined) {
    if (typeof enabled !== "boolean") return `${label}の反映の指定が正しくありません。`;
    leg.enabled = enabled;
  }
  if (minutes !== undefined && minutes !== null) {
    // 反映をオフにした項目の時間は問わない（空・不正でも要求しない）。
    if (enabled === false) {
      leg.minutes = null;
    } else if (!isLegMinutes(minutes)) {
      return `${label}の所要時間は1〜1440分で入力してください。`;
    } else {
      leg.minutes = minutes;
    }
  } else if (minutes === null) {
    leg.minutes = null;
  }
  return leg;
}

export type OverrideParse =
  | { ok: true; override: WorkRecordOverride }
  | { ok: false; message: string };

export function parseWorkOverride(raw: unknown): OverrideParse {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "勤務予定・移動の指定が正しくありません。" };
  }
  const body = raw as Record<string, unknown>;
  const override: WorkRecordOverride = {};

  if (body.workEnabled !== undefined) {
    if (typeof body.workEnabled !== "boolean") {
      return { ok: false, message: "勤務予定の反映の指定が正しくありません。" };
    }
    override.workEnabled = body.workEnabled;
  }

  for (const key of ["startMinutes", "endMinutes"] as const) {
    const value = body[key];
    if (value === undefined || value === null) {
      if (value === null) override[key] = null;
      continue;
    }
    if (!isMinutes(value)) {
      return {
        ok: false,
        message: `勤務${key === "startMinutes" ? "開始" : "終了"}の時刻が正しくありません。`,
      };
    }
    override[key] = value;
  }
  if (
    override.startMinutes != null &&
    override.endMinutes != null &&
    override.endMinutes <= override.startMinutes
  ) {
    return { ok: false, message: "勤務終了は開始より後にしてください。" };
  }

  const outbound = parseLeg(body.outbound, "往路");
  if (typeof outbound === "string") return { ok: false, message: outbound };
  const back = parseLeg(body.return, "復路");
  if (typeof back === "string") return { ok: false, message: back };
  if (Object.keys(outbound).length > 0) override.outbound = outbound;
  if (Object.keys(back).length > 0) override.return = back;

  return { ok: true, override };
}

/** DBのJSONを読み戻す。壊れた値は指定なしとして扱う（既定へ落ちる）。 */
export function readStoredOverride(value: unknown): WorkRecordOverride | null {
  const parsed = parseWorkOverride(value);
  return parsed.ok ? parsed.override : null;
}
