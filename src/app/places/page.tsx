import Link from "next/link";
import { redirect } from "next/navigation";

import { PlacesScreen } from "@/components/places/places-screen";
import { SettingsShell } from "@/components/settings/settings-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { externalApiMessage } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import type { PlacePropertyMap } from "@/services/notion/place-database";
import { listPlaces, type PlaceItem } from "@/services/notion/places";
import { loadTagOptions, type TagOption } from "@/services/notion/tag-options";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

/**
 * 登録した場所の一覧・編集（docs/spec.md §9）。
 *
 * 場所は予定の場所欄の候補・移動の発着地・地図やYahoo!乗換案内を開く地点の出どころで、
 * 一度作ったあと直す手段がDaySpanの中に無かった（issue #445）。
 */
export default async function PlacesPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const connection = await db.notionConnection.findUnique({ where: { userId: user.id } });
  const map = (connection?.placePropertyMap as PlacePropertyMap | null) ?? {};

  // データソースと名前のプロパティが揃っていないと、読むことも書くこともできない。
  if (!connection?.placeDataSourceId || !map.name) return <ConnectPrompt />;

  // Notionが失敗しても画面自体は開く。ここで投げるとNext.jsの汎用のエラー画面へ落ち、
  // 何が起きたのかも、開き直せば直るのかも画面から分からなくなる（issue #402）。
  // loadPlaces ではなく listPlaces を使うのは、0件と取得失敗を区別する必要があるため。
  // タグの選択肢はこの画面（と /places/tags）でしか要らないため、まとめて取る loadTagCatalog
  // ではなく1種類ぶんだけ読む。カレンダー・タスクの経路へNotionへの往復を足さないため
  // （docs/spec.md §20）。取得に失敗しても null が返り、画面は開く。
  let places: PlaceItem[] = [];
  let loadError: string | null = null;
  let tagOptions: TagOption[] | null = null;
  try {
    [places, tagOptions] = await Promise.all([
      listPlaces(connection),
      loadTagOptions(connection, "place"),
    ]);
  } catch (error) {
    loadError = `場所を取得できませんでした。${externalApiMessage("notion", "場所の取得", error)}`;
  }

  return (
    <PlacesScreen
      places={places}
      loadError={loadError}
      // 場所DBの構成によっては住所・タグ・座標・最寄り駅の置き場所そのものが無い。
      // 持っていない欄は出さない。
      capabilities={{
        address: Boolean(map.address),
        tags: Boolean(map.tags),
        coordinates: Boolean(map.coordinates),
        station: Boolean(map.station),
      }}
      tagOptions={tagOptions ?? []}
    />
  );
}

/** 場所DBが未設定のとき。何を用意すればここが使えるようになるのかまで出す。 */
function ConnectPrompt() {
  return (
    <SettingsShell title="場所" backHref="/activity" backLabel="記録">
      <Card>
        <CardHeader>
          <CardTitle>場所DBが設定されていません</CardTitle>
          <CardDescription>
            よく行く場所はNotionのデータベースに保存します。設定のNotion画面で場所DBを選ぶか、
            新しく作成してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings/notion">設定へ</Link>
          </Button>
        </CardContent>
      </Card>
    </SettingsShell>
  );
}
