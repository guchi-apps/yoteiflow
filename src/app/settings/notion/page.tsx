import { redirect } from "next/navigation";

import { NotionSection, type NotionSectionState } from "@/components/settings/notion-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { externalApiMessage } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import {
  listCandidateDataSources,
  listSharedPages,
  type DataSourceSummary,
  type PropertyMap,
  type SharedPageSummary,
} from "@/services/notion/task-database";
import { refreshTaskPropertyMapIfStale } from "@/services/notion/tasks";
import type { PlacePropertyMap } from "@/services/notion/place-database";
import type { ReminderPropertyMap } from "@/services/notion/reminder-database";
import type { ShoppingPropertyMap } from "@/services/notion/shopping-database";
import type { WorkPropertyMap } from "@/services/notion/work-database";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

export default async function NotionSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const state = await loadNotionState(user.id);

  return (
    <SettingsShell
      title="Notion"
      description="タスクの一次情報源です。Notion側で用意したタスクDBをYoteiFlowから選択します。"
      backHref="/settings"
      backLabel="設定"
    >
      <NotionSection state={state} />
    </SettingsShell>
  );
}

async function loadNotionState(userId: string): Promise<NotionSectionState> {
  let connection = await db.notionConnection.findUnique({ where: { userId } });

  // 設定画面を開いたときは間隔を待たず、Notion側で足した・直したプロパティを反映する。
  if (connection?.taskDataSourceId) {
    connection = await refreshTaskPropertyMapIfStale(createNotionClient(connection), connection, {
      force: true,
    });
  }

  if (!connection) {
    return {
      connected: false,
      workspaceName: null,
      taskDataSourceId: null,
      taskTitle: null,
      propertyMap: null,
      reminderDataSourceId: null,
      reminderTitle: null,
      reminderPropertyMap: null,
      placeDataSourceId: null,
      placeTitle: null,
      placePropertyMap: null,
      garbageDataSourceId: null,
      garbageTitle: null,
      garbagePropertyMap: null,
      workDataSourceId: null,
      workTitle: null,
      workPropertyMap: null,
      shoppingDataSourceId: null,
      shoppingTitle: null,
      shoppingPropertyMap: null,
      dataSources: [],
      sharedPages: [],
      dataSourcesFailed: false,
    };
  }

  // 候補一覧の取得に失敗しても設定画面自体は開けるようにする。
  // トークン失効時にここで例外を投げると、接続の解除もできなくなるため。
  let dataSources: DataSourceSummary[] = [];
  let sharedPages: SharedPageSummary[] = [];
  let dataSourcesFailed = false;
  try {
    const notion = createNotionClient(connection);
    [dataSources, sharedPages] = await Promise.all([
      listCandidateDataSources(notion),
      listSharedPages(notion),
    ]);
  } catch (error) {
    // 設定画面自体は開けるようにするため、握りつぶす代わりにログへ全文を残す
    // （CLAUDE.md「外部APIの扱い」）。
    externalApiMessage("notion", "データソース・共有ページ一覧の取得", error);
    dataSourcesFailed = true;
  }

  return {
    connected: true,
    workspaceName: connection.workspaceName,
    taskDataSourceId: connection.taskDataSourceId,
    taskTitle: connection.taskTitle,
    propertyMap: (connection.propertyMap as PropertyMap | null) ?? null,
    reminderDataSourceId: connection.reminderDataSourceId,
    reminderTitle: connection.reminderTitle,
    reminderPropertyMap: (connection.reminderPropertyMap as ReminderPropertyMap | null) ?? null,
    placeDataSourceId: connection.placeDataSourceId,
    placeTitle: connection.placeTitle,
    placePropertyMap: (connection.placePropertyMap as PlacePropertyMap | null) ?? null,
    garbageDataSourceId: connection.garbageDataSourceId,
    garbageTitle: connection.garbageTitle,
    garbagePropertyMap: (connection.garbagePropertyMap as ReminderPropertyMap | null) ?? null,
    workDataSourceId: connection.workDataSourceId,
    workTitle: connection.workTitle,
    workPropertyMap: (connection.workPropertyMap as WorkPropertyMap | null) ?? null,
    shoppingDataSourceId: connection.shoppingDataSourceId,
    shoppingTitle: connection.shoppingTitle,
    shoppingPropertyMap: (connection.shoppingPropertyMap as ShoppingPropertyMap | null) ?? null,
    dataSources,
    sharedPages,
    dataSourcesFailed,
  };
}
