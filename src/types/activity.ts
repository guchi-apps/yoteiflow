// 活動記録が扱う表示用の型（docs/spec.md §27）。
// 進行中の1件だけがDaySpanのDBにあり、終わった記録はGoogle Calendarの予定になる。

/** 記録を始めるときに押す選択肢（睡眠・仕事など）。 */
export type ActivityPresetItem = {
  id: string;
  name: string;
  /** アイコンのキー。未設定は null（名前から既定を引く。resolveActivityIcon）。 */
  icon: string | null;
};

/**
 * いま記録している最中の1件。終わるまでGoogle Calendarには存在しない。
 *
 * 保存先は記録全体で1つ（設定）だが、始めた時点の値をここへ写して持つ。
 * 記録中に設定を変えても、その記録は始めたときの保存先へ入る。
 */
export type RunningActivityItem = {
  title: string;
  calendarId: string;
  /** 開始日時（ISO 8601）。 */
  startedAt: string;
  /** 保存先カレンダーの色。時間グリッドの記録中の帯だけが使う（画面側で補う）。 */
  color?: string | null;
};

/**
 * どの画面からでも記録中を示すための最小限の情報（issue #629）。
 *
 * ナビの点は真偽値だけで足りるが、何を記録しているか・どれだけ経ったかを出すにはこの2つが要る。
 */
export type RunningActivitySummary = Pick<RunningActivityItem, "title" | "startedAt">;

/** 記録の停止で作られた予定がかかる時間帯。呼び出し側がその範囲だけ取り直すために返す。 */
export type ActivitySavedRange = { start: string; end: string };

/** 今日の記録を項目名でまとめた1行。 */
export type ActivityTotalItem = { title: string; minutes: number };

/**
 * 今日どれに何分使ったか。保存先カレンダーを指定しているときだけ求められる（docs/spec.md §28）。
 * 記録中のぶんも含めた、その時点までの合計。
 */
export type ActivityTodayTotals = {
  /** 設定タイムゾーンでの今日（YYYY-MM-DD）。 */
  date: string;
  totalMinutes: number;
  /** 項目名ごとの合計。長い順。 */
  items: ActivityTotalItem[];
  /** 直前に終わった記録。停止中のウィジェットに「最後は何を何時まで」を出すために使う。 */
  last: { title: string; endedAt: string } | null;
};

/** 今日の集計を出せなかった理由。ウィジェットに何が足りないかを出すために分ける。 */
export type ActivityTodayUnavailable = "calendar_not_selected" | "google_unavailable";

/**
 * iPhoneウィジェットへ返す活動記録の一式（docs/spec.md §28）。
 *
 * 経過時間はサーバーの時計で決める。端末の時計がずれていると、そのぶんずれた時間が出る
 * （記録そのものの時刻も、指定が無ければサーバーの時計で決めている＝§27）。
 */
export type ActivityWidgetSummary = {
  timeZone: string;
  /** サーバーが応答を作った時刻。ウィジェットは「いつ時点の値か」をこれで出す。 */
  now: string;
  running: (RunningActivityItem & { elapsedMinutes: number }) | null;
  today: ActivityTodayTotals | null;
  /** today が null のときだけ理由が入る。 */
  todayUnavailable: ActivityTodayUnavailable | null;
};
