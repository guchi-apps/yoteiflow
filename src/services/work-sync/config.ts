import { db } from "@/lib/db";
import { readStoredOverride } from "@/lib/work-sync/override";
import type {
  PlaceDefaultsLookup,
  WorkPlaceDefaults,
  WorkRecordOverride,
} from "@/lib/work-sync/plan";

/** 勤務先別の既定（issue #1099）と、勤務記録ごとの指定の読み書き。 */

export type WorkPlaceDefaultRow = WorkPlaceDefaults & { key: string; isTrip: boolean };

export async function loadPlaceDefaultRows(userId: string): Promise<WorkPlaceDefaultRow[]> {
  const rows = await db.workPlaceDefault.findMany({
    where: { userId },
    orderBy: [{ isTrip: "asc" }, { key: "asc" }],
  });
  return rows.map((row) => ({
    key: row.key,
    isTrip: row.isTrip,
    workEnabled: row.workEnabled,
    startMinutes: row.startMinutes,
    endMinutes: row.endMinutes,
    outboundEnabled: row.outboundEnabled,
    returnEnabled: row.returnEnabled,
  }));
}

export function placeDefaultsLookup(rows: WorkPlaceDefaultRow[]): PlaceDefaultsLookup {
  const map = new Map(rows.map((row) => [`${row.isTrip ? "T" : "W"}\n${row.key}`, row]));
  return (key, isTrip) => map.get(`${isTrip ? "T" : "W"}\n${key}`) ?? null;
}

export async function getRecordOverride(
  userId: string,
  workRecordId: string,
): Promise<WorkRecordOverride | null> {
  const row = await db.workRecordSetting.findUnique({
    where: { userId_workRecordId: { userId, workRecordId } },
  });
  return row ? readStoredOverride(row.settings) : null;
}

export async function saveRecordOverride(
  userId: string,
  workRecordId: string,
  override: WorkRecordOverride,
): Promise<void> {
  const settings = override as object;
  await db.workRecordSetting.upsert({
    where: { userId_workRecordId: { userId, workRecordId } },
    create: { userId, workRecordId, settings },
    update: { settings },
  });
}

export async function deleteRecordOverride(userId: string, workRecordId: string): Promise<void> {
  await db.workRecordSetting.deleteMany({ where: { userId, workRecordId } });
}
