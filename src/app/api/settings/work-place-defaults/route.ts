import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadPlaceDefaultRows } from "@/services/work-sync/config";

/** 勤務先・出張先ごとの既定（反映の有無・勤務時刻。issue #1099・docs/spec.md §46）。 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ defaults: await loadPlaceDefaultRows(userId) });
}

type Body = {
  key?: string;
  isTrip?: boolean;
  workEnabled?: boolean;
  startMinutes?: number | null;
  endMinutes?: number | null;
  outboundEnabled?: boolean;
  returnEnabled?: boolean;
};

const isMinutes = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1439;

/**
 * 1件を作る・置き換える。ここを変えても、保存済みの勤務記録・予定は動かさない
 * （記録ごとの指定と、すでに作った予定には触れず、次に同期されるときから使われる）。
 */
export async function PUT(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as Body;
  const key = body.key?.trim();
  if (!key) {
    return NextResponse.json(
      { error: "invalid", message: "勤務先・出張先を入力してください。" },
      { status: 400 },
    );
  }
  const startMinutes = body.startMinutes ?? null;
  const endMinutes = body.endMinutes ?? null;
  if ((startMinutes !== null && !isMinutes(startMinutes)) || (endMinutes !== null && !isMinutes(endMinutes))) {
    return NextResponse.json({ error: "invalid", message: "時刻が正しくありません。" }, { status: 400 });
  }
  // 片方だけだと共通設定との組み合わせで終了が開始より前になりうるため、両方そろえるか両方空にする。
  if ((startMinutes === null) !== (endMinutes === null)) {
    return NextResponse.json(
      { error: "invalid", message: "勤務開始と終了は、両方入れるか両方空にしてください。" },
      { status: 400 },
    );
  }
  if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
    return NextResponse.json(
      { error: "invalid", message: "勤務終了は開始より後にしてください。" },
      { status: 400 },
    );
  }

  const isTrip = Boolean(body.isTrip);
  const data = {
    workEnabled: body.workEnabled ?? true,
    startMinutes,
    endMinutes,
    outboundEnabled: body.outboundEnabled ?? true,
    returnEnabled: body.returnEnabled ?? true,
  };
  await db.workPlaceDefault.upsert({
    where: { userId_key_isTrip: { userId, key, isTrip } },
    create: { userId, key, isTrip, ...data },
    update: data,
  });
  return NextResponse.json({ defaults: await loadPlaceDefaultRows(userId) });
}

export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const key = params.get("key");
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  await db.workPlaceDefault.deleteMany({
    where: { userId, key, isTrip: params.get("isTrip") === "1" },
  });
  return NextResponse.json({ defaults: await loadPlaceDefaultRows(userId) });
}
