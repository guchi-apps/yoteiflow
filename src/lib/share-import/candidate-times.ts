import type { ShareRouteCandidate } from "@/lib/share-import/types";

export type TravelInputTimes = { departAt: string; arriveAt: string };

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
): TravelInputTimes {
  const place = (iso: string, reference: string) => {
    const local = toLocal(iso);
    return keepDateOf ? `${reference.slice(0, 10)}${local.slice(10)}` : local;
  };
  const format = (ms: number) => new Date(ms).toISOString().slice(0, 16);
  const ms = (local: string) => new Date(`${local}:00Z`).getTime();

  if (candidate.startAt || candidate.endAt) {
    const departAt = candidate.startAt ? place(candidate.startAt, keepDateOf?.departAt ?? current.departAt) : "";
    const arriveAt = candidate.endAt ? place(candidate.endAt, keepDateOf?.arriveAt ?? current.arriveAt) : "";
    return { departAt, arriveAt };
  }
  // 指定日時が無い共有: 利用者が入れている出発時刻を起点に、代表時間があるときだけ到着を求める
  if (candidate.minutes !== null && current.departAt) {
    return { departAt: current.departAt, arriveAt: format(ms(current.departAt) + candidate.minutes * 60_000) };
  }
  return { departAt: current.departAt, arriveAt: "" };
}
