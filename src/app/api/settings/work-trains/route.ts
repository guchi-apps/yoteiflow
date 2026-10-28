import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { parseTrainInput } from "@/lib/work-sync/train";
import { deleteTrain, loadTrains, saveTrain } from "@/services/work-sync/config";

/** よく使う電車（出発地 → 行き先ごとに複数・docs/spec.md §46・issue #1347）。 */
const MAX_TRAINS = 200;

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ trains: await loadTrains(userId) });
}

/** `id` があれば置き換え、なければ追加する。 */
export async function PUT(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseTrainInput(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid", message: parsed.message }, { status: 400 });
  }
  const id = typeof raw?.id === "string" && raw.id ? raw.id : null;

  if (id) {
    const saved = await saveTrain(userId, id, parsed.train);
    if (!saved) return NextResponse.json({ error: "not_found" }, { status: 404 });
  } else {
    const count = await db.workTrain.count({ where: { userId } });
    if (count >= MAX_TRAINS) {
      return NextResponse.json(
        { error: "limit", message: `電車は${MAX_TRAINS}件まで登録できます。` },
        { status: 400 },
      );
    }
    await saveTrain(userId, null, parsed.train);
  }
  return NextResponse.json({ trains: await loadTrains(userId) });
}

export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await deleteTrain(userId, id);
  return NextResponse.json({ trains: await loadTrains(userId) });
}
