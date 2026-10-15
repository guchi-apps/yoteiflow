import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";

import { requireUserId } from "@/lib/auth-user";
import { getNotionConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { createTask, listAllTasks, type TaskWriteInput } from "@/services/notion/tasks";
import { operationStore, requestHash, taskGateway } from "@/services/internal/tasks";
import { InternalTaskConflictError } from "@/services/internal/task-contract";
import { runCreateOperation } from "@/services/internal/task-operations";
import { attachTaskLinks, listTaskLinks } from "@/services/task-links/links";

/**
 * 予定へ紐づけるタスクを選ぶための一覧（docs/spec.md §31）。
 *
 * カレンダーが持っているタスクでは足りない。期限も予定日も無いタスクはカレンダーに
 * 出ておらず（docs/spec.md §10）、それこそが「いつやるか決まっていない」＝紐づけたい
 * タスクだからである。完了したタスクは紐づける先が無いため落とす。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  try {
    const tasks = await listAllTasks(createNotionClient(connection), connection);
    // すでに別の予定へ紐づいているタスクを画面で示せるようにする。紐づけはDaySpanのDBに
    // あるため、外部APIの往復は増えない。
    const links = await listTaskLinks(userId);
    return NextResponse.json({
      tasks: attachTaskLinks(tasks, links).filter((task) => !task.done),
    });
  } catch (error) {
    return externalApiError("notion", "タスクの取得", error);
  }
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  const { clientId, ...rest } = (await request.json()) as TaskWriteInput & { clientId?: string };
  const body: TaskWriteInput = rest;
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const input = { ...body, title: body.title.trim() };

  try {
    const notion = createNotionClient(connection);

    // オフライン中にためた作成の再送（issue #1242）。端末が決めた `clientId` を冪等キーにして、
    // 応答が届かなかった再送で同じタスクを二重に作らない。内部APIと同じ確保→作成→ID記録の流れを使う。
    if (clientId) {
      if (!/^[\x21-\x7e]{1,150}$/.test(clientId)) {
        return NextResponse.json({ error: "invalid_client_id" }, { status: 400 });
      }
      const outcome = await runCreateOperation(
        { store: operationStore, gateway: taskGateway(notion, connection), now: () => new Date() },
        { userId, idempotencyKey: `client-create ${clientId}`, requestHash: requestHash(input) },
        input,
      );
      switch (outcome.kind) {
        case "succeeded":
          return NextResponse.json({ id: outcome.result.task.id });
        case "in_progress":
          return NextResponse.json({ error: "operation_in_progress" }, { status: 409 });
        case "reconciliation_required":
          // 作成されたか分からない。自動で作り直さず、端末側で利用者に確認させる。
          return NextResponse.json(
            { error: "result_unknown", reconciliationRequired: true, message: "タスクが作成済みか確認できませんでした。" },
            { status: 502 },
          );
        case "unknown":
          return NextResponse.json({ error: "result_unknown", message: "タスクの作成結果を確認できませんでした。" }, { status: 502 });
        case "not_executed":
          return externalApiError("notion", "タスクの作成", outcome.error);
      }
    }

    const created = await createTask(notion, connection, input);
    return NextResponse.json({ id: created.id });
  } catch (error) {
    if (error instanceof InternalTaskConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return externalApiError("notion", "タスクの作成", error);
  }
}
