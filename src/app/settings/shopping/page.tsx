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

export default async function ShoppingSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const connection = await db.notionConnection.findUnique({ where: { userId: user.id } });
  if (!connection) redirect("/settings/notion");

  const options = await loadTagOptions(connection, "shopping");

  const state: TagSectionState = {
    kind: "shopping",
    title: "買い物のカテゴリ",
    description:
      "買い物リストの項目に付けられるカテゴリです。買い物画面のタブもこの並び順で出ます。",
    options,
    missingMessage:
      "買い物リストDBにカテゴリ（セレクト）のプロパティがありません。Notion側で追加してから、設定のNotion画面で買い物リストDBを選び直してください。",
    databaseUrl: notionUrl(connection.shoppingDatabaseId),
  };

  return (
    <SettingsShell
      title="買い物リスト"
      description="買い物のカテゴリを色つきで登録しておけます。"
      backHref="/settings"
      backLabel="設定"
    >
      <TagSection state={state} />
    </SettingsShell>
  );
}
