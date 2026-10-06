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

export default async function ReminderSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const connection = await db.notionConnection.findUnique({ where: { userId: user.id } });
  if (!connection) redirect("/settings/notion");

  const options = await loadTagOptions(connection, "reminder");

  const state: TagSectionState = {
    kind: "reminder",
    title: "日付リマインドの種類",
    description: "日付リマインドに付けられる種類です。1件につき1つだけ選べます。",
    options,
    missingMessage:
      "日付リマインドDBに種類（セレクト）のプロパティがありません。Notion側で追加してから、設定のNotion画面で日付リマインドDBを選び直してください。",
    databaseUrl: notionUrl(connection.reminderDatabaseId),
  };

  return (
    <SettingsShell
      title="日付リマインド"
      description="日付リマインドの種類を色つきで登録しておけます。"
      backHref="/settings"
      backLabel="設定"
    >
      <TagSection state={state} />
    </SettingsShell>
  );
}
