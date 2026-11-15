import { isUserIdAllowed } from "@/lib/access/user-access";
import { dateKeyDiffDays } from "@/lib/calendar-range";
import { db } from "@/lib/db";
import { forgetSharedToken, getSharedToken } from "@/lib/shared-token";
import {
  applyMailIdempotencyKey,
  buildApplyMail,
  dueApplyNotices,
  offDatesFromRecords,
  WORK_APPLY_MAIL_HOUR,
  zonedDateAndHour,
} from "@/lib/work-apply-notice";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { listPendingWorkRecords, listWorkRecordsInRange } from "@/services/notion/work-logs";
import { workTodos } from "@/types/work";

/**
 * 出張・年休の事前申請が未完了のときに、会社宛てメールで知らせる（issue #1552・docs/spec.md §34）。
 *
 * 送信はAIDEの `POST /api/text-mail/send`（宛先はAIDE側で固定・`idempotencyKey` で二重送信を防ぐ）。
 * 通知のタイマー（`runTick`）とは別に毎分回し、通知日の16時台に1人1回だけNotionを読む
 * （毎分取りにいかない・docs/spec.md §20）。サーバー停止中に16時台を過ぎた場合は送らない。
 */

const TOKEN_NAME = "AIDE_TEXT_MAIL_TOKEN";
const REQUEST_TIMEOUT_MS = 30_000;
/** 先の何日までの出張・年休を対象に探すか。連休を挟んでも前営業日はこの範囲に収まる。 */
const LOOKAHEAD_DAYS = 14;
/** 失敗したときに同じ日のうちに再試行するまでの間隔。 */
const RETRY_AFTER_MS = 10 * 60_000;

type Attempt = { done: boolean; at: number };
const attempts = new Map<string, Attempt>();

/** AIDEの本番オリジン。`AIDE_TEXT_MAIL_URL` は別の宛先へ向けるときだけ使う（配布はしない。`ACCESS_API_URL` と同じ扱い）。 */
const DEFAULT_AIDE_URL = "https://aide.gucchii.com";

function aideBaseUrl(): string {
  return (process.env.AIDE_TEXT_MAIL_URL ?? "").trim().replace(/\/$/, "") || DEFAULT_AIDE_URL;
}

/**
 * 送る環境か。開発サーバーや worktree から本番のAIDEへ誤って送らないよう、本番ビルドか、
 * 宛先を明示した環境（`AIDE_TEXT_MAIL_URL`）だけで動かす。
 */
export function isWorkApplyMailConfigured(): boolean {
  return process.env.NODE_ENV === "production" || (process.env.AIDE_TEXT_MAIL_URL ?? "").trim() !== "";
}

type SendOutcome = { ok: true } | { ok: false; retry: boolean; reason: string };

async function postToAide(
  mail: { idempotencyKey: string; subject: string; bodyText: string; bodyHtml: string },
  fetchImpl: typeof fetch,
  retriedAuth = false,
): Promise<SendOutcome> {
  const baseUrl = aideBaseUrl();
  const token = await getSharedToken(TOKEN_NAME, TOKEN_NAME);
  // 未設定・取得失敗は復旧しうるため、同じ16時台のうちは再試行する（完了扱いにすると同日に直しても送られない・#1560）。
  if (!token) return { ok: false, retry: true, reason: "AIDE_TEXT_MAIL_TOKEN を取得できません" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl}/api/text-mail/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(mail),
      signal: controller.signal,
    });
    if (response.ok) return { ok: true };
    if (response.status === 401 && !retriedAuth) {
      // 共有トークンが再発行されたときに追随する。
      forgetSharedToken(TOKEN_NAME);
      return postToAide(mail, fetchImpl, true);
    }
    // 409は前回の送信結果が未確定。自動で再送すると二重送信になりうるため、再試行しない。
    return { ok: false, retry: response.status >= 500, reason: `HTTP ${response.status}` };
  } catch {
    // 通信不達・タイムアウトは届いたか分からないが、冪等キーで二重送信は防がれるため再試行してよい。
    return { ok: false, retry: true, reason: "通信に失敗しました" };
  } finally {
    clearTimeout(timeout);
  }
}

/** 1人ぶん。送った（または送る必要が無いと確定した）ら true。 */
async function runForUser(userId: string, now: Date, fetchImpl: typeof fetch): Promise<boolean> {
  const setting = await db.uiSetting.findUnique({ where: { userId }, select: { timeZone: true } });
  const timeZone = setting?.timeZone ?? "Asia/Tokyo";
  const { dateKey: todayKey, hour } = zonedDateAndHour(now, timeZone);
  if (hour !== WORK_APPLY_MAIL_HOUR) return false;

  const key = `${userId}:${todayKey}`;
  const previous = attempts.get(key);
  if (previous && (previous.done || now.getTime() - previous.at < RETRY_AFTER_MS)) return previous.done;
  attempts.set(key, { done: false, at: now.getTime() });

  const connection = await getNotionWorkConnection(userId);
  if (!connection) return finish(key, now, true);
  const notion = createNotionClient(connection);

  const pending = await listPendingWorkRecords(notion, connection);
  const candidates = pending.filter(
    (record) =>
      record.startDate > todayKey &&
      dateKeyDiffDays(todayKey, record.startDate) <= LOOKAHEAD_DAYS &&
      workTodos(record, todayKey).includes("preApplied"),
  );
  if (candidates.length === 0) return finish(key, now, true);

  // 通知日の判定に、申請済みの年休・会社休業日が要る。未申請の記録だけでは取れない。
  const to = candidates.reduce((max, record) => (record.startDate > max ? record.startDate : max), todayKey);
  const range = await listWorkRecordsInRange(notion, connection, { from: todayKey, to });
  const due = dueApplyNotices(candidates, offDatesFromRecords(range), todayKey);
  if (due.length === 0) return finish(key, now, true);

  const mail = buildApplyMail(due);
  const outcome = await postToAide(
    { idempotencyKey: applyMailIdempotencyKey(todayKey, due), ...mail },
    fetchImpl,
  );
  if (outcome.ok) return finish(key, now, true);

  console.error(`[dayspan] work apply mail failed (userId=${userId}): ${outcome.reason}`);
  return finish(key, now, !outcome.retry);
}

function finish(key: string, now: Date, done: boolean): boolean {
  attempts.set(key, { done, at: now.getTime() });
  return done;
}

/** 設定を入れた利用者それぞれについて、16時台なら未完了の事前申請を知らせる。 */
export async function runWorkApplyMail(now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!isWorkApplyMailConfigured()) return;

  const rows = await db.notificationSetting.findMany({
    where: { workApplyMailEnabled: true },
    select: { userId: true },
  });

  for (const { userId } of rows) {
    try {
      // 許可を取り消された利用者には送らない（issue #1179）。
      if (!(await isUserIdAllowed(userId))) continue;
      await runForUser(userId, now, fetchImpl);
    } catch (error) {
      console.error(`[dayspan] work apply mail failed (userId=${userId}):`, error);
    }
  }

  // 日付が変わったぶんの記録を捨てて、Mapを増やし続けない。
  const cutoff = now.getTime() - 48 * 60 * 60_000;
  for (const [key, attempt] of attempts) if (attempt.at < cutoff) attempts.delete(key);
}

