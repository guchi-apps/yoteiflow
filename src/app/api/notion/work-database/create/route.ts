import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { createWorkDatabase, DEFAULT_TRIP_PLACES } from "@/services/notion/work-database";

type Body = { parentPageId?: string; title?: string };

/**
 * 必要なプロパティを揃えた勤務記録DBをNotionに作成し、そのままDaySpanの勤務記録DBとして設定する。
 * タスクDB・場所DBと同じく、設定画面で明示的に選んだときだけ実行される（docs/spec.md §34）。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const body = (await request.json()) as Body;
  if (!body.parentPageId) {
    return NextResponse.json({ error: "parentPageId is required" }, { status: 400 });
  }

  const title = body.title?.trim() || "YoteiFlow 勤務記録";

  let created;
  try {
    created = await createWorkDatabase(createNotionClient(connection), {
      parentPageId: body.parentPageId,
      title,
    });
  } catch (error) {
    return externalApiError("notion", "勤務記録DBの作成", error);
  }

  await db.notionConnection.update({
    where: { userId },
    data: {
      workDataSourceId: created.dataSourceId,
      workDatabaseId: created.databaseId,
      workTitle: created.title,
      workPropertyMap: created.propertyMap,
      // 初期の選択肢に「出張」が入るため、その場所を選んだら出張になる状態から始める。
      workTripPlaces: DEFAULT_TRIP_PLACES,
      workPlaceShortLabels: {},
      lastValidatedAt: new Date(),
    },
  });

  return NextResponse.json({ workDataSourceId: created.dataSourceId, workTitle: created.title });
}
