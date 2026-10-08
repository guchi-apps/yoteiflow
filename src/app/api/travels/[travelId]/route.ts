import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import {
  deleteTravel,
  updateTravel,
  validateTravelInput,
  type TravelWriteInput,
} from "@/services/travel/plans";

/** 移動を書き換える。Google側へ書き出してある予定も同じ内容へ揃える（docs/spec.md §29）。 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ travelId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { travelId } = await params;
  const body = (await request.json()) as Partial<TravelWriteInput>;

  const invalid = validateTravelInput(body);
  if (invalid) {
    return NextResponse.json({ error: "invalid_request", message: invalid }, { status: 400 });
  }

  try {
    const result = await updateTravel(userId, travelId, {
      origin: body.origin!,
      destination: body.destination!,
      via: body.via ?? null,
      mode: body.mode!,
      departAt: body.departAt!,
      arriveAt: body.arriveAt!,
      note: body.note ?? null,
      estimated: body.estimated ?? false,
      estimateSource: body.estimateSource,
    });

    // 他人の移動を指されても解決できないよう、取得は必ずuserIdで絞っている。
    if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dayspan] travel update failed:", message);
    return NextResponse.json({ error: "travel_update_failed", message }, { status: 400 });
  }
}

/** 移動を消す。Googleへ書き出してあった予定も消す。 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ travelId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { travelId } = await params;

  try {
    const deleted = await deleteTravel(userId, travelId);
    if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Googleの削除に失敗したときはDaySpan側の行も残している。もう一度押せばやり直せる。
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dayspan] travel delete failed:", message);
    return NextResponse.json({ error: "travel_delete_failed", message }, { status: 502 });
  }
}
