/**
 * 予定ごとの通知設定（issue #708）に使う純粋なロジック。
 *
 * アカウント単位の設定（NotificationSetting）と、予定ごとの上書き（EventNotificationSetting）を
 * 合成して「実際に何分前に知らせるか」を決める。DB・外部APIを見ないため node:test でそのまま
 * 検証できる（services/notifications/plan.ts から呼ぶ）。
 */

import type { EventNotificationOverride } from "@/types/calendar";
import { MAX_EVENT_LEAD_MINUTES } from "@/types/notification";

/**
 * 予定ごとの通知の上書きで「何分前」として有効な値か（0以上・上限以下の整数）。
 * UIの入力チェックと、下記の正規化の両方で使う。
 */
export function isValidLeadMinutes(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_EVENT_LEAD_MINUTES;
}

/**
 * 有効な値だけを残し、重複を除いて昇順に並べる。
 *
 * 範囲外の値（負・非整数・MAX_EVENT_LEAD_MINUTES超え）が紛れ込むのは、DaySpanのAPIや
 * 将来のMCPから画面を経由せず直接呼ばれた場合。UIで絞っているだけの値をそのまま保存しない。
 */
export function normalizeLeadMinutes(input: number[]): number[] {
  const unique = new Set(input.filter(isValidLeadMinutes));
  return [...unique].sort((a, b) => a - b);
}

/**
 * 予定ごとの設定（issue #746でオプトイン式へ変更）から、実際に使う「何分前」の配列を返す。
 *
 * 予定は既定では通知しない。通知を入れた予定（enabled な上書きがある予定）だけが対象で、
 * 上書きが無い・enabled が false の予定は常に空配列。アカウント全体の予定通知
 * （accountEnabled）は親スイッチとして残し、オフの間は入れた予定も通知しない。
 */
export function resolveEventLeadMinutes(
  override: EventNotificationOverride | null,
  accountEnabled: boolean,
): number[] {
  if (!accountEnabled || !override?.enabled) return [];
  return override.leadMinutes;
}

/** 「1時間30分」のような、時間と分を組み合わせた表記。0分未満は呼ばない前提。 */
function formatLeadDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}時間` : `${hours}時間${remainder}分`;
}

/**
 * 「10分前」「1時間30分前」「ちょうど」のような、設定値として使う表示用ラベル
 * （チップ・編集画面・詳細画面で使う）。
 */
export function eventLeadLabel(minutes: number): string {
  if (minutes === 0) return "ちょうど";
  return `${formatLeadDuration(minutes)}前`;
}

/**
 * 「10分後」「1時間30分後」のような、通知タイトル専用の言い方（services/notifications/plan.ts）。
 *
 * eventLeadLabel の「◯◯前」は設定値としての言い方で、通知タイトルにそのまま使うと
 * 「◯◯前に届いた」と読める（届いた時刻からの経過だと誤解される）。これから始まることが
 * 分かる「◯◯後」を使う。0分（ちょうど）では呼ばれない前提（呼び出し側が予定名そのままにする）。
 */
export function eventLeadAnnouncement(minutes: number): string {
  return `${formatLeadDuration(minutes)}後`;
}

/**
 * 予定編集画面の「通知」ボタンに出す短い要約。
 *
 * EventDetailDialog（表示画面）と同じ「10分前・30分前」のように値をすべて連結すると、
 * 予定ごとの上書きが任意の値を受け付ける以上、狭い画面でボタン（shrink-0・whitespace-nowrap
 * で折り返さない）がダイアログの外へはみ出しうる。選んだ値のうち最初（最小）の1件だけを
 * 出し、2件目以降は件数でまとめる。
 */
export function eventNotificationSummary(override: EventNotificationOverride | null): string {
  if (!override?.enabled || override.leadMinutes.length === 0) return "通知";
  const [first, ...rest] = override.leadMinutes;
  const label = `通知：${eventLeadLabel(first)}`;
  return rest.length > 0 ? `${label} ほか${rest.length}件` : label;
}

/**
 * 実質的に同じ設定かどうか（issue #834）。
 *
 * 編集画面で選び直した値を保存前の値と比べ、変わっていなければAPIを呼ばずに済ませるために使う。
 * 両方とも無効なら、leadMinutesの中身が違っていても「変わっていない」とみなす
 * （無効なときの数値はどうせ使われないため）。
 */
export function sameNotificationOverride(
  a: EventNotificationOverride | null,
  b: EventNotificationOverride | null,
): boolean {
  const aEnabled = a?.enabled === true;
  const bEnabled = b?.enabled === true;
  if (aEnabled !== bEnabled) return false;
  if (!aEnabled) return true;

  const aMinutes = normalizeLeadMinutes(a!.leadMinutes);
  const bMinutes = normalizeLeadMinutes(b!.leadMinutes);
  return (
    aMinutes.length === bMinutes.length && aMinutes.every((value, index) => value === bMinutes[index])
  );
}

/** 通知を追加するときの既定の分数。使用済みなら、この並びで最初の未使用を取る。 */
const ADD_LEAD_CANDIDATES = [10, 5, 15, 30, 60, 0, 120, 180];

/**
 * 「通知を追加」で入れる分数（issue #1569）。10分前から始め、すでに入っている値と
 * 重ならないものを選ぶ（重複は保存時に1件へ潰れるため、押しても増えないのを避ける）。
 */
export function nextLeadMinutesToAdd(existing: number[]): number {
  const used = new Set(existing);
  for (const candidate of ADD_LEAD_CANDIDATES) {
    if (!used.has(candidate)) return candidate;
  }
  for (let minutes = 1; minutes <= MAX_EVENT_LEAD_MINUTES; minutes += 1) {
    if (!used.has(minutes)) return minutes;
  }
  return 0;
}

/**
 * 分数を時刻ホイール（時0〜23・分0〜59）の値 `HH:mm` へ直す。ホイールに24時間は無いため、
 * 上限の24時間ちょうどは23:59に丸める。
 */
export function leadMinutesToWheelTime(minutes: number): string {
  const clamped = Math.min(Math.max(0, Math.trunc(minutes)), 23 * 60 + 59);
  const hours = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** ホイールの値 `HH:mm` を分数へ戻す。読めない値は0分。 */
export function wheelTimeToLeadMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}
