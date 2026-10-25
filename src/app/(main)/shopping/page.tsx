import Link from "next/link";
import { redirect } from "next/navigation";
import { ShoppingCart } from "lucide-react";

import { ShoppingScreen } from "@/components/shopping/shopping-screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { shoppingDatabaseReady } from "@/services/notion/shopping-items";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

export default async function ShoppingPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const [uiSetting, connection] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId: user.id }, select: { timeZone: true } }),
    db.notionConnection.findUnique({ where: { userId: user.id } }),
  ]);

  // データソースと項目名のプロパティが揃っていないと、読むことも書くこともできない。
  if (!connection || !shoppingDatabaseReady(connection)) return <ConnectPrompt />;

  // 一覧とカテゴリはここで待たない。Notionが遅いと追加ボタンまで出なくなるため、画面の枠だけを
  // すぐ返し、一覧はクライアントが /api/shopping から背景取得する（issue #724）。
  return <ShoppingScreen timeZone={uiSetting?.timeZone ?? "Asia/Tokyo"} />;
}

/** 買い物リストDBが未設定のとき。何を用意すればここが使えるようになるのかまで出す。 */
function ConnectPrompt() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-xl font-semibold">
        <ShoppingCart className="size-6 text-primary" />
        買い物リスト
      </div>
      <Card>
        <CardHeader>
          <CardTitle>買い物リストDBが設定されていません</CardTitle>
          <CardDescription>
            買うものはNotionのデータベースに記録します。設定のNotion画面で買い物リストDBを選ぶか、
            新しく作成してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings/notion">Notion設定へ</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
