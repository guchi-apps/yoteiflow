import { redirect } from "next/navigation";

import { WorkAutoSection } from "@/components/settings/work-auto-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { WorkPlacesPanel } from "@/components/settings/work-places-panel";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadWritableCalendars } from "@/services/calendar/load";
import { getNotionPlaceConnection } from "@/services/calendar/write-context";
import { listPlaces } from "@/services/notion/places";
import { loadPlaceDefaultRows, loadTrains, loadWorkPlaceLinks } from "@/services/work-sync/config";
import { getWorkAutoSettings } from "@/services/work-sync/settings";
import { loadTagOptions } from "@/services/notion/tag-options";
import { workCapabilities, workPlaceShortLabels, workTripPlaces } from "@/services/notion/work-logs";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

/** NotionのページURL。IDのハイフンを外した形がそのままURLになる。 */
function notionUrl(databaseId: string | null): string | null {
  return databaseId ? `https://www.notion.so/${databaseId.replaceAll("-", "")}` : null;
}

export default async function WorkSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ place?: string; extra?: string }>;
}) {
  const { place, extra } = await searchParams;
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

  return (
    <SettingsShell
      title="勤務"
      description="勤務場所を色つきで登録しておけます。勤務記録から勤務予定・移動を自動で作る設定もここにあります。"
      wide
    >
      <WorkPlacesPanel
        initialSelection={place ? { key: place, extra: extra === "1" } : null}
        options={options}
        missingMessage="勤務記録DBに勤務場所（セレクト）のプロパティがありません。Notion側で追加してから、設定のNotion画面で勤務記録DBを選び直してください。"
        databaseUrl={notionUrl(connection.workDatabaseId)}
        tripAvailable={workCapabilities(connection).businessTrip}
        tripPlaces={workTripPlaces(connection)}
        shortLabels={workPlaceShortLabels(connection)}
        remotePlaces={autoSettings.remotePlaces}
        home={autoSettings.homeOrigin}
        commonStart={autoSettings.startMinutes}
        commonEnd={autoSettings.endMinutes}
        defaults={placeDefaults}
        routes={routes.map((route) => ({
          id: route.id,
          origin: route.origin,
          destination: route.destination,
          mode: route.mode,
          minutes: route.minutes,
          isDefault: route.isDefault,
        }))}
        trains={trains}
        links={links}
        linkablePlaces={linkablePlaces}
      />
      <WorkAutoSection settings={autoSettings} calendars={calendars} />
    </SettingsShell>
  );
}
