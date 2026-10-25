import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadWorkPlaceLinks } from "@/services/work-sync/config";

/**
 * 勤務場所ごとの正式名称の場所と省略名（issue #1382・docs/spec.md §46）。
 *
 * 勤務の既定（`work-place-defaults`）とは別テーブルで、送られた項目だけを更新する
 * （省略名だけ送って結び付けを消さない・既定の行削除で結び付けが消えない）。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ links: await loadWorkPlaceLinks(userId) });
}

type Body = {
  workPlace?: string;
  placeId?: string | null;
  shortLabel2?: string | null;
  shortLabel1?: string | null;
};

const MAX_SHORT = { shortLabel2: 2, shortLabel1: 1 } as const;

export async function PUT(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const workPlace = body?.workPlace?.trim();
  if (!body || !workPlace) {
    return NextResponse.json({ error: "invalid", message: "勤務場所を指定してください。" }, { status: 400 });
  }

  // 項目ごと送られたものだけ更新する（undefined は触らない・null/空は消す）。
  const data: { placeId?: string | null; shortLabel2?: string | null; shortLabel1?: string | null } = {};
  if (body.placeId !== undefined) data.placeId = body.placeId?.trim() || null;
  for (const key of ["shortLabel2", "shortLabel1"] as const) {
    const raw = body[key];
    if (raw === undefined) continue;
    const value = raw?.trim() || null;
    if (value && [...value].length > MAX_SHORT[key]) {
      return NextResponse.json(
        { error: "invalid", message: `省略名は${MAX_SHORT[key]}文字以内で入力してください。` },
        { status: 400 },
      );
    }
    data[key] = value;
  }

  await db.workPlaceLink.upsert({
    where: { userId_workPlace: { userId, workPlace } },
    create: { userId, workPlace, ...data },
    update: data,
  });
  return NextResponse.json({ links: await loadWorkPlaceLinks(userId) });
}

export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const workPlace = new URL(request.url).searchParams.get("workPlace");
  if (!workPlace) return NextResponse.json({ error: "workPlace is required" }, { status: 400 });
  await db.workPlaceLink.deleteMany({ where: { userId, workPlace } });
  return NextResponse.json({ links: await loadWorkPlaceLinks(userId) });
}
