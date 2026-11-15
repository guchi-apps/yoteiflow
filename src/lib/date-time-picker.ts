// 日時ピッカー（`DateTimePickerField`）の純粋なロジック。
// 値は設定タイムゾーンの壁時計の文字列で、`YYYY-MM-DD`（時刻なし）か `YYYY-MM-DDTHH:mm`。
// 時と分は「両方指定か両方なし」にするため、時刻は `HH:mm` の1つの文字列か null で持つ。

export interface PickerCell {
  /** `YYYY-MM-DD` */
  key: string;
  day: number;
  /** 表示中の月に属するか（前後の月のはみ出しは false） */
  inMonth: boolean;
}

export interface PickerValue {
  /** `YYYY-MM-DD`。未入力は空文字。 */
  date: string;
  /** `HH:mm`。時刻なしは null。 */
  time: string | null;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** 日曜始まりの6週（42マス）。`month` は 1〜12。 */
export function monthGrid(year: number, month: number): PickerCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = Date.UTC(year, month - 1, 1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const cell = new Date(start + index * 86_400_000);
    return {
      key: dateKey(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate()),
      day: cell.getUTCDate(),
      inMonth: cell.getUTCMonth() === month - 1 && cell.getUTCFullYear() === year,
    };
  });
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** `YYYY-MM-DD(THH:mm)` を日付と時刻へ分ける。時刻が読めなければ時刻なしとして扱う。 */
export function parsePickerValue(value: string): PickerValue {
  const date = /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
  const time = value.length >= 16 && TIME_PATTERN.test(value.slice(11, 16)) ? value.slice(11, 16) : null;
  return { date, time };
}

/**
 * 日付と時刻から値を組み立てる。
 * 時刻なしを許さない欄（予定・移動・活動記録）では、時刻が無ければ既定時刻を補い、
 * 常に `YYYY-MM-DDTHH:mm` を返す（日付だけの値が時刻必須の保存へ流れないようにする）。
 */
export function joinPickerValue(
  value: PickerValue,
  options: { allowNoTime: boolean; defaultTime: string },
): string {
  if (!value.date) return "";
  if (value.time) return `${value.date}T${value.time}`;
  return options.allowNoTime ? value.date : `${value.date}T${options.defaultTime}`;
}

export function splitTime(time: string): { hour: number; minute: number } {
  const match = TIME_PATTERN.exec(time);
  if (!match) return { hour: 0, minute: 0 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function joinTime(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** 0〜n-1 を循環させる（-1 → n-1、n → 0）。 */
export function wrapIndex(index: number, size: number): number {
  return ((index % size) + size) % size;
}

/** 押せる欄に出す文字列。時刻なしは `ー:ー`。 */
export function formatPickerLabel(value: PickerValue): string {
  if (!value.date) return "未選択";
  const [year, month, day] = value.date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}年${month}月${day}日（${weekday}） ${value.time ?? NO_TIME_LABEL}`;
}

export const NO_TIME_LABEL = "ー:ー";
