import { createHash } from "node:crypto";

import { isAutoOffDay } from "@/lib/work-days";
import { isPartialLeave, workTodos, type WorkRecordItem } from "@/types/work";

/**
 * 事前申請が未完了の出張・年休を、会社宛てメールで知らせる（issue #1552・docs/spec.md §34）。
 *
 * 通知日は「開始日の前日」を基本とし、土日祝・会社休業日・全休の年休の日を挟むときは
 * その手前の出勤日へ遡る。送るのは通知日の16時台（設定タイムゾーン）。
 * 外部I/Oを持たない純粋関数だけを置き、`node --test` で確かめる。
 */

/** 送る時刻（時）。設定タイムゾーンでの16時台。 */
export const WORK_APPLY_MAIL_HOUR = 16;

/** 通知日を探すとき遡る上限（日）。連休が長くても打ち切る。 */
const MAX_LOOKBACK_DAYS = 31;

function shiftKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 記録のうち「その日は働かない」と分かる日（会社休業日・全休の年休）を日付キーの集合にする。 */
export function offDatesFromRecords(records: WorkRecordItem[]): Set<string> {
  const off = new Set<string>();
  for (const record of records) {
    const isOff = record.companyHoliday || (record.annualLeave !== null && !isPartialLeave(record.annualLeave));
    if (!isOff) continue;
    for (let key = record.startDate, i = 0; key <= record.endDate && i < 400; key = shiftKey(key, 1), i++) {
      off.add(key);
    }
  }
  return off;
}

/** 開始日の前日から遡って、最初の出勤日を返す。見つからなければ前日をそのまま返す。 */
export function noticeDateFor(startDate: string, offDates: ReadonlySet<string>): string {
  for (let i = 1; i <= MAX_LOOKBACK_DAYS; i++) {
    const key = shiftKey(startDate, -i);
    if (!isAutoOffDay(key) && !offDates.has(key)) return key;
  }
  return shiftKey(startDate, -1);
}

/** 設定タイムゾーンでの日付キーと時。 */
export function zonedDateAndHour(now: Date, timeZone: string): { dateKey: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/** 今日が通知日で、事前申請が未済の出張・年休（開始日が今日より先のもの）。 */
export function dueApplyNotices(
  pending: WorkRecordItem[],
  offDates: ReadonlySet<string>,
  todayKey: string,
): WorkRecordItem[] {
  return pending
    .filter((record) => record.startDate > todayKey)
    .filter((record) => workTodos(record, todayKey).includes("preApplied"))
    .filter((record) => noticeDateFor(record.startDate, offDates) === todayKey)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kindLabel(record: WorkRecordItem): string {
  return record.annualLeave ? `年休（${record.annualLeave}）` : "出張";
}

function periodLabel(record: WorkRecordItem): string {
  return record.startDate === record.endDate ? record.startDate : `${record.startDate}〜${record.endDate}`;
}

export type ApplyMail = { subject: string; bodyText: string; bodyHtml: string };

/** メールの件名（改行なし）・テキスト・HTML。 */
export function buildApplyMail(records: WorkRecordItem[]): ApplyMail {
  const lines = records.map((record) => {
    const name = record.businessTrip && record.title ? `　${record.title}` : "";
    return `${kindLabel(record)}　${periodLabel(record)}${name}`;
  });
  const subject = `[YoteiFlow] 事前申請が完了していません（${records.length}件）`;
  const bodyText = ["次の出張・年休の事前申請が完了していません。", "", ...lines.map((line) => `・${line}`)].join("\n");
  const bodyHtml = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;font-size:14px;line-height:1.8;color:#182529;"><p>次の出張・年休の事前申請が完了していません。</p><ul>${lines
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("")}</ul></div>`;
  return { subject, bodyText, bodyHtml };
}

/** AIDEの冪等キー（200字以内）。同じ通知日・同じ記録の組み合わせなら同じ値になる。 */
export function applyMailIdempotencyKey(noticeDate: string, records: WorkRecordItem[]): string {
  const ids = records.map((record) => record.id).sort().join(",");
  const digest = createHash("sha256").update(ids).digest("hex").slice(0, 24);
  return `yoteiflow-preapply:${noticeDate}:${digest}`;
}
