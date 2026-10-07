// iPhoneウィジェットが読む面ごとの応答（docs/spec.md §28）。
//
// 台本（Scriptable）は1本で、ウィジェットを編集の `Parameter` に入れた値でどの面を出すかが
// 決まる。面ごとに読む先が違う（予定はGoogle、タスク・買い物はNotion）ため、応答も面ごとに
// 分けている。1つにまとめると、買い物リストを見るためだけの更新でもGoogle Calendarへ
// 問い合わせることになる（docs/spec.md §20）。

import type { EventOutcomeKind, TravelMode } from "@/types/calendar";

/** ウィジェットに出せる面。`activity` は Parameter が空のときの既定。 */
export const WIDGET_VIEWS = ["activity", "schedule", "tasks", "shopping"] as const;

export type WidgetView = (typeof WIDGET_VIEWS)[number];

/**
 * どの面にも付く土台。
 *
 * `now` はサーバーが応答を作った時刻。過ぎた予定かどうかの判定も、枠に出す「10:54 時点」も
 * これで決める。端末の時計がずれていると、まだ始まっていない予定が「済み」になるため。
 */
type WidgetPayloadBase = {
  timeZone: string;
  now: string;
};

// --- 今日の予定 ---

/** 予定を出せなかった理由。ウィジェットに何が足りないかを出すために分ける。 */
export type WidgetScheduleUnavailable = "google_not_connected" | "google_unavailable";

/**
 * 今日の1件。予定（Google Calendar）と移動（DaySpanのDB）を同じ形で並べる。
 *
 * 移動を混ぜるのは、出発時刻がまさにホーム画面で読みたい値のため。DaySpanのDBの読み取り
 * だけで済み、外部APIへの往復は増えない。日付リマインド・ゴミの日は混ぜない（Notionへの
 * 往復が5分ごとに増えるため）。
 */
export type WidgetScheduleItem = {
  kind: "event" | "travel";
  title: string;
  allDay: boolean;
  /** 終日は null。時刻ありは ISO 8601。 */
  start: string | null;
  end: string | null;
  /** 予定は場所、移動は所要時間。無ければ null。 */
  detail: string | null;
  /** 移動の交通手段。予定は null。 */
  mode: TravelMode | null;
  /** 移動の出発地・目的地（場所名のみ）。予定は null。title は目的地だけなので、行き先を並べて出すために別に持つ。 */
  origin: string | null;
  destination: string | null;
  /** 中止・不参加の記録（docs/spec.md §37）。付いていなければ null。 */
  outcome: EventOutcomeKind | null;
  /** 応答を作った時点で終わっているか。判定はサーバーの `now` で行う。 */
  past: boolean;
};

export type WidgetSchedulePayload = WidgetPayloadBase & {
  /** 設定タイムゾーンでの今日（YYYY-MM-DD）。 */
  date: string;
  /** これからのものが先、過ぎたものが後。どちらも時刻順で、終日は先頭。 */
  items: WidgetScheduleItem[];
  unavailable: WidgetScheduleUnavailable | null;
};

// --- タスク ---

export type WidgetTasksUnavailable = "notion_not_connected" | "notion_unavailable";

/** 分類はタスク画面と同じ軸（期限）。`classifyTasks()` の区分をそのまま持つ。 */
export type WidgetTaskBucket = "overdue" | "today" | "upcoming";

export type WidgetTaskItem = {
  title: string;
  bucket: WidgetTaskBucket;
  /** 「3日超過」「今日 17:00」「9/8」。日付の言葉はサーバー側で作る（台本に日付の解釈を持たせない）。 */
  dueLabel: string;
  /** 優先度。行左端の帯に使う。タスク画面と同じ示し方に揃える。 */
  priority: string | null;
};

export type WidgetTasksPayload = WidgetPayloadBase & {
  /** アプリアイコンのバッジと同じ数え方（期限が今日以前の未完了）。 */
  overdueCount: number;
  todayCount: number;
  /** 期限のある未完了タスクの総数。「ほか N件」に使う。 */
  total: number;
  /** 期限切れ → 今日 → これから の順。返すのは大きい枠に入るぶんまで。 */
  items: WidgetTaskItem[];
  unavailable: WidgetTasksUnavailable | null;
};

// --- 買い物リスト ---

export type WidgetShoppingUnavailable = "shopping_not_ready" | "notion_unavailable";

export type WidgetShoppingItem = {
  name: string;
  /** 売り場。未設定は null（一覧では「その他」に束ねている区分）。 */
  category: string | null;
  priority: string | null;
};

export type WidgetShoppingPayload = WidgetPayloadBase & {
  /** まだ買っていないものの数。 */
  remaining: number;
  items: WidgetShoppingItem[];
  unavailable: WidgetShoppingUnavailable | null;
};
