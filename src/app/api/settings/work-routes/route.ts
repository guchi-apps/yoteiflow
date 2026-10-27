import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { pickDefaultRoute } from "@/lib/work-sync/route-modes";
import { isTravelMode } from "@/types/calendar";

/** 勤務先・出張先への既定の移動（出発地 → 行き先 × 移動方法ごと・docs/spec.md §46）。 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const routes = await db.workRouteDefault.findMany({
    where: { userId },
    orderBy: [{ destination: "asc" }, { origin: "asc" }],
  });
  return NextResponse.json({ routes });
}

type Body = {
  origin?: string;
  destination?: string;
  mode?: string;
  minutes?: number;
  isDefault?: boolean;
};

/**
 * 1組・1方法を作る・置き換える。往路と復路、車と電車で所要時間が違ってもそれぞれ置ける。
 * `isDefault` を送らないときは既定の指定を変えない（組で最初の1件は自動で既定になる）。
 * 既定は組につき最大1件で、既定にするときは同じ組の他の行をトランザクションで外す。
 * 応答の `routes` は、この組の全方法の行（画面が既定の付け替えを反映するため）。
 */
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
  const mode = body.mode;
  const minutes = body.minutes as number;

  const routes = await db.$transaction(async (tx) => {
    const pair = { userId, origin, destination };
    const existing = await tx.workRouteDefault.findMany({ where: pair });
    const hasDefault = existing.some((row) => row.isDefault);
    // 既定は明示で選ぶか、組で最初の1件（または既定が無い組）のときだけ付く。外すのは別の行を既定にしたとき。
    const makeDefault = body.isDefault === true || (body.isDefault === undefined && !hasDefault);
    if (makeDefault) {
      await tx.workRouteDefault.updateMany({ where: { ...pair, isDefault: true }, data: { isDefault: false } });
    }
    const current = existing.find((row) => row.mode === mode);
    const isDefault = makeDefault || (body.isDefault === undefined && (current?.isDefault ?? false));
    await tx.workRouteDefault.upsert({
      where: { userId_origin_destination_mode: { ...pair, mode } },
      create: { ...pair, mode, minutes, isDefault },
      update: { minutes, isDefault },
    });
    return tx.workRouteDefault.findMany({ where: pair });
  });
  return NextResponse.json({ routes, route: routes.find((row) => row.mode === mode) ?? null });
}

/**
 * 1行を消す。既定の行を消したら、残る行の固定順の先頭を既定へ付け替える（既定が0件にならないように）。
 * 応答の `routes` は、その組の残りの行。
 */
export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const routes = await db.$transaction(async (tx) => {
    const target = await tx.workRouteDefault.findFirst({ where: { id, userId } });
    if (!target) return [];
    await tx.workRouteDefault.deleteMany({ where: { id, userId } });
    const pair = { userId, origin: target.origin, destination: target.destination };
    const rest = await tx.workRouteDefault.findMany({ where: pair });
    if (target.isDefault && rest.length > 0 && !rest.some((row) => row.isDefault)) {
      const next = pickDefaultRoute(rest.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })));
      if (next) await tx.workRouteDefault.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return tx.workRouteDefault.findMany({ where: pair });
  });
  return NextResponse.json({ ok: true, routes });
}
