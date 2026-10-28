import { db } from "@/lib/db";
import type { WorkPlaceLinkRow } from "@/lib/work-place-link";
import type { TrainInput } from "@/lib/work-sync/train";
import { readStoredOverride } from "@/lib/work-sync/override";
import { MAX_ROUTE_MINUTES, transitMinutes } from "@/lib/work-sync/route-modes";
import type {
  PlaceDefaultsLookup,
  TrainLookup,
  WorkPlaceDefaults,
  WorkRecordOverride,
  WorkTrainItem,
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

/** よく使う電車（issue #1347）。出発地・行き先・出発時刻の順に並べる。 */
export async function loadTrains(userId: string): Promise<WorkTrainItem[]> {
  const rows = await db.workTrain.findMany({
    where: { userId },
    orderBy: [{ origin: "asc" }, { destination: "asc" }, { departMinutes: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    origin: row.origin,
    destination: row.destination,
    label: row.label,
    departMinutes: row.departMinutes,
    durationMinutes: row.durationMinutes,
    isDefault: row.isDefault,
    note: row.note,
  }));
}

export function trainLookup(rows: WorkTrainItem[]): TrainLookup {
  const map = new Map(rows.map((row) => [row.id, row]));
  return (id) => map.get(id) ?? null;
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

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * 組（出発地 → 行き先）の公共交通の所要時間を、基準の電車の所要分 + 徒歩で保存し直す（issue #1458）。
 * 公共交通の行がある組だけ更新する（行を作るのは画面の保存）。組に電車が無ければ手入力の分を据え置く。
 */
async function recomputeTransitRoute(
  tx: Tx,
  userId: string,
  origin: string,
  destination: string,
): Promise<void> {
  const pair = { userId, origin, destination };
  const route = await tx.workRouteDefault.findUnique({
    where: { userId_origin_destination_mode: { ...pair, mode: "PUBLIC_TRANSIT" } },
  });
  if (!route) return;
  const minutes = transitMinutes(await tx.workTrain.findMany({ where: pair }), route.walkMinutes);
  if (minutes === null || minutes === route.minutes) return;
  await tx.workRouteDefault.update({ where: { id: route.id }, data: { minutes: Math.min(minutes, MAX_ROUTE_MINUTES) } });
}

/**
 * 電車を追加・更新する。デフォルトにするときは、更新後の（出発地, 行き先）の組で他の行の
 * デフォルトを外す（組を付け替えても、移動先の組でデフォルトが2件並ばないように）。
 * 公共交通の所要時間は同じトランザクションで、更新前・更新後の両方の組について求め直す。
 * 更新対象が無ければ null。
 */
export async function saveTrain(
  userId: string,
  id: string | null,
  train: TrainInput,
): Promise<{ id: string } | null> {
  return db.$transaction(async (tx) => {
    let savedId: string;
    let before: { origin: string; destination: string } | null = null;
    if (id) {
      before = await tx.workTrain.findFirst({
        where: { id, userId },
        select: { origin: true, destination: true },
      });
      const result = await tx.workTrain.updateMany({ where: { id, userId }, data: train });
      if (result.count === 0) return null;
      savedId = id;
    } else {
      savedId = (await tx.workTrain.create({ data: { userId, ...train } })).id;
    }
    if (train.isDefault) {
      await tx.workTrain.updateMany({
        where: {
          userId,
          origin: train.origin,
          destination: train.destination,
          id: { not: savedId },
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }
    await recomputeTransitRoute(tx, userId, train.origin, train.destination);
    if (before && (before.origin !== train.origin || before.destination !== train.destination)) {
      await recomputeTransitRoute(tx, userId, before.origin, before.destination);
    }
    return { id: savedId };
  });
}

/** 電車を消し、その組の公共交通の所要時間を同じトランザクションで求め直す。 */
export async function deleteTrain(userId: string, id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const target = await tx.workTrain.findFirst({
      where: { id, userId },
      select: { origin: true, destination: true },
    });
    if (!target) return;
    await tx.workTrain.deleteMany({ where: { id, userId } });
    await recomputeTransitRoute(tx, userId, target.origin, target.destination);
  });
}

/** 勤務場所ごとの正式名称の場所と省略名（issue #1382）。 */
export async function loadWorkPlaceLinks(userId: string): Promise<WorkPlaceLinkRow[]> {
  const rows = await db.workPlaceLink.findMany({ where: { userId }, orderBy: { workPlace: "asc" } });
  return rows.map((row) => ({
    workPlace: row.workPlace,
    placeId: row.placeId,
    shortLabel2: row.shortLabel2,
    shortLabel1: row.shortLabel1,
  }));
}
