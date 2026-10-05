import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { isTravelMode } from "@/types/calendar";

/** 勤務先・出張先への既定の移動（出発地 → 行き先ごと・docs/spec.md §46）。 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const routes = await db.workRouteDefault.findMany({
    where: { userId },
    orderBy: [{ destination: "asc" }, { origin: "asc" }],
  });
  return NextResponse.json({ routes });
}

type Body = { origin?: string; destination?: string; mode?: string; minutes?: number };

/** 1組を作る・置き換える。往路と復路は別の組なので、所要時間が違ってもそれぞれ置ける。 */
export async function PUT(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as Body;
  const origin = body.origin?.trim();
  const destination = body.destination?.trim();
  if (!origin || !destination) {
    return NextResponse.json(
      { error: "invalid", message: "出発地と行き先を入力してください。" },
      { status: 400 },
    );
  }
  if (origin === destination) {
    return NextResponse.json(
      { error: "invalid", message: "出発地と行き先が同じです。" },
      { status: 400 },
    );
  }
  if (!isTravelMode(body.mode)) {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }
  if (!Number.isInteger(body.minutes) || (body.minutes as number) < 1 || (body.minutes as number) > 1440) {
    return NextResponse.json(
      { error: "invalid", message: "所要時間は1〜1440分で入力してください。" },
      { status: 400 },
    );
  }

  const route = await db.workRouteDefault.upsert({
    where: { userId_origin_destination: { userId, origin, destination } },
    create: { userId, origin, destination, mode: body.mode, minutes: body.minutes as number },
    update: { mode: body.mode, minutes: body.minutes as number },
  });
  return NextResponse.json({ route });
}

export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await db.workRouteDefault.deleteMany({ where: { id, userId }, });
  return NextResponse.json({ ok: true });
}
