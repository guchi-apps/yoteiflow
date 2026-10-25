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
};

export async function PUT(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const workPlace = body?.workPlace?.trim();
  if (!body || !workPlace) {
    return NextResponse.json({ error: "invalid", message: "勤務場所を指定してください。" }, { status: 400 });
  }

  // 項目ごと送られたものだけ更新する（undefined は触らない・null/空は消す）。
  // 省略名（shortLabel2/1）の更新は受けない（issue #1426。月表示の1文字へ一本化。列は残す）。
  const data: { placeId?: string | null } = {};
  if (body.placeId !== undefined) data.placeId = body.placeId?.trim() || null;

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
