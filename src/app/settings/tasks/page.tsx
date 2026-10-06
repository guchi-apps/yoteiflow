import { redirect } from "next/navigation";

import { SettingsShell } from "@/components/settings/settings-shell";
import { TagSection, type TagSectionState } from "@/components/settings/tag-section";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadTagOptions } from "@/services/notion/tag-options";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

/** NotionのページURL。IDのハイフンを外した形がそのままURLになる。 */
function notionUrl(databaseId: string | null): string | null {
  return databaseId ? `https://www.notion.so/${databaseId.replaceAll("-", "")}` : null;
}

export default async function TaskSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const connection = await db.notionConnection.findUnique({ where: { userId: user.id } });
  if (!connection) redirect("/settings/notion");

  const options = await loadTagOptions(connection, "task");
  const progressOptions = await loadTagOptions(connection, "progress");

  const state: TagSectionState = {
    kind: "task",
    title: "タスクのタグ",
    description: "タスクに付けられるタグです。入力画面では、ここに並んだものから選べます。",
    options,
    missingMessage:
      "タスクDBにタグ（マルチセレクト）のプロパティがありません。Notion側で追加してから、設定のNotion画面でタスクDBを選び直してください。",
    databaseUrl: notionUrl(connection.taskDatabaseId),
  };

  const progressState: TagSectionState = {
    kind: "progress",
    title: "タスクの進捗",
    description:
      "「承認待ち」「保留」のような途中の状態です。入力画面と詳細画面から選べ、完了とは別に持てます。",
    options: progressOptions,
    missingMessage:
      "タスクDBに進捗（セレクト）のプロパティがありません。設定のNotion画面で「不足しているプロパティを追加」を押すか、Notion側で「進捗」という名前のセレクトを足してから、タスクDBを選び直してください。",
    databaseUrl: notionUrl(connection.taskDatabaseId),
  };

  return (
    <SettingsShell
      title="タスク"
      description="タスクのタグと進捗の選択肢を、色つきで登録しておけます。"
      backHref="/settings"
      backLabel="設定"
    >
      <TagSection state={state} />
      <TagSection state={progressState} />
    </SettingsShell>
  );
}
