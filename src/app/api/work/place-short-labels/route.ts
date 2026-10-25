import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { isSingleCharacter } from "@/lib/work-short-label";

type Body = { labels?: unknown };

/**
 * 狭い月表示の勤務バッジに出す、勤務場所ごとの1文字を決める（issue #1381・docs/spec.md §34）。
 *
 * 保存するのは勤務場所の名前と1文字の対応だけで、Notion側へは何も書かない。
 * 送られてきた対応でまるごと置き換える（出張扱いの `trip-places` と同じ。1件ずつの更新にすると
 * 複数を続けて変えたときに順番次第で結果が変わる）。空文字は「未設定（先頭1文字）」の意味で落とす。
 */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection?.workDataSourceId) {
    return NextResponse.json({ error: "work_database_not_selected" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const labels = body?.labels;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    return NextResponse.json({ error: "labels must be an object" }, { status: 400 });
  }

  const normalized: Record<string, string> = {};
  for (const [place, label] of Object.entries(labels)) {
    if (typeof label !== "string") {
      return NextResponse.json({ error: "labels must be strings" }, { status: 400 });
    }
    const trimmed = label.trim();
    if (!trimmed) continue;
    if (!isSingleCharacter(trimmed)) {
      return NextResponse.json(
        { error: "invalid_label", message: "1文字だけ入力してください。" },
        { status: 400 },
      );
    }
    normalized[place] = trimmed;
  }

  await db.notionConnection.update({
    where: { userId },
    data: { workPlaceShortLabels: normalized },
  });

  return NextResponse.json({ labels: normalized });
}
