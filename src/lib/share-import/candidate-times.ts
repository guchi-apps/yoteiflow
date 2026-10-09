import type { ShareRouteCandidate } from "@/lib/share-import/types";

export type TravelInputTimes = { departAt: string; arriveAt: string };

/** 利用者が固定する側。出発基準は到着＝出発＋所要時間、到着基準は出発＝到着−所要時間（issue #1203） */
export type TimeBasis = "depart" | "arrive";

const formatLocal = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const localMs = (local: string) => new Date(`${local}:00Z`).getTime();

/**
 * 日時の指定が無い共有の出発の初期値（入力欄の形式）。利用者のタイムゾーンの「いま」（分単位）。
 * 閲覧中のカレンダーの日付には依らない。`toLocal` は ISO→入力欄形式（`isoToLocalInput` の設定タイムゾーン適用版）。
 */
export function nowLocalInput(now: Date, toLocal: (iso: string) => string): string {
  return toLocal(now.toISOString());
}

/**
 * 基準側の日時と所要時間（分）から反対側を求める。所要時間が未取得（null）・基準側が空なら空文字（手入力で補う）。
 * 日付またぎは Date の演算でそのまま繰り上がる。
 */
export function deriveOtherSide(basis: TimeBasis, fixedLocal: string, minutes: number | null): string {
  if (minutes === null || !fixedLocal) return "";
  const base = localMs(fixedLocal);
  if (Number.isNaN(base)) return "";
  return formatLocal(basis === "depart" ? base + minutes * 60_000 : base - minutes * 60_000);
}

/**
 * 選んだ経路候補から、移動の入力欄（YYYY-MM-DDTHH:mm）へ入れる出発・到着時刻を求める（issue #1168）。
 *
 * 候補の開始・終了は、共有で固定された日時と**その候補の代表時間だけ**から求めた値。現在の入力欄の長さ
 * （別候補を選んだ結果）は引き継がず、反対側が決まらない候補（代表時間なし）では空にして入力を促す。
 * 予定に紐づく移動（`keepDateOf`）は予定の日を動かさず時刻だけ取り込む。
 */
export function candidateFormTimes(
  candidate: Pick<ShareRouteCandidate, "startAt" | "endAt" | "minutes">,
  current: TravelInputTimes,
  toLocal: (iso: string) => string,
  keepDateOf: TravelInputTimes | null = null,
  basis: TimeBasis = "depart",
): TravelInputTimes {
  const place = (iso: string, reference: string) => {
    const local = toLocal(iso);
    return keepDateOf ? `${reference.slice(0, 10)}${local.slice(10)}` : local;
  };
  if (candidate.startAt || candidate.endAt) {
    const departAt = candidate.startAt ? place(candidate.startAt, keepDateOf?.departAt ?? current.departAt) : "";
    const arriveAt = candidate.endAt ? place(candidate.endAt, keepDateOf?.arriveAt ?? current.arriveAt) : "";
    return { departAt, arriveAt };
  }
  // 指定日時が無い共有: 利用者が選んだ基準側（既定は出発）を保ち、代表時間があるときだけ反対側を求める
  if (basis === "arrive") {
    const departAt = deriveOtherSide("arrive", current.arriveAt, candidate.minutes);
    return { departAt: departAt || current.departAt, arriveAt: current.arriveAt };
  }
  return { departAt: current.departAt, arriveAt: deriveOtherSide("depart", current.departAt, candidate.minutes) };
}
