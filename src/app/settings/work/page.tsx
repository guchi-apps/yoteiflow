import { redirect } from "next/navigation";

import { WorkAutoSection } from "@/components/settings/work-auto-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { TagSection, type TagSectionState } from "@/components/settings/tag-section";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadWritableCalendars } from "@/services/calendar/load";
import { getNotionPlaceConnection } from "@/services/calendar/write-context";
import { listPlaces } from "@/services/notion/places";
import { loadPlaceDefaultRows, loadTrains, loadWorkPlaceLinks } from "@/services/work-sync/config";
import { getWorkAutoSettings } from "@/services/work-sync/settings";
import { loadTagOptions } from "@/services/notion/tag-options";
import { workCapabilities, workTripPlaces } from "@/services/notion/work-logs";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

/** NotionのページURL。IDのハイフンを外した形がそのままURLになる。 */
function notionUrl(databaseId: string | null): string | null {
  return databaseId ? `https://www.notion.so/${databaseId.replaceAll("-", "")}` : null;
}

export default async function WorkSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const connection = await db.notionConnection.findUnique({ where: { userId: user.id } });
  if (!connection) redirect("/settings/notion");

  const [options, autoSettings, routes, placeDefaults, links, trains, calendars, linkablePlaces] = await Promise.all([
    loadTagOptions(connection, "work"),
    getWorkAutoSettings(user.id),
    db.workRouteDefault.findMany({
      where: { userId: user.id },
      orderBy: [{ destination: "asc" }, { origin: "asc" }],
    }),
    loadPlaceDefaultRows(user.id),
    loadWorkPlaceLinks(user.id),
    loadTrains(user.id),
    loadWritableCalendars(user.id),
    // 正式名称に選べる場所。読めなくても設定画面は開く（選択肢が空になるだけ）。
    getNotionPlaceConnection(user.id)
      .then((place) => listPlaces(place))
      .then((places) => places.map((place) => ({ id: place.id, name: place.name, address: place.address })))
      .catch(() => []),
  ]);

  const state: TagSectionState = {
    kind: "work",
    title: "勤務場所",
    description: "勤務の記録に付けられる場所です。1件につき1つだけ選べます。",
    options,
    missingMessage:
      "勤務記録DBに勤務場所（セレクト）のプロパティがありません。Notion側で追加してから、設定のNotion画面で勤務記録DBを選び直してください。",
    databaseUrl: notionUrl(connection.workDatabaseId),
    // 行けば必ず出張になる勤務先は、場所を選んだ時点で出張の既定を立てる（docs/spec.md §34）。
    // 選択肢の一覧がここにあるため、場所ごとの設定も同じ行に添える。
    trip: {
      places: workTripPlaces(connection),
      available: workCapabilities(connection).businessTrip,
    },
  };

  return (
    <SettingsShell
      title="勤務"
      description="勤務場所を色つきで登録しておけます。勤務記録から勤務予定・移動を自動で作る設定もここにあります。"
      backHref="/settings"
      backLabel="設定"
    >
      <TagSection state={state} />
      <WorkAutoSection
        settings={autoSettings}
        routes={routes.map((route) => ({
          id: route.id,
          origin: route.origin,
          destination: route.destination,
          mode: route.mode,
          minutes: route.minutes,
        }))}
        placeDefaults={placeDefaults}
        links={links}
        linkablePlaces={linkablePlaces}
        trains={trains}
        tripPlaces={workTripPlaces(connection)}
        calendars={calendars}
        placeNames={(options ?? []).map((option) => option.name)}
      />
    </SettingsShell>
  );
}
