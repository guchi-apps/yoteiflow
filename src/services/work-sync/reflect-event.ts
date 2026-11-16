import { db } from "@/lib/db";
import type { Snapshot } from "@/lib/work-sync/decide";
import { zonedTime } from "@/lib/work-sync/plan";
import {
  applyEventTime,
  reflectTarget,
  type EditedWorkEvent,
} from "@/lib/work-sync/reflect-event";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { getWorkRecord } from "@/services/notion/work-logs";

import { getRecordOverride, saveRecordOverride } from "./config";
import { getWorkAutoSettings } from "./settings";
import { syncWorkRecord } from "./sync";

/**
 * カレンダーで自動生成の勤務予定の時刻を直したとき、その勤務記録の指定（勤務画面の
 * 「カレンダーへの反映」の勤務開始・終了）へ書き戻し、往路・復路も再計算する
 * （docs/spec.md §46・issue #1618）。
 *
 * 反映できない編集（時刻以外も直した・日をまたぐ・時間帯の内訳のある記録・生成物でない予定）は
 * 何もせず、従来どおり次の同期で手動調整扱いになる。記録を読めないときも何も書かない。
 * @returns 反映したか
 */
export async function reflectWorkEventEdit(
  userId: string,
  eventId: string,
  edit: EditedWorkEvent & { allDay: boolean },
): Promise<boolean> {
  if (edit.allDay) return false;
  const row = await db.workGenerated.findFirst({
    where: { userId, googleEventId: eventId, kind: "WORK", status: "ACTIVE", seq: 0 },
  });
  if (!row) return false;

  const settings = await getWorkAutoSettings(userId);
  if (!settings.enabled) return false;
  const target = reflectTarget(row.snapshot as Snapshot, row.date, edit, settings.timeZone);
  if (!target) return false;

  const connection = await getNotionWorkConnection(userId);
  if (!connection) return false;
  const record = await getWorkRecord(createNotionClient(connection), connection, row.workRecordId);
  // 時間帯の内訳のある記録は区切りが勤務時間を決めるため、この指定では動かせない。
  if (!record || record.segments.length > 0) return false;

  const override = applyEventTime(await getRecordOverride(userId, record.id), record, target);
  await saveRecordOverride(userId, record.id, override);
  // 控えも新しい時刻へ直す。直さないと、現在の予定が控えと不一致のため手動調整扱いになり、
  // 以後の更新・往路復路の追随が止まる。
  const snapshot: Snapshot = {
    ...(row.snapshot as Snapshot),
    start: zonedTime(row.date, target.startMinutes, settings.timeZone).toISOString(),
    end: zonedTime(row.date, target.endMinutes, settings.timeZone).toISOString(),
  };
  await db.workGenerated.update({ where: { id: row.id }, data: { snapshot: snapshot as object } });
  await syncWorkRecord(userId, record);
  return true;
}
