import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { loadWritableCalendars } from "@/services/calendar/load";
import { getNotionConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { loadPlaceCatalog } from "@/services/notion/places";
import { loadTagCatalog } from "@/services/notion/tag-options";
import { listAllTasks } from "@/services/notion/tasks";
import { attachBringInfo, listBringItems } from "@/services/task-links/bring-items";
import { attachTaskLinks, listTaskLinks } from "@/services/task-links/links";

/**
 * タスク画面（/tasks）の一覧と、入力ダイアログが使う候補（docs/spec.md §11）。
 *
 * `/api/tasks` は予定へ紐づけるタスクを選ぶための一覧（未完了のみ）で、完了も含めて全件を
 * 要る画面とは中身が違う。混ぜると返す内容を変えるたびに両方の呼び出し元を考えることになる。
 * 画面はこれを背景取得し、Service Worker が通信の遅いときに保存済みを返す（issue #724）。
 * タグ・場所の取得は失敗しても空になるだけで、タスクの表示は妨げない。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionConnection(userId);
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  try {
    const [tasks, tagCatalog, placeCatalog, calendars, links, bringItems] = await Promise.all([
      listAllTasks(createNotionClient(connection), connection),
      loadTagCatalog(connection),
      loadPlaceCatalog(connection),
      loadWritableCalendars(userId),
      listTaskLinks(userId),
      listBringItems(userId),
    ]);
    return NextResponse.json({
      tasks: attachBringInfo(attachTaskLinks(tasks, links), bringItems),
      tagCatalog,
      placeCatalog,
      calendars,
    });
  } catch (error) {
    return externalApiError("notion", "タスクの取得", error);
  }
}
