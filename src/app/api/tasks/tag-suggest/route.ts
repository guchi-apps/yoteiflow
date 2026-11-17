import { NextResponse } from "next/server";

import { MAX_TAGS, suggestTaskTag } from "@/lib/ai-task-tag";
import { requireUserId } from "@/lib/auth-user";
import { hasTypeSafeApiKey } from "@/lib/typesafe-system-one";

/**
 * タスクのタイトルから既存のタグをJevに選ばせる（issue #1666）。
 *
 * タグの一覧は画面が持っているものを受け取り、Notionは読まない。
 * 答えは送られた一覧に含まれるものだけを返す（合うものが無ければ null）。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!(await hasTypeSafeApiKey())) {
    return NextResponse.json(
      { error: "not_configured", message: "タグの自動判定が設定されていません（TYPESAFE_API_KEY が未設定です）。" },
      { status: 503 },
    );
  }

  let body: { title?: unknown; tags?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const tags = body.tags;
  if (
    !Array.isArray(tags) ||
    tags.length === 0 ||
    tags.length > MAX_TAGS ||
    !tags.every((item) => typeof item === "string" && item.trim() !== "")
  ) {
    return NextResponse.json({ error: "tags is invalid" }, { status: 400 });
  }

  const result = await suggestTaskTag({ title, tags: tags as string[] });
  if (!result) {
    return NextResponse.json({ error: "ai_request_failed", message: "タグを判定できませんでした。" }, { status: 502 });
  }
  return NextResponse.json({ tag: result.tag });
}
