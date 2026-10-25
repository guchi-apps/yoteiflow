/**
 * 予定の前後の移動を探すときの検索条件を提案する（issue #1331・docs/spec.md §29）。
 *
 * 決めるのは「どこからどこへ・どの日時を基準に探すか」だけ。実際の列車・発着時刻はYahoo!乗換案内で
 * 利用者が選ぶ（#1330）。外部I/Oを持たない純粋関数で、周辺の予定・移動は
 * `GET /api/travels/context` が前後12時間ぶん渡す（表示中の月・日の範囲には依存しない）。
 *
 * - 予定前: 目的地＝対象予定の場所、到着＝開始−余裕分。出発地は直前の滞在場所（終わった予定の場所・
 *   着いた移動の目的地）を新しい順に、最後に既定の出発地（自宅）
 * - 予定後: 出発地＝対象予定の場所、出発＝終了＋余裕分。目的地は次の滞在場所（始まる予定の場所・
 *   出る移動の出発地）を早い順に、最後に自宅
 *
 * 候補は断定しない。理由を添えて並べ、利用者が選び直せるようにする。現在地（GPS）は使わない。
 */

import type { TravelSearchPurpose } from "@/types/calendar";

/** 提案に使う範囲。これより離れた予定は「その前後の滞在場所」とはみなさない */
export const TRANSIT_CONTEXT_HOURS = 12;

export type ContextEvent = {
  id: string;
  title: string;
  /** ISO 8601（終日はYYYY-MM-DD） */
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  /** 中止・不参加の記録がある（そこへは行っていない） */
  skipped: boolean;
};

export type ContextTravel = {
  id: string;
  start: string;
  end: string;
  origin: string;
  destination: string;
};

export type TransitTarget = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
};

export type PlaceCandidate = { text: string; reason: string };

export type TransitSuggestion = {
  purpose: TravelSearchPurpose;
  /** 予定前は到着、予定後は出発を基準に探す */
  basis: "arrive" | "depart";
  /** 基準の日時（ISO 8601）。対象予定が終日なら null（時刻が決まらない） */
  at: string | null;
  /** 対象予定の側の地点（予定前は目的地・予定後は出発地）。場所が無い・オンラインのみなら null */
  eventPlace: string | null;
  /** 反対側の地点の候補（先頭が提案）。無ければ空（入力してもらう） */
  candidates: PlaceCandidate[];
  /** 予定後の次の予定（到着期限の目安）。無ければ null */
  nextEvent: { title: string; start: string } | null;
  /** 予定前の直前の予定（これより前に出発すると予定の途中で抜けることになる）。無ければ null */
  previousEvent: { title: string; end: string } | null;
  /** 検索時刻に足した最寄り駅からの徒歩（分）。0なら足していない */
  walkMinutes: number;
  /** 断定できないことの断り（重なる予定・場所なし・候補が複数など） */
  notes: string[];
};

const HOUR_MS = 60 * 60 * 1000;

function usablePlace(location: string | null): string | null {
  const text = location?.trim();
  if (!text) return null;
  // 会議のリンクだけの予定（オンラインのみ）は、そこへ移動する場所ではない
  if (/^https?:\/\//i.test(text)) return null;
  return text;
}

function ms(iso: string): number {
  return new Date(iso).getTime();
}

export function suggestTransitSearch(input: {
  target: TransitTarget;
  purpose: TravelSearchPurpose;
  marginMinutes: number;
  events: ContextEvent[];
  travels: ContextTravel[];
  /** 設定の既定の出発地（自宅） */
  home: string | null;
  /** 編集中の移動。自分自身を「直前の移動」として拾わない */
  excludeTravelId?: string | null;
  /**
   * 予定の場所から最寄り駅までの徒歩（分・省略時は 0）。保存する余裕分には含めず、提案のたびに足す。
   * 予定前は到着を、予定後は出発をこの分だけ駅側へずらす。
   */
  walkMinutes?: number;
  /** 時刻の表示（設定タイムゾーンの H:mm） */
  formatTime: (iso: string) => string;
}): TransitSuggestion {
  const { target, purpose, formatTime } = input;
  const before = purpose === "BEFORE_EVENT";
  const notes: string[] = [];

  const eventPlace = usablePlace(target.location);
  if (!eventPlace) {
    notes.push(target.location?.trim() ? "予定の場所がオンライン（URL）のため、地点を入力してください。" : "予定に場所が無いため、地点を入力してください。");
  }

  if (target.allDay) {
    notes.push("終日の予定は時刻が決まらないため、日時を入力してください。");
    return { purpose, basis: before ? "arrive" : "depart", at: null, eventPlace, candidates: homeOnly(input.home), nextEvent: null, previousEvent: null, notes, walkMinutes: 0 };
  }

  const start = ms(target.start);
  const end = ms(target.end);
  const marginMs = Math.max(0, input.marginMinutes) * 60_000;
  const walkMs = Math.max(0, input.walkMinutes ?? 0) * 60_000;
  const at = new Date(before ? start - marginMs - walkMs : end + marginMs + walkMs).toISOString();
  const windowMs = TRANSIT_CONTEXT_HOURS * HOUR_MS;

  const events = input.events.filter((event) => event.id !== target.id && !event.allDay && !event.skipped);
  const overlapping = events.filter((event) => ms(event.start) < end && ms(event.end) > start);
  if (overlapping.length > 0) {
    notes.push(`同じ時間に重なる予定（${overlapping.map((event) => `「${event.title}」`).join("・")}）があります。地点を確かめてください。`);
  }
  const overlapIds = new Set(overlapping.map((event) => event.id));
  const travels = input.travels.filter((travel) => travel.id !== input.excludeTravelId);

  type Found = PlaceCandidate & { time: number };
  const found: Found[] = [];
  if (before) {
    for (const event of events) {
      const place = usablePlace(event.location);
      const time = ms(event.end);
      if (place && !overlapIds.has(event.id) && time <= start && time >= start - windowMs) {
        found.push({ text: place, time, reason: `直前の予定「${event.title}」（${formatTime(event.start)}–${formatTime(event.end)}）の場所` });
      }
    }
    for (const travel of travels) {
      const time = ms(travel.end);
      if (travel.destination.trim() && time <= start && time >= start - windowMs) {
        found.push({ text: travel.destination.trim(), time, reason: `${formatTime(travel.end)}に着く移動の目的地` });
      }
    }
    found.sort((a, b) => b.time - a.time);
  } else {
    for (const event of events) {
      const place = usablePlace(event.location);
      const time = ms(event.start);
      if (place && !overlapIds.has(event.id) && time >= end && time <= end + windowMs) {
        found.push({ text: place, time, reason: `次の予定「${event.title}」（${formatTime(event.start)}–${formatTime(event.end)}）の場所` });
      }
    }
    for (const travel of travels) {
      const time = ms(travel.start);
      if (travel.origin.trim() && time >= end && time <= end + windowMs) {
        found.push({ text: travel.origin.trim(), time, reason: `${formatTime(travel.start)}に出る移動の出発地` });
      }
    }
    found.sort((a, b) => a.time - b.time);
  }

  // 同じ場所は1つにまとめ、近い順に3件まで。自宅は最後に必ず選べるようにする
  const candidates: PlaceCandidate[] = [];
  for (const item of found) {
    if (candidates.length >= 3) break;
    if (!candidates.some((candidate) => candidate.text === item.text)) candidates.push({ text: item.text, reason: item.reason });
  }
  const sameTime = found.filter((item) => found[0] && item.time === found[0].time && item.text !== found[0].text);
  if (sameTime.length > 0) notes.push("同じ時刻の候補が複数あります。どれから（どこへ）向かうか選んでください。");
  for (const home of homeOnly(input.home)) {
    if (!candidates.some((candidate) => candidate.text === home.text)) candidates.push(home);
  }
  if (candidates.length === 0) {
    notes.push(before ? "出発地の候補がありません。出発地を入力してください（設定 ▸ 移動で既定の出発地を登録できます）。" : "目的地の候補がありません。目的地を入力してください。");
  }

  // 予定前は直前の予定、予定後は次の予定（場所の有無によらない）を、出発・到着の目安として示す
  const previous = before
    ? events
        .filter((event) => !overlapIds.has(event.id) && ms(event.end) <= start && ms(event.end) >= start - windowMs)
        .sort((a, b) => ms(b.end) - ms(a.end))[0] ?? null
    : null;
  const next = before
    ? null
    : events
        .filter((event) => ms(event.start) >= end && ms(event.start) <= end + windowMs)
        .sort((a, b) => ms(a.start) - ms(b.start))[0] ?? null;

  return {
    purpose,
    basis: before ? "arrive" : "depart",
    at,
    eventPlace,
    candidates,
    nextEvent: next ? { title: next.title, start: next.start } : null,
    previousEvent: previous ? { title: previous.title, end: previous.end } : null,
    notes,
    walkMinutes: Math.round(walkMs / 60_000),
  };
}

function homeOnly(home: string | null): PlaceCandidate[] {
  const text = home?.trim();
  return text ? [{ text, reason: "自宅（設定の既定の出発地）" }] : [];
}

/**
 * 選んだ経路（入力欄の発着時刻・ISO 8601）が、探した意図と食い違っていないか（共有で戻したあとの確認用）。
 * 保存は止めない。気付けるように文を返すだけ。
 */
export function transitRouteWarnings(input: {
  target: TransitTarget;
  purpose: TravelSearchPurpose;
  marginMinutes: number;
  /** 予定の場所の最寄り駅からの徒歩（分・省略時は 0）。予定前は到着の期限をこの分だけ早める */
  walkMinutes?: number;
  departAt: string;
  arriveAt: string;
  nextEvent: { title: string; start: string } | null;
  previousEvent: { title: string; end: string } | null;
  formatTime: (iso: string) => string;
}): string[] {
  if (input.target.allDay) return [];
  const depart = ms(input.departAt);
  const arrive = ms(input.arriveAt);
  if (Number.isNaN(depart) || Number.isNaN(arrive)) return [];
  const warnings: string[] = [];
  if (input.purpose === "BEFORE_EVENT") {
    const limit = ms(input.target.start) - (Math.max(0, input.marginMinutes) + Math.max(0, input.walkMinutes ?? 0)) * 60_000;
    if (arrive > ms(input.target.start)) warnings.push(`予定の開始（${input.formatTime(input.target.start)}）より後に着く経路です。`);
    else if (arrive > limit) warnings.push(`予定の${input.marginMinutes}分前（${input.formatTime(new Date(limit).toISOString())}）より後に着く経路です。`);
    if (input.previousEvent && depart < ms(input.previousEvent.end)) {
      warnings.push(`直前の予定「${input.previousEvent.title}」が終わる（${input.formatTime(input.previousEvent.end)}）前に出発する経路です。`);
    }
  } else {
    if (depart < ms(input.target.end)) warnings.push(`予定が終わる（${input.formatTime(input.target.end)}）前に出発する経路です。`);
    if (input.nextEvent && arrive > ms(input.nextEvent.start)) {
      warnings.push(`次の予定「${input.nextEvent.title}」の開始（${input.formatTime(input.nextEvent.start)}）に間に合わない経路です。`);
    }
  }
  return warnings;
}
