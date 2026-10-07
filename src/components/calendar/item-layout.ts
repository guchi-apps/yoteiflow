import { dateKeyDiffDays } from "@/lib/calendar-range";
import type { CalendarEventItem, CalendarItem, ReminderItem, TaskItem } from "@/types/calendar";

// 日付・時刻の解釈は、ユーザー設定のタイムゾーン（既定 Asia/Tokyo）で固定する。
// 実行環境のローカル時刻に依存させると、サーバー（VPSはUTC）とブラウザ（JST）で
// 描画結果がずれ、ハイドレーションが一致しなくなるため。

export const MINUTES_PER_DAY = 24 * 60;

// 1時間あたりの高さ（px）。ピンチで変えられるため定数ではなく初期値として扱う（docs/spec.md §6）。
export const DEFAULT_HOUR_HEIGHT = 48;
// 縮めきった状態でも一日ぶんの並びが読み取れ、広げきった状態でも15分の予定が掴める幅に収める。
export const MIN_HOUR_HEIGHT = 24;
export const MAX_HOUR_HEIGHT = 192;

/** 予定ブロックの最小の高さ（px）。極端に短い予定でもタイトルが読めるようにする。 */
export const MIN_EVENT_HEIGHT = 16;

/**
 * 活動記録を置く、日ごとの列の左端のレーンの幅（px）。
 *
 * 記録は後から見返す事実で、これから動くために見る予定とは読む理由が違う（docs/spec.md §27）。
 * 予定と同じ幅を取ると、睡眠のような長い記録が入った日は時間グリッドがほぼ記録の面になり、
 * 同じ時間帯の予定・移動がその半分へ押し込まれる（issue #327）。
 *
 * 幅は縦書きにした項目名（9px）が通るところまで。左の縦帯（3px）と枠線（1px）を除いた
 * 12pxが文字の通り道になる。これより細くすると帯だけになり、何の記録かが押すまで分からない。
 */
export const ACTIVITY_LANE_WIDTH = 16;

/** レーンと、その右に置く予定・移動との間隔（px）。枠線どうしが接して1本の線に見えるのを防ぐ。 */
export const ACTIVITY_LANE_GAP = 2;

/** 予定ブロックの本文1行の高さ（px）。text-[11px] / leading-tight の組み合わせに合わせる。 */
const EVENT_LINE_HEIGHT = 14;

/** 予定ブロックの上下の余白（px）。py-0.5 の上下ぶん。 */
const EVENT_BLOCK_PADDING_Y = 4;

/**
 * 予定ブロックの高さに何行ぶんの文字が収まるかを返す。
 *
 * 収まる行数ぶんだけ、タイトルの下へ時刻・場所・説明を順に添える（issue #73）。
 * 高さはピンチの倍率と予定の長さで決まるため、描画のたびに求める。
 * タイトルだけは高さが足りなくても出すため、最低でも1を返す。
 */
export function eventTextLines(height: number): number {
  return Math.max(1, Math.floor((height - EVENT_BLOCK_PADDING_Y) / EVENT_LINE_HEIGHT));
}

/**
 * 印（タスクの期限・予定日、日付リマインド）を縦に積むときの1行の高さ（px）。
 *
 * 印はラベル（項目名）だけの高さしか持たず、そのままでは近い時刻の印が同じ位置に重なって
 * 上の1件しか読めない（issue #331）。予定のように幅を分け合わせないのは、印の中身が
 * 項目名そのもので削るところが無いため（2件で「資料提…」、3件で「資」まで縮む）。
 *
 * 値はラベルの高さ（type-label-small の行送り16px＋上下の枠線1px）に、
 * 枠線どうしが1本に見えないだけの隙間2pxを足したもの。
 */
export const MARK_ROW_HEIGHT = 20;

/** 引き出し線が縦棒のすぐ右で折れるまでの距離（px）。 */
export const MARK_ELBOW_WIDTH = 6;

/**
 * 重なる印のラベルを縦に積む。時刻の早い順に置き、前の行と重なるぶんだけ下へ送る。
 *
 * 受けるのは分ではなく px。ずらす量は表示中の高さ（ピンチの倍率）で決まり、拡大して
 * 十分に離れた印はそのまま本来の位置へ戻る。予定の列分割（layoutOverlaps）を既定の倍率で
 * 固定しているのとは逆の判断で、あちらは倍率を変えるたびに左右の並び順が入れ替わると
 * 読み直しになるのに対し、印は縦の押し出しが解けるだけで並び順は変わらないため。
 *
 * 基本は下へ送る（先に読んだ位置から印が上がると、時刻の順に読んでいる目とすれ違う）。
 * ただし 24:00 の側へはみ出すぶんは上へ返す。時間グリッドの外は切り落とされるため、
 * 深夜の印を下へ送り続けると、重なりの代わりにラベルが画面から消える。
 *
 * @param bottom ラベルを置ける下限（px）。省略すると下へ送りっぱなしにする。
 */
export function stackMarkTops(
  marks: { key: string; top: number }[],
  bottom?: number,
): Map<string, number> {
  // 同じ時刻の印はキーで並びを決める。順序が入力の順に依存すると、サーバーとブラウザで
  // 並びが食い違ってハイドレーションが一致しなくなる。
  const sorted = [...marks].sort((a, b) => a.top - b.top || a.key.localeCompare(b.key));

  const placed: number[] = [];
  let last = Number.NEGATIVE_INFINITY;

  for (const mark of sorted) {
    last = Math.max(mark.top, last + MARK_ROW_HEIGHT);
    placed.push(last);
  }

  if (bottom !== undefined) {
    // 下端から順に押し返す。1件が下限に当たると、その上の行も間隔ぶんずつ引き上げられる。
    let limit = bottom;

    for (let index = placed.length - 1; index >= 0; index -= 1) {
      // 一日ぶんの高さに収まりきらないときは、上端で重なりが残る。画面の外へ出して
      // 消してしまうより、読めない1行が残るほうが、何件あるかだけでも分かる。
      placed[index] = Math.max(Math.min(placed[index], limit), MARK_ROW_HEIGHT / 2);
      limit = placed[index] - MARK_ROW_HEIGHT;
    }
  }

  return new Map(sorted.map((mark, index) => [mark.key, placed[index]]));
}

/**
 * 重なり判定での予定の最小の長さ（分）。
 *
 * 画面上は最小の高さぶんの場所を取るため、その高さを既定の倍率で分に直した値を使う。
 * 実際の高さで判定すると、ピンチで倍率を変えるたびに短い予定の列の並びが変わってしまう。
 */
const MIN_EVENT_MINUTES = (MIN_EVENT_HEIGHT / DEFAULT_HOUR_HEIGHT) * 60;

/**
 * タスクがカレンダーに現れる日付の種類（docs/spec.md §5）。
 *
 * 期限は締切、予定日はその辺りで片付けるつもりだという見込み。1つのタスクが
 * 別々の日に2つ現れるため、日付そのものではなく「どちらの日付か」を持ち回る。
 */
export type TaskDateField = "due" | "planned";

/** カレンダー上の1枠。タスクは期限と予定日で別の枠になるため、どちらの日付かを併せて持つ。 */
export type PlacedItem = { item: CalendarItem; taskField?: TaskDateField };

/** タスクが持つ、その種類の日付。 */
export function taskDateOf(
  task: TaskItem,
  field: TaskDateField,
): { date: string | null; hasTime: boolean } {
  return field === "planned"
    ? { date: task.planned, hasTime: task.plannedHasTime }
    : { date: task.due, hasTime: task.hasTime };
}

export type TaskOccurrence = {
  task: TaskItem;
  field: TaskDateField;
  /** この枠が指す日付。時刻なしは YYYY-MM-DD、時刻ありは ISO 8601。 */
  date: string;
  hasTime: boolean;
  /**
   * 枠の識別子。1つのタスクが期限と予定日で2枠に現れるため、IDだけでは区別できない
   * （どちらを掴んでいるのか・どちらのキーなのかが決まらなくなる）。
   */
  key: string;
};

export function taskOccurrenceKey(taskId: string, field: TaskDateField): string {
  return `${taskId}:${field}`;
}

/**
 * タスクの枠をカレンダーへ置く日付。期限切れの期限だけは今日へ寄せる。
 *
 * 元の期限値をここで書き換えると、詳細表示・ドラッグ・保存が「今日を期限として保存する」操作に
 * 変わってしまう。そのため `TaskOccurrence.date` は一次情報源のままにし、配置側だけがこの日付を使う。
 */
export function taskOccurrenceCalendarDate(
  occurrence: TaskOccurrence,
  itemDateKey: (date: string) => string,
  todayKey: string,
): string {
  const dateKey = itemDateKey(occurrence.date);
  return occurrence.field === "due" && dateKey < todayKey ? todayKey : dateKey;
}

/**
 * タスクをカレンダーに置く枠。期限と予定日の両方があれば2枠になる。
 *
 * 同じ場所へ2つ並べても読める情報は増えず、同じタイトルが2行に見えるだけのため、
 * 行き先が重なる枠は期限の1つにまとめる。ただし「同じ場所」の意味は画面で違う。
 *
 * - 時間グリッド: 日と時刻で位置が決まる。日時が同じときだけまとめる（既定）
 * - 月表示: 位置は日までしか分かれない。`toDateKey` を渡すと、時刻が違っても同じ日ならまとめる
 *
 * 月表示で日時まで見て分けると、時刻を持たない期限と時刻のある予定日が同じマスに並ぶ。
 * 狭い画面では時刻そのものを出していないため、まったく同じ行が2つ重なって見える（issue #338）。
 */
export function taskOccurrences(
  task: TaskItem,
  /** 同じ日なら1枠にまとめる画面（月表示）が渡す、日付キーへの変換。 */
  toDateKey?: (date: string) => string,
  /** 期限切れを寄せる表示上の今日。月表示だけが日単位で枠をまとめるために渡す。 */
  todayKey?: string,
): TaskOccurrence[] {
  const occurrences: TaskOccurrence[] = [];

  for (const field of ["due", "planned"] as const) {
    const { date, hasTime } = taskDateOf(task, field);
    if (!date) continue;
    if (field === "planned" && plannedMergesIntoDue(task, toDateKey, todayKey)) continue;

    occurrences.push({ task, field, date, hasTime, key: taskOccurrenceKey(task.id, field) });
  }

  return occurrences;
}

/** 予定日の枠が期限の枠へまとまるか。まとめる単位は画面ごとに違う（月表示は日まで）。 */
function plannedMergesIntoDue(
  task: TaskItem,
  toDateKey?: (date: string) => string,
  todayKey?: string,
): boolean {
  if (!task.due || !task.planned) return false;
  if (!toDateKey) {
    // 時間グリッドは同じ日時だけをまとめる。期限が今日より前なら期限だけが今日へ移るため、
    // 元の日時が同じでも予定日の枠を落とさない。
    if (todayKey && task.due.slice(0, 10) < todayKey) return false;
    return task.planned === task.due;
  }

  const due = taskOccurrenceCalendarDate(
    { task, field: "due", date: task.due, hasTime: task.hasTime, key: taskOccurrenceKey(task.id, "due") },
    toDateKey,
    todayKey ?? toDateKey(task.due),
  );
  const planned = toDateKey(task.planned);
  return planned === due;
}

/**
 * その枠が表している日付（docs/spec.md §5）。
 *
 * 同じ場所に落ちる期限と予定日は期限の1枠にまとめるため、期限の枠が予定日も表していることが
 * ある。まとめたことで片方の紐づけの印・ずれが画面のどこにも出なくなるのを防ぐため、
 * 枠を描く側がここで確かめる（docs/spec.md §31）。
 */
export function taskFieldsInFrame(
  task: TaskItem,
  field: TaskDateField,
  toDateKey?: (date: string) => string,
  todayKey?: string,
): TaskDateField[] {
  if (field !== "due") return [field];
  return plannedMergesIntoDue(task, toDateKey, todayKey) ? ["due", "planned"] : ["due"];
}

type ZonedParts = { dateKey: string; hour: number; minute: number };

function zonedParts(date: Date, formatter: Intl.DateTimeFormat): ZonedParts {
  const parts = formatter.formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export type CalendarDateUtils = ReturnType<typeof createCalendarDateUtils>;

export function createCalendarDateUtils(timeZone: string) {
  // Intl.DateTimeFormat の生成は重い。月表示は1度の描画で数万回この変換を通るため、
  // 呼び出しのたびに作ると描画がそれだけで数秒かかる。生成は1回にとどめる。
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    // hourCycle を指定しないと 24:00 表記になる環境があるため明示する。
    hourCycle: "h23",
  });

  // 同じ日時文字列は何度も変換される（1つの予定が、表示中の日数ぶん判定される）。
  // タイムゾーンが同じなら結果は必ず同じなので覚えておく。
  // このキャッシュはユーザー設定のタイムゾーンごとに閉じている（utilsごとに1つ）。
  const partsCache = new Map<string, ZonedParts>();

  const partsOf = (value: string): ZonedParts => {
    const cached = partsCache.get(value);
    if (cached) return cached;

    const parts = zonedParts(new Date(value), formatter);
    partsCache.set(value, parts);
    return parts;
  };

  /** ISO 8601（時刻あり）またはYYYY-MM-DD（日付のみ）を、設定タイムゾーンの日付キーに変換する。 */
  const itemDateKey = (value: string): string => {
    if (!value.includes("T")) return value;
    return partsOf(value).dateKey;
  };

  const minutesFromMidnight = (iso: string): number => {
    const { hour, minute } = partsOf(iso);
    return hour * 60 + minute;
  };

  const formatTime = (iso: string): string => {
    const { hour, minute } = partsOf(iso);
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  };

  // 「今日」は現在時刻に依存する。覚えてしまうと日付が変わっても古いままになるため通さない。
  const todayKey = (): string => zonedParts(new Date(), formatter).dateKey;

  /**
   * その日の中で予定が占める時間帯。日をまたぐ予定は、その日の範囲へ切り詰める。
   *
   * 画面上の位置ではなく分で返す。時間グリッドの高さはピンチで変わるため、
   * 位置を持ち回ると倍率を変えるたびに全ての計算をやり直すことになる。
   */
  const eventRange = (
    event: Pick<CalendarEventItem, "start" | "end">,
    dateKey: string,
  ): { startMinutes: number; endMinutes: number } => {
    const startsToday = itemDateKey(event.start) === dateKey;
    const endsToday = itemDateKey(event.end) === dateKey;

    return {
      startMinutes: startsToday ? minutesFromMidnight(event.start) : 0,
      endMinutes: endsToday ? minutesFromMidnight(event.end) : MINUTES_PER_DAY,
    };
  };

  /** 終日予定・複数日予定が、その日にかかっているか。 */
  const eventCoversDay = (event: CalendarEventItem, dateKey: string): boolean => {
    if (event.allDay) return event.start <= dateKey && dateKey <= event.end;
    return itemDateKey(event.start) <= dateKey && dateKey <= itemDateKey(event.end);
  };

  /** その日に置くタスクの枠。期限と予定日が別の日にあれば、日ごとに片方だけが返る。 */
  const taskOccurrencesOnDay = (tasks: TaskItem[], dateKey: string): TaskOccurrence[] =>
    tasks.flatMap((task) =>
      taskOccurrences(task, undefined, todayKey()).filter(
        (occurrence) => taskOccurrenceCalendarDate(occurrence, itemDateKey, todayKey()) === dateKey,
      ),
    );

  const itemSortTime = ({ item, taskField }: PlacedItem): number => {
    if (isAllDayItem(item, taskField)) return -1;
    if (item.kind === "event" || item.kind === "travel") return minutesFromMidnight(item.start);
    if (item.kind === "task") {
      const { date } = taskDateOf(item, taskField ?? "due");
      return date ? minutesFromMidnight(date) : -1;
    }
    return minutesFromMidnight(item.date);
  };

  /** 日ごとの表示順。終日→時刻順→同時刻はタイトル順に並べる。 */
  const compareItems = (a: PlacedItem, b: PlacedItem): number => {
    const diff = itemSortTime(a) - itemSortTime(b);
    if (diff !== 0) return diff;
    return a.item.title.localeCompare(b.item.title, "ja");
  };

  /**
   * 時間が重なる予定・移動を横に並べる。重なりの集まりごとに列数を決め、
   * 同じ集まりの中で空いている列へ順に割り当てる。
   *
   * 移動も同じ計算に混ぜる。背面に全幅で置くと、時間が重なる予定の裏に隠れて見えなくなる
   * （issue #1172）。ただし移動は紐づく予定の直前・直後に隣接するのが通常形のため、
   * 最小の高さぶんの占有は課さない（短い移動と次の予定が終了＝開始で接していても割らない）。
   */
  const layoutOverlaps = <T extends Pick<CalendarEventItem, "start" | "end"> & { kind: string }>(
    events: T[],
    dateKey: string,
  ): { event: T; column: number; columns: number }[] => {
    const sorted = [...events].sort(
      (a, b) => eventRange(a, dateKey).startMinutes - eventRange(b, dateKey).startMinutes,
    );

    /** 画面上で場所を取り終える時刻。最小の高さぶんは、短い予定でも占有しているものとして扱う。 */
    const occupiedUntil = (event: T): number => {
      const { startMinutes, endMinutes } = eventRange(event, dateKey);
      if (event.kind === "travel") return endMinutes;
      return Math.max(endMinutes, startMinutes + MIN_EVENT_MINUTES);
    };

    const result: { event: T; column: number; columns: number }[] = [];
    let cluster: { event: T; column: number }[] = [];
    let clusterEnd = -1;

    const flush = () => {
      if (cluster.length === 0) return;
      const columns = Math.max(...cluster.map((entry) => entry.column)) + 1;
      result.push(...cluster.map((entry) => ({ ...entry, columns })));
      cluster = [];
      clusterEnd = -1;
    };

    for (const event of sorted) {
      const { startMinutes } = eventRange(event, dateKey);

      // 直前までの集まりと時間が重ならなくなったら、そこで列数を確定させる。
      if (startMinutes >= clusterEnd) flush();

      const usedColumns = new Set(
        cluster
          .filter((entry) => occupiedUntil(entry.event) > startMinutes)
          .map((entry) => entry.column),
      );

      let column = 0;
      while (usedColumns.has(column)) column += 1;

      cluster.push({ event, column });
      clusterEnd = Math.max(clusterEnd, occupiedUntil(event));
    }

    flush();

    return result;
  };

  return {
    itemDateKey,
    minutesFromMidnight,
    formatTime,
    todayKey,
    eventRange,
    eventCoversDay,
    taskOccurrencesOnDay,
    compareItems,
    layoutOverlaps,
  };
}

/**
 * 時刻のないタスクは時間グリッド上の位置が決まらないため、終日エリアへ入れる（docs/spec.md §6）。
 * タスクは期限と予定日で時刻の有無が別々のため、どちらの枠かによって答えが変わる。
 */
export function isAllDayItem(item: CalendarItem, taskField: TaskDateField = "due"): boolean {
  if (item.kind === "event") return item.allDay;
  if (item.kind === "reminder") return !item.hasTime;
  // 移動は必ず出発時刻と到着時刻を持つ。終日の移動という形は作らせない。
  if (item.kind === "travel") return false;
  return !taskDateOf(item, taskField).hasTime;
}

/**
 * 毎年の日付リマインドが登録から何年目かを表すラベル（「(2026年で6年目)」）。
 * 登録した年（sourceDate）を0年目として数える。毎年の項目でない場合は null。
 */
export function reminderAnnualYearLabel(reminder: ReminderItem): string | null {
  if (!reminder.annual) return null;
  const sourceYear = Number(reminder.sourceDate.slice(0, 4));
  const displayYear = Number(reminder.date.slice(0, 4));
  // 登録した年そのものを見ているときは「(1988年で0年目)」になり、日付を繰り返すだけで
  // 読める情報が増えない。専用一覧は展開前の項目を渡すため、必ずこの形になる。
  if (displayYear === sourceYear) return null;
  return `(${displayYear}年で${displayYear - sourceYear}年目)`;
}

/**
 * カレンダーの枠に添える短い年目ラベル（「6年目」）。
 * 何年の分かは置かれている日付そのものが示しているため、枠の中では年を繰り返さない。
 * 枠の幅は項目名を出すだけで足りないことが多く、括弧付きの長い形だと名前が読めなくなる（issue #171）。
 */
export function reminderAnnualYearShortLabel(reminder: ReminderItem): string | null {
  if (!reminder.annual) return null;
  const sourceYear = Number(reminder.sourceDate.slice(0, 4));
  const displayYear = Number(reminder.date.slice(0, 4));
  // 登録した年そのものの回は「0年目」になり、枠の幅を取るだけで読める情報が増えない。
  // 括弧付きの長い版（reminderAnnualYearLabel）と同じ条件で落とし、
  // 枠とツールチップで出方が食い違わないようにする。
  if (displayYear === sourceYear) return null;
  return `${displayYear - sourceYear}年目`;
}

// 桁区切りは環境の既定ロケールに任せず固定する。サーバー（VPSはUTC・enロケール）とブラウザで
// 区切りが変わると、描画結果がずれてハイドレーションが一致しなくなるため。
const ELAPSED_DAYS_FORMAT = new Intl.NumberFormat("ja-JP");

/**
 * 過ぎた日付に添える経過日数のラベル（「13,252日経過」）。今日・これから来る日付では null。
 *
 * 日付リマインドには、誕生日・記念日のように過ぎた日付と、契約更新・有効期限のように
 * これから来る日付が混ざっている。前者は「その日から何日経ったか」が知りたい情報だが、
 * 後者には当てはまらないため、過去の日付のときだけ返す（issue #165）。
 */
export function elapsedDaysLabel(dateKey: string, todayKey: string): string | null {
  if (dateKey >= todayKey) return null;
  return `${ELAPSED_DAYS_FORMAT.format(dateKeyDiffDays(dateKey, todayKey))}日経過`;
}

/** YYYY-MM-DD を「1960年8月24日」の形にする。 */
export function formatDateKeyJa(dateKey: string): string {
  return `${dateKey.slice(0, 4)}年${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`;
}

/**
 * 専用一覧で毎年の項目に添える起点のラベル（「1960年8月24日から66年目」）。
 *
 * issue #288 の「年表示は発生した初回の年にする」を、何年目かの数え方とひとつの文にまとめている。
 * 起点の日付と年数を別々の要素にすると、行が狭いときに前者だけが残って何年目か読めなくなる。
 * 毎年の項目でない場合は null。
 */
export function reminderAnnualOriginLabel(
  reminder: ReminderItem,
  nextDateKey: string,
  itemDateKey: (value: string) => string,
): string | null {
  if (!reminder.annual) return null;
  const sourceKey = itemDateKey(reminder.sourceDate);
  const years = Number(nextDateKey.slice(0, 4)) - Number(sourceKey.slice(0, 4));
  return `${formatDateKeyJa(sourceKey)}から${years}年目`;
}

/**
 * これから来る日付に添えるラベル（「あと5日」「今日」）。過ぎた日付では null。
 *
 * 過ぎた日付側の elapsedDaysLabel() と対になる。どちらも出ない日は無い。
 */
export function daysUntilLabel(dateKey: string, todayKey: string): string | null {
  if (dateKey < todayKey) return null;
  if (dateKey === todayKey) return "今日";
  return `あと${ELAPSED_DAYS_FORMAT.format(dateKeyDiffDays(todayKey, dateKey))}日`;
}
