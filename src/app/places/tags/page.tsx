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

/**
 * 場所のタグの選択肢管理（追加・削除・改名・並び替え）。
 *
 * 「この場所にどのタグを付けるか」は場所という記録そのものの中身で、`/places` の編集
 * ダイアログで決める。一方「どんなタグがあるか・色・並び順・名前」は選択肢の定義で、
 * 記録操作画面（`/places`）とは分けつつ、入口は `/places` のヘッダーにまとめる
 * （issue #706）。
 */
export default async function PlaceTagSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const connection = await db.notionConnection.findUnique({ where: { userId: user.id } });
  if (!connection) redirect("/settings/notion");

  const options = await loadTagOptions(connection, "place");

  const state: TagSectionState = {
    kind: "place",
    title: "場所のタグ",
    description:
      "登録した場所に付けられるタグです。場所の編集画面では、ここに並んだものから選べます。",
    options,
    missingMessage:
      "場所DBにタグ（マルチセレクト）のプロパティがありません。Notion側で追加してから、設定のNotion画面で場所DBを選び直してください。",
    databaseUrl: notionUrl(connection.placeDatabaseId),
  };

  return (
    <SettingsShell title="場所のタグ" backHref="/places" backLabel="場所">
      <TagSection state={state} />
    </SettingsShell>
  );
}
