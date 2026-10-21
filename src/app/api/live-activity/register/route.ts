import { NextResponse } from "next/server";

import { isApnsConfigured } from "@/lib/apns/config";
import { isApnsEnvironment } from "@/lib/apns/send";
import { requireUserId } from "@/lib/auth-user";
import {
  deleteLiveActivityDevice,
  isValidLiveActivityToken,
  saveLiveActivityDevice,
} from "@/services/live-activity/devices";

type Body = { token?: string; environment?: string };

/**
 * ライブアクティビティを「始める」ためのトークン（push-to-start）の登録（issue #971）。
 * ログイン済みのWebViewから、アプリが受け取ったトークンを渡して呼ぶ。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isApnsConfigured()) {
    return NextResponse.json({ error: "apns_not_configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const token = body?.token?.trim();
  if (!token || !isValidLiveActivityToken(token)) {
    return NextResponse.json({ error: "invalid token" }, { status: 400 });
  }
  if (!isApnsEnvironment(body?.environment)) {
    return NextResponse.json({ error: "invalid environment" }, { status: 400 });
  }

  await saveLiveActivityDevice(userId, { token, environment: body.environment });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * push-to-startトークンの登録を消す（issue #1297）。設定でこの端末のライブアクティビティの表示を
 * オフにしたときに呼ぶ。消しておかないと、記録を始めるたびにサーバーがこの端末へ表示を始める。
 */
export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const token = body?.token?.trim();
  if (!token || !isValidLiveActivityToken(token)) {
    return NextResponse.json({ error: "invalid token" }, { status: 400 });
  }

  const deleted = await deleteLiveActivityDevice(userId, token);
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
