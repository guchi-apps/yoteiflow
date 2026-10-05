import type { WorkGenerated } from "@prisma/client";

import { db } from "@/lib/db";
import { decide, type Snapshot } from "@/lib/work-sync/decide";
import {
  planWorkItems,
  type ExpectedItem,
  type MissingRoute,
  type RouteLookup,
} from "@/lib/work-sync/plan";
import { resolveGoogleAccountForCalendar, getNotionPlaceConnection } from "@/services/calendar/write-context";
import {
  createEvent,
  deleteEvent,
  getEvent,
  updateEvent,
  type EventWriteInput,
} from "@/services/google-calendar/events";
import { loadPlaces } from "@/services/notion/places";
import { createTravel, deleteTravel, updateTravel } from "@/services/travel/plans";
import { isTravelMode } from "@/types/calendar";
import type { WorkRecordItem } from "@/types/work";

import { getWorkAutoSettings, resolveWorkCalendarId } from "./settings";

/**
 * 勤務記録から勤務予定（Google）・通勤/出張移動（TravelPlan）を同期する（docs/spec.md §46）。
 *
 * 触るのは `WorkGenerated` に控えのあるものだけ。手動で作った予定・移動には一切触れない。
 * 利用者が生成物を直接直した・消したときは手動扱いにし、以後は上書きも削除もしない。
 */

export type WorkSyncResult = {
  status: "synced" | "disabled";
  created: number;
  updated: number;
  deleted: number;
  /** 手動調整済みとして触らなかった数。 */
  manual: number;
  /** 既定の移動時間が未設定で作れなかった移動。設定へ誘導する。 */
  missingRoutes: MissingRoute[];
  errors: string[];
};

const emptyResult = (status: WorkSyncResult["status"]): WorkSyncResult => ({
  status,
  created: 0,
  updated: 0,
  deleted: 0,
  manual: 0,
  missingRoutes: [],
  errors: [],
});

export const GENERATED_NOTE = "勤務記録から自動生成（既定の移動時間）";

const iso = (date: Date) => date.toISOString();

function expectedSnapshot(item: ExpectedItem): Snapshot {
  return item.kind === "WORK"
    ? { start: iso(item.start), end: iso(item.end), title: item.title }
    : {
        start: iso(item.start),
        end: iso(item.end),
        origin: item.origin,
        destination: item.destination,
      };
}

function isGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /returned (404|410)\b/.test(message);
}

type CalendarTarget = Awaited<ReturnType<typeof resolveGoogleAccountForCalendar>>;

/** 生成物の現在の中身。消されていれば null。読めなければ例外。 */
async function readCurrent(userId: string, row: WorkGenerated): Promise<Snapshot | null> {
  if (row.kind === "WORK") {
    if (!row.googleCalendarId || !row.googleEventId) return null;
    const target = await resolveGoogleAccountForCalendar(userId, row.googleCalendarId);
    if (!target.ok) throw new Error("勤務予定の保存先カレンダーに書き込めません。");
    try {
      const event = await getEvent(target.account, row.googleCalendarId, row.googleEventId);
      if (event.status === "cancelled") return null;
      const start = event.start?.dateTime;
      const end = event.end?.dateTime;
      if (!start || !end) return null;
      return { start, end, title: event.summary ?? "" };
    } catch (error) {
      if (isGone(error)) return null;
      throw error;
    }
  }

  if (!row.travelPlanId) return null;
  const plan = await db.travelPlan.findFirst({ where: { id: row.travelPlanId, userId } });
  if (!plan) return null;
  return {
    start: iso(plan.departAt),
    end: iso(plan.arriveAt),
    origin: plan.origin,
    destination: plan.destination,
  };
}

function eventInput(item: ExpectedItem, timeZone: string, recordId: string): EventWriteInput {
  return {
    title: item.title,
    allDay: false,
    start: iso(item.start),
    end: iso(item.end),
    timeZone,
    privateProperties: { dayspanSource: "work", dayspanWorkRecord: recordId },
  };
}

function travelInput(item: ExpectedItem) {
  return {
    origin: item.origin!,
    destination: item.destination!,
    mode: item.mode ?? "PUBLIC_TRANSIT",
    departAt: iso(item.start),
    arriveAt: iso(item.end),
    note: GENERATED_NOTE,
    estimateSource: "MANUAL" as const,
    returnLeg: item.kind === "RETURN",
  };
}

async function reconcile(
  userId: string,
  workRecordId: string,
  expectedItems: ExpectedItem[],
  timeZone: string,
  result: WorkSyncResult,
): Promise<void> {
  const rows = await db.workGenerated.findMany({ where: { userId, workRecordId } });
  const rowByKey = new Map(rows.map((row) => [`${row.date}|${row.kind}`, row]));
  const expectedByKey = new Map(expectedItems.map((item) => [`${item.date}|${item.kind}`, item]));
  const keys = new Set([...rowByKey.keys(), ...expectedByKey.keys()]);

  let calendarId: string | null | undefined;
  const workTarget = async (): Promise<{ calendarId: string; target: CalendarTarget }> => {
    calendarId ??= await resolveWorkCalendarId(userId);
    if (!calendarId) throw new Error("勤務予定を書き出せるカレンダーがありません。");
    return { calendarId, target: await resolveGoogleAccountForCalendar(userId, calendarId) };
  };

  for (const key of keys) {
    const row = rowByKey.get(key) ?? null;
    const item = expectedByKey.get(key) ?? null;
    try {
      const current = row && row.status === "ACTIVE" ? await readCurrent(userId, row) : null;
      const expected = item ? expectedSnapshot(item) : null;
      const decision = decide(
        expected,
        row ? { status: row.status, snapshot: row.snapshot as Snapshot } : null,
        current,
      );

      switch (decision) {
        case "keep":
          if (row?.status === "MANUAL") result.manual += 1;
          break;
        case "markManual":
          await db.workGenerated.update({ where: { id: row!.id }, data: { status: "MANUAL" } });
          result.manual += 1;
          break;
        case "forget":
          await db.workGenerated.delete({ where: { id: row!.id } });
          result.manual += 1;
          break;
        case "create": {
          const data = {
            userId,
            workRecordId,
            date: item!.date,
            kind: item!.kind,
            snapshot: expected as object,
          };
          if (item!.kind === "WORK") {
            const { calendarId: calId, target } = await workTarget();
            if (!target.ok) throw new Error("勤務予定の保存先カレンダーに書き込めません。");
            const created = await createEvent(
              target.account,
              calId,
              eventInput(item!, timeZone, workRecordId),
            );
            await db.workGenerated.create({
              data: { ...data, googleCalendarId: calId, googleEventId: created.id },
            });
          } else {
            const saved = await createTravel(userId, travelInput(item!));
            await db.workGenerated.create({
              data: { ...data, travelPlanId: saved.travels[0].id },
            });
          }
          result.created += 1;
          break;
        }
        case "update": {
          if (item!.kind === "WORK") {
            const target = await resolveGoogleAccountForCalendar(userId, row!.googleCalendarId!);
            if (!target.ok) throw new Error("勤務予定の保存先カレンダーに書き込めません。");
            await updateEvent(
              target.account,
              row!.googleCalendarId!,
              row!.googleEventId!,
              eventInput(item!, timeZone, workRecordId),
            );
          } else {
            const input = travelInput(item!);
            if (!isTravelMode(input.mode)) throw new Error("交通手段が正しくありません。");
            await updateTravel(userId, row!.travelPlanId!, input);
          }
          await db.workGenerated.update({
            where: { id: row!.id },
            data: { snapshot: expected as object },
          });
          result.updated += 1;
          break;
        }
        case "delete": {
          if (row!.kind === "WORK") {
            const target = await resolveGoogleAccountForCalendar(userId, row!.googleCalendarId!);
            if (!target.ok) throw new Error("勤務予定の保存先カレンダーに書き込めません。");
            await deleteEvent(target.account, row!.googleCalendarId!, row!.googleEventId!).catch(
              (error: unknown) => {
                if (!isGone(error)) throw error;
              },
            );
          } else {
            await deleteTravel(userId, row!.travelPlanId!);
          }
          await db.workGenerated.delete({ where: { id: row!.id } });
          result.deleted += 1;
          break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[dayspan] work sync failed:", message);
      result.errors.push(message);
    }
  }
}

async function buildRouteLookup(userId: string): Promise<RouteLookup> {
  const routes = await db.workRouteDefault.findMany({ where: { userId } });
  const map = new Map(routes.map((route) => [`${route.origin}\n${route.destination}`, route]));
  return (origin, destination) => {
    const route = map.get(`${origin}\n${destination}`);
    return route ? { minutes: route.minutes, mode: route.mode } : null;
  };
}

/**
 * 勤務記録1件ぶんを同期する。自動生成がオフなら何もしない。
 * 生成・更新・削除の失敗は握りつぶさず `errors` へ載せる（勤務記録の保存そのものは成功のまま）。
 */
export async function syncWorkRecord(
  userId: string,
  record: WorkRecordItem,
): Promise<WorkSyncResult> {
  const settings = await getWorkAutoSettings(userId);
  if (!settings.enabled) return emptyResult("disabled");

  const result = emptyResult("synced");
  try {
    const connection = record.businessTrip ? await getNotionPlaceConnection(userId) : null;
    const places = connection ? await loadPlaces(connection) : [];
    const plan = planWorkItems(record, settings, places, await buildRouteLookup(userId));
    result.missingRoutes = plan.missingRoutes;
    await reconcile(userId, record.id, plan.items, settings.timeZone, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dayspan] work sync failed:", message);
    result.errors.push(message);
  }
  return result;
}

/**
 * 勤務記録を消したとき、生成した勤務予定・移動を片付ける。自動生成がオフでも行う
 * （オンの間に作ったものが、記録を消しても残り続けないようにするため）。
 */
export async function removeWorkRecordGenerated(
  userId: string,
  workRecordId: string,
): Promise<WorkSyncResult> {
  const result = emptyResult("synced");
  const settings = await getWorkAutoSettings(userId);
  await reconcile(userId, workRecordId, [], settings.timeZone, result);
  return result;
}
