import { createHash, randomBytes } from "node:crypto";

import type { ApnsEnvironment } from "@/lib/apns/send";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-cipher";
import { db } from "@/lib/db";

/**
 * ライブアクティビティ（iOSアプリ・issue #971）のトークンの出し入れと、停止ボタン用トークン。
 */

/** 16進のトークン。長さはAppleが変えうるため幅を持たせる（`isValidApnsToken` と同じ）。 */
export function isValidLiveActivityToken(token: string): boolean {
  return /^[0-9a-fA-F]{32,200}$/.test(token);
}

/** push-to-startトークン。同じ端末で別アカウントへ入り直したときは持ち主を書き換える。 */
export async function saveLiveActivityDevice(
  userId: string,
  input: { token: string; environment: ApnsEnvironment },
): Promise<void> {
  const token = input.token.toLowerCase();
  await db.liveActivityDevice.upsert({
    where: { token },
    create: { userId, token, environment: input.environment },
    update: { userId, environment: input.environment },
  });
}

/** push-to-startトークンの登録を消す（この端末でライブアクティビティを表示しない・issue #1297）。本人の行だけ。 */
export async function deleteLiveActivityDevice(userId: string, token: string): Promise<boolean> {
  const result = await db.liveActivityDevice.deleteMany({
    where: { userId, token: token.toLowerCase() },
  });
  return result.count > 0;
}

/** activity push token。 */
export async function saveLiveActivityToken(
  userId: string,
  input: { token: string; environment: ApnsEnvironment },
): Promise<void> {
  const token = input.token.toLowerCase();
  await db.liveActivityToken.upsert({
    where: { token },
    create: { userId, token, environment: input.environment },
    update: { userId, environment: input.environment },
  });
}

// --- 停止ボタン用トークン（widget-token.ts と同じ作り） ---

const STOP_TOKEN_PREFIX = "dsstp_";
const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * 発行済みのトークンを返し、無ければ発行する。作り直さない（アプリは起動のたびに呼ぶため、
 * 作り直すと他の端末のアプリが持つ値が失効する）。
 */
export async function getOrIssueActivityStopToken(userId: string): Promise<string> {
  const existing = await db.activityStopToken.findUnique({ where: { userId } });
  if (existing) return decryptSecret(existing.token);

  const token = `${STOP_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  try {
    await db.activityStopToken.create({
      data: { userId, tokenHash: hashToken(token), token: encryptSecret(token) },
    });
  } catch (error) {
    // 同時の初回発行で先に作られた（userId の一意制約違反）ときは、その値を返す。
    if ((error as { code?: string } | null)?.code !== "P2002") throw error;
    const created = await db.activityStopToken.findUnique({ where: { userId } });
    if (!created) throw error;
    return decryptSecret(created.token);
  }
  return token;
}

export async function resolveUserIdByActivityStopToken(token: string): Promise<string | null> {
  if (!token.startsWith(STOP_TOKEN_PREFIX)) return null;

  const row = await db.activityStopToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true },
  });
  if (!row) return null;

  await db.activityStopToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => null);

  return row.userId;
}
