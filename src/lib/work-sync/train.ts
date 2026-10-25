import type { WorkTrainItem } from "@/lib/work-sync/plan";

/**
 * 「よく使う電車」（`WorkTrain`・issue #1347）の入力検証と表示用の計算。DBにも外部APIにも触らない。
 */

export type TrainInput = Omit<WorkTrainItem, "id">;

export type TrainParse = { ok: true; train: TrainInput } | { ok: false; message: string };

const MAX_DURATION = 1440;

/** 出発・到着の時刻（0時からの分）から所要分を求める。到着が出発以前なら翌日の到着とみなす。 */
export function trainDuration(departMinutes: number, arriveMinutes: number): number {
  const diff = arriveMinutes - departMinutes;
  return diff > 0 ? diff : diff + 1440;
}

export function parseTrainInput(raw: unknown): TrainParse {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "電車の指定が正しくありません。" };
  }
  const body = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const origin = text(body.origin);
  const destination = text(body.destination);
  const label = text(body.label);
  if (!origin || !destination) return { ok: false, message: "出発地と行き先を入力してください。" };
  if (origin === destination) return { ok: false, message: "出発地と行き先が同じです。" };
  if (origin.length > 191 || destination.length > 191) {
    return { ok: false, message: "出発地・行き先が長すぎます。" };
  }
  if (!label) return { ok: false, message: "電車の名前を入力してください。" };
  if (label.length > 191) return { ok: false, message: "電車の名前が長すぎます。" };

  const depart = body.departMinutes;
  if (typeof depart !== "number" || !Number.isInteger(depart) || depart < 0 || depart > 1439) {
    return { ok: false, message: "出発時刻が正しくありません。" };
  }
  const duration = body.durationMinutes;
  if (
    typeof duration !== "number" ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > MAX_DURATION
  ) {
    return { ok: false, message: "所要時間は1〜1440分で入力してください。" };
  }
  return {
    ok: true,
    train: { origin, destination, label, departMinutes: depart, durationMinutes: duration },
  };
}

/**
 * 往路の電車が勤務開始に間に合うか。到着（出発 + 所要）が勤務開始より後なら間に合わない。
 * 戻り値は遅れる分（間に合うなら null）。
 */
export function lateByForOutbound(train: WorkTrainItem, workStartMinutes: number): number | null {
  const arrive = train.departMinutes + train.durationMinutes;
  return arrive > workStartMinutes ? arrive - workStartMinutes : null;
}

/** 復路の電車が勤務終了より前に出るか。出発が勤務終了より前なら早すぎる。戻り値は早い分。 */
export function earlyByForReturn(train: WorkTrainItem, workEndMinutes: number): number | null {
  return train.departMinutes < workEndMinutes ? workEndMinutes - train.departMinutes : null;
}
