/**
 * 予定が変わったあと、紐づく公共交通の移動に検索条件を出し直すかを決める（issue #1332・docs/spec.md §29）。
 *
 * 電車は新しい時刻に便があるとは限らないため、移動は動かさない。ここで決めるのは「どの移動を・なぜ・
 * どんな条件で探し直すか」だけで、実際の経路はYahoo!乗換案内で利用者が選び、共有で戻して保存する（#1330）。
 *
 * 比べる相手は、アプリ内の変更なら編集前の予定、Google側の変更なら移動に保存した「探したときの予定の状態」
 * （`TravelItem.searchEvent`）。どちらも無い旧データは、明らかな食い違い（予定前なのに開始より後に着く・
 * 予定後なのに終了より前に出る）だけを拾う。外部APIへの往復も書き込みもしない純粋関数。
 */

import { travelRelation } from "@/lib/travel-relation";
import type { TransitSuggestion } from "@/lib/transit-suggest";
import { MAX_TRAVEL_SEARCH_MARGIN_MINUTES, type TravelSearchPurpose } from "@/types/calendar";

export type FollowEventState = {
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
};

export type FollowTransitTravel = {
  id: string;
  mode: string;
  start: string;
  end: string;
  origin: string;
  destination: string;
  linkedEventId: string | null;
  searchPurpose?: TravelSearchPurpose | null;
  searchMarginMinutes?: number | null;
  searchEvent?: { start: string; end: string; location: string | null } | null;
  followDismissedKey?: string | null;
};

export type TravelIntent = {
  purpose: TravelSearchPurpose;
  marginMinutes: number;
  /** 保存した意図が無く、日時から推した（旧データ・手入力）。画面で「推定」と示し、選び直させる */
  inferred: boolean;
};

/**
 * 移動を探したときの意図。保存した値があればそれを使い、無ければ探したときの予定（無ければ今の予定）との
 * 前後から推す。重なる移動は前後が決まらないため null。
 */
export function travelSearchIntent(
  travel: Pick<FollowTransitTravel, "start" | "end" | "searchPurpose" | "searchMarginMinutes">,
  event: Pick<FollowEventState, "start" | "end" | "allDay"> | null,
): TravelIntent | null {
  if (travel.searchPurpose) {
    return { purpose: travel.searchPurpose, marginMinutes: clampMargin(travel.searchMarginMinutes ?? 0), inferred: false };
  }
  if (!event) return null;
  const relation = travelRelation(travel, event);
  if (relation === "before") {
    return { purpose: "BEFORE_EVENT", marginMinutes: clampMargin((Date.parse(event.start) - Date.parse(travel.end)) / 60_000), inferred: true };
  }
  if (relation === "after") {
    return { purpose: "AFTER_EVENT", marginMinutes: clampMargin((Date.parse(travel.start) - Date.parse(event.end)) / 60_000), inferred: true };
  }
  return null;
}

function clampMargin(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.min(MAX_TRAVEL_SEARCH_MARGIN_MINUTES, Math.max(0, Math.round(minutes)));
}

export type TransitFollow = {
  travelId: string;
  intent: TravelIntent | null;
  /** 何が変わったか（「開始 14:00 → 15:00」「場所 本社 → 支社」） */
  reasons: string[];
  /** 変更の印。「今は変更しない」でこれを保存し、同じ変更では出さない */
  key: string;
  /** 提案できない理由（終日になった・前後が分からない）。空なら提案できる */
  missing: string[];
};

function placeText(location: string | null | undefined): string {
  return location?.trim() ?? "";
}

function sameInstant(a: string, b: string): boolean {
  return Date.parse(a) === Date.parse(b);
}

function isoKey(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : new Date(time).toISOString();
}

/**
 * 公共交通の移動について、予定の変更に合わせて探し直すべきかを返す。対象外・変わっていないなら null。
 *
 * - 予定前の移動は開始と場所、予定後の移動は終了と場所の変化だけを見る（終了だけ動いても予定前の移動は出さない）
 * - 前後が分からない移動は、開始・終了・場所のどれかが変われば出すが、条件は作らず不足として示す
 * - `previous` があればアプリ内の変更（編集前の予定と比べる）、無ければ保存した探したときの状態と比べる
 */
export function detectTransitFollow(input: {
  travel: FollowTransitTravel;
  current: FollowEventState;
  previous?: FollowEventState | null;
  /** 旧データで意図を推したときの到着の余裕分（設定の既定値） */
  defaultMarginMinutes?: number;
  /** 理由に添える日時（設定タイムゾーン。日付が違えば日付も出す形を呼び出し側で決める） */
  formatAt: (iso: string) => string;
}): TransitFollow | null {
  const { travel, current, formatAt } = input;
  if (travel.mode !== "PUBLIC_TRANSIT" || !travel.linkedEventId) return null;

  const searched = travel.searchEvent
    ? { start: travel.searchEvent.start, end: travel.searchEvent.end, allDay: false, location: travel.searchEvent.location }
    : null;
  const base = input.previous ?? searched;
  let intent = travelSearchIntent(travel, base && !base.allDay ? base : current.allDay ? null : current);
  let purpose = intent?.purpose ?? null;

  const reasons: string[] = [];
  const missing: string[] = [];

  if (base) {
    const startChanged = !sameInstant(base.start, current.start);
    const endChanged = !sameInstant(base.end, current.end);
    const placeChanged = placeText(base.location) !== placeText(current.location);
    const allDayChanged = base.allDay !== current.allDay;
    const relevant =
      allDayChanged ||
      placeChanged ||
      (purpose === "BEFORE_EVENT" ? startChanged : purpose === "AFTER_EVENT" ? endChanged : startChanged || endChanged);
    if (!relevant) return null;
    if (purpose !== "AFTER_EVENT" && startChanged && !current.allDay) {
      reasons.push(`開始 ${formatAt(base.start)} → ${formatAt(current.start)}`);
    }
    if (purpose !== "BEFORE_EVENT" && endChanged && !current.allDay) {
      reasons.push(`終了 ${formatAt(base.end)} → ${formatAt(current.end)}`);
    }
    if (placeChanged) reasons.push(`場所 ${placeText(base.location) || "（なし）"} → ${placeText(current.location) || "（なし）"}`);
  } else {
    // 探したときの状態を持たない旧データ。Google側で変わったかは分からないため、明らかな食い違い
    // （開始をまたいで着く・終了をまたいで出る）だけ拾う。今の予定とは重なってしまうので、意図はまたぎ方から推す
    if (current.allDay) return null;
    const departs = Date.parse(travel.start);
    const arrives = Date.parse(travel.end);
    const start = Date.parse(current.start);
    const end = Date.parse(current.end);
    const margin = clampMargin(input.defaultMarginMinutes ?? 0);
    const declared = travel.searchPurpose ?? null;
    if ((declared ?? "BEFORE_EVENT") === "BEFORE_EVENT" && departs < start && arrives > start) {
      reasons.push(`予定の開始（${formatAt(current.start)}）より後に着く移動です`);
      intent = intent ?? { purpose: "BEFORE_EVENT", marginMinutes: margin, inferred: true };
    } else if ((declared ?? "AFTER_EVENT") === "AFTER_EVENT" && departs < end && arrives > end) {
      reasons.push(`予定の終了（${formatAt(current.end)}）より前に出る移動です`);
      intent = intent ?? { purpose: "AFTER_EVENT", marginMinutes: 0, inferred: true };
    } else {
      return null;
    }
    purpose = intent.purpose;
  }

  if (current.allDay) missing.push("予定が終日になったため、到着・出発の基準になる時刻がありません。移動の時刻を確かめてください。");
  else if (!intent) missing.push("予定の前後どちらの移動か分からないため（予定と時間が重なっています）、条件を作れません。移動を開いて確かめてください。");

  const anchor = current.allDay ? "allday" : purpose === "AFTER_EVENT" ? isoKey(current.end) : purpose === "BEFORE_EVENT" ? isoKey(current.start) : `${isoKey(current.start)}~${isoKey(current.end)}`;
  const key = `${purpose ?? "RELATED"}|${anchor}|${placeText(current.location)}`;
  if (travel.followDismissedKey === key) return null;

  return { travelId: travel.id, intent, reasons, key, missing };
}

export type FollowSearchCondition = {
  origin: string;
  destination: string;
  /** ISO 8601。基準の側は提案の時刻、反対側は今の移動の所要時間で仮に置く（Yahoo!が実際の便で決め直す） */
  departAt: string;
  arriveAt: string;
  basis: "depart" | "arrive";
};

const HOME_REASON = "自宅";

/**
 * 提案（`suggestTransitSearch()` の結果）から、探し直す条件を組み立てる。
 * 予定の側の地点は変更後の予定の場所（無ければ今の移動の地点）。反対側は、近くの予定・移動から拾えた候補が
 * あればそれ、無ければ今の移動の地点のまま（既定の出発地＝自宅へ黙って戻さない）。時刻が決まらなければ null。
 */
export function followSearchCondition(
  travel: Pick<FollowTransitTravel, "start" | "end" | "origin" | "destination">,
  suggestion: TransitSuggestion,
): FollowSearchCondition | null {
  if (!suggestion.at) return null;
  const at = Date.parse(suggestion.at);
  const duration = Math.max(60_000, Date.parse(travel.end) - Date.parse(travel.start) || 0);
  const nearby = suggestion.candidates.find((candidate) => !candidate.reason.startsWith(HOME_REASON))?.text ?? null;
  if (suggestion.purpose === "BEFORE_EVENT") {
    return {
      origin: nearby ?? travel.origin,
      destination: suggestion.eventPlace ?? travel.destination,
      departAt: new Date(at - duration).toISOString(),
      arriveAt: new Date(at).toISOString(),
      basis: "arrive",
    };
  }
  return {
    origin: suggestion.eventPlace ?? travel.origin,
    destination: nearby ?? travel.destination,
    departAt: new Date(at).toISOString(),
    arriveAt: new Date(at + duration).toISOString(),
    basis: "depart",
  };
}
