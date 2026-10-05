import type { TravelPlan } from "@prisma/client";

import { db } from "@/lib/db";
import { placeDisplayName } from "@/lib/place-text";
import {
  isTravelEstimateSource,
  isTravelMode,
  type TravelEstimateSource,
  type TravelItem,
  type TravelMode,
} from "@/types/calendar";

import { dropLinksForTravel, syncLinksForTravel } from "@/services/task-links/links";
import type { TravelLinkInput } from "./link-input";
import { exportTravelToGoogle, removeTravelFromGoogle, type TravelExportResult } from "./google-sync";
import { resolveTravelCalendarId } from "./settings";

/**
 * 移動の読み書き（docs/spec.md §29）。
 *
 * 本体はDaySpanのDBにあり、Googleへは写しを書き出す。保存はまずDBへ行い、
 * そのあとでGoogleへ書く。順序を逆にすると、DBへの保存で失敗したときにGoogle側だけに
 * 予定が残り、DaySpanからは触れない予定になる。
 */

export type TravelWriteInput = {
  origin: string;
  destination: string;
  mode: TravelMode;
  /** ISO 8601 */
  departAt: string;
  arriveAt: string;
  note?: string | null;
  /**
   * 所要時間の出どころ。渡されなければ estimated から決める。
   * 古い呼び出し元（AIの見積もりしか無かった頃の形）をそのまま受けられるようにしておく。
   */
  estimateSource?: TravelEstimateSource;
  estimated?: boolean;
  linkedEventId?: string | null;
  linkedCalendarId?: string | null;
  /** 復路として作るか。省略時は、`createTravel` が往路・復路の並びから決める。 */
  returnLeg?: boolean;
};

/** 復路。行きと同じ経路を入れ替えて作るため、時刻だけを受け取る。 */
export type TravelReturnInput = { departAt: string; arriveAt: string };

/**
 * 入力の検証。作成・更新のどちらの経路でも同じ条件で断る。
 *
 * UIでも同じ検証をしているが、DaySpanのAPIや将来のMCPから直接呼ばれた要求は画面を通らない。
 * 時刻の前後関係は toWriteData 側で見る（Dateに直してからでないと判定できないため）。
 */
export function validateTravelInput(body: Partial<TravelWriteInput>): string | null {
  if (!body.origin?.trim()) return "出発地を入力してください。";
  if (!body.destination?.trim()) return "目的地を入力してください。";
  if (!isTravelMode(body.mode)) return "交通手段を選んでください。";
  if (!body.departAt || !body.arriveAt) return "出発時刻と到着時刻を入力してください。";
  return null;
}

export type TravelSaveResult = {
  travels: TravelItem[];
  /** Googleへの書き出し結果。書き出せなかった理由を画面に出すために返す。 */
  exports: TravelExportResult[];
};

/**
 * 移動をカレンダー画面向けの形へ直す。
 *
 * `color`は書き出し先カレンダーの色（issue #492）。呼び出し元（`createTravel`/`updateTravel`）が
 * 省略しているのは、その戻り値（`TravelSaveResult.travels`）が画面では実際には読まれていないため。
 * 保存後は `onSaved()` 経由で `loadCalendarData()` が触れた期間を取り直し、そちらで
 * `WritableCalendar[]` と突き合わせて色を解決する（`src/services/calendar/load.ts`）。
 */
export function toTravelItem(plan: TravelPlan, color: string | null = null): TravelItem {
  return {
    kind: "travel",
    id: plan.id,
    // カレンダー上では場所名だけを出す。住所付きの生の値は origin/destination に残す
    // （編集フォームの初期値・地点解決に要るため。issue #587）。
    title: `${placeDisplayName(plan.origin)} → ${placeDisplayName(plan.destination)}`,
    origin: plan.origin,
    destination: plan.destination,
    mode: plan.mode,
    start: plan.departAt.toISOString(),
    end: plan.arriveAt.toISOString(),
    note: plan.note,
    estimated: plan.estimateSource !== "MANUAL",
    estimateSource: plan.estimateSource,
    linkedEventId: plan.linkedEventId,
    returnLeg: plan.returnLeg,
    exported: Boolean(plan.googleEventId),
    color,
  };
}

/**
 * 期間に重なる移動を取得する。
 *
 * 開始が範囲に入っているものだけを採ると、範囲の直前に出発して範囲内に着く移動が落ちる。
 * Googleの予定取得（timeMin/timeMax）と同じく、重なりで採る。
 */
export async function listTravelsInRange(
  userId: string,
  range: { timeMin: string; timeMax: string },
): Promise<TravelPlan[]> {
  return db.travelPlan.findMany({
    where: {
      userId,
      departAt: { lt: new Date(range.timeMax) },
      arriveAt: { gt: new Date(range.timeMin) },
    },
    orderBy: { departAt: "asc" },
  });
}

export async function getTravel(userId: string, travelId: string): Promise<TravelPlan | null> {
  return db.travelPlan.findFirst({ where: { id: travelId, userId } });
}

/**
 * 移動を作る。復路を渡された場合は、出発地と目的地を入れ替えた2件目も作る。
 *
 * 行きだけ作られても帰りは手で入れ直すことになるため、既定では呼び出し側が復路を渡す
 * （設定で片道に変えられる。docs/spec.md §29）。
 */
export async function createTravel(
  userId: string,
  input: TravelWriteInput,
  returnTrip?: TravelReturnInput | null,
): Promise<TravelSaveResult> {
  const calendarId = await resolveTravelCalendarId(userId);
  const timeZone = await getTimeZone(userId);

  const legs: TravelWriteInput[] = [input];
  if (returnTrip) {
    legs.push({
      ...input,
      origin: input.destination,
      destination: input.origin,
      departAt: returnTrip.departAt,
      arriveAt: returnTrip.arriveAt,
    });
  }

  const travels: TravelItem[] = [];
  const exports: TravelExportResult[] = [];

  for (const [index, leg] of legs.entries()) {
    const plan = await db.travelPlan.create({
      data: { ...toWriteData(leg), userId, returnLeg: leg.returnLeg ?? index > 0 },
    });

    const exported = await exportTravelToGoogle(userId, plan, calendarId, timeZone);
    exports.push(exported);

    travels.push(
      toTravelItem(
        exported.status === "exported"
          ? { ...plan, googleCalendarId: exported.calendarId, googleEventId: exported.eventId }
          : plan,
      ),
    );
  }

  return { travels, exports };
}

/**
 * Yahoo!乗換案内の共有から取り込んだ移動を作る（issue #1026）。同じ経路を共有し直しても二重に
 * 作らない。同一ユーザーで出発地・目的地・出発・到着が一致する移動があれば、作らずそれを返す。
 */
export async function importSharedTravel(
  userId: string,
  input: TravelWriteInput,
): Promise<{ duplicate: boolean; result: TravelSaveResult | null }> {
  const existing = await db.travelPlan.findFirst({
    where: {
      userId,
      origin: input.origin,
      destination: input.destination,
      departAt: new Date(input.departAt),
      arriveAt: new Date(input.arriveAt),
    },
    select: { id: true },
  });
  if (existing) return { duplicate: true, result: null };

  return { duplicate: false, result: await createTravel(userId, input) };
}

/** 移動を書き換え、Google側の予定も同じ内容へ揃える。 */
export async function updateTravel(
  userId: string,
  travelId: string,
  input: TravelWriteInput,
): Promise<TravelSaveResult | null> {
  const existing = await getTravel(userId, travelId);
  if (!existing) return null;

  const updated = await db.travelPlan.update({
    where: { id: existing.id },
    data: toWriteData(input),
  });

  // 紐づいたタスクの日付を追随させる（issue #914）。失敗しても移動の更新は成功のまま扱う
  // （追随できなかった分は日付のずれとして画面に出る）。
  await syncLinksForTravel(userId, updated.id, updated).catch((error: unknown) => {
    console.error(
      "[dayspan] travel task link sync failed:",
      error instanceof Error ? error.message : String(error),
    );
  });

  const calendarId = await resolveTravelCalendarId(userId);
  const exported = await exportTravelToGoogle(userId, updated, calendarId, await getTimeZone(userId));

  return {
    travels: [
      toTravelItem(
        exported.status === "exported"
          ? { ...updated, googleCalendarId: exported.calendarId, googleEventId: exported.eventId }
          : updated,
      ),
    ],
    exports: [exported],
  };
}

/**
 * 既存の予定と移動を後から結ぶ・外す（issue #1105）。linkがnullなら解除。
 *
 * 紐づけ先の予定は存在を確かめない。Googleへの往復が増えるうえ、予定は取得範囲の外にもありうる
 * （タスクの紐づけと同じ割り切り）。Googleへ書き出す内容に紐づけは含まれないため再書き出しもしない。
 * 画面の判定は予定IDだけで、カレンダーIDは保存するだけ。
 */
export async function setTravelLink(
  userId: string,
  travelId: string,
  link: TravelLinkInput | null,
): Promise<TravelItem | null> {
  const existing = await getTravel(userId, travelId);
  if (!existing) return null;

  const updated = await db.travelPlan.update({
    where: { id: existing.id },
    data: link
      ? { linkedEventId: link.eventId, linkedCalendarId: link.calendarId, returnLeg: link.returnLeg }
      : { linkedEventId: null, linkedCalendarId: null, returnLeg: false },
  });

  return toTravelItem(updated);
}

/**
 * 移動を消す。Google側の予定も消す。
 *
 * Googleを先に消すのは、DBの行を先に消すと書き出し先のIDが分からなくなり、
 * Google側にだけ予定が残るため。Googleの削除が失敗した場合はDBの行も残し、
 * もう一度削除を押せば両方消せる状態にしておく。
 */
export async function deleteTravel(userId: string, travelId: string): Promise<boolean> {
  const existing = await getTravel(userId, travelId);
  if (!existing) return false;

  await removeTravelFromGoogle(userId, existing);
  await db.travelPlan.delete({ where: { id: existing.id } });
  // 紐づいたタスクの紐づけは外し、入っている日付は残す（予定を消したときと同じ扱い）。
  await dropLinksForTravel(userId, existing.id);

  return true;
}

function toWriteData(input: TravelWriteInput) {
  const departAt = new Date(input.departAt);
  const arriveAt = new Date(input.arriveAt);

  if (Number.isNaN(departAt.getTime()) || Number.isNaN(arriveAt.getTime())) {
    throw new Error("出発時刻と到着時刻を入力してください。");
  }
  if (arriveAt.getTime() <= departAt.getTime()) {
    throw new Error("到着時刻は出発時刻より後にしてください。");
  }

  return {
    origin: input.origin.trim(),
    destination: input.destination.trim(),
    mode: input.mode,
    departAt,
    arriveAt,
    note: input.note?.trim() || null,
    estimateSource: resolveEstimateSource(input),
    // 項目ごと渡されなかったときは触らない。編集の保存で紐づけが外れないようにするため
    // （issue #1105）。作成のときは未指定でもnullで入る（列の既定値）。紐づけの付け外しは
    // setTravelLink の入口だけが行う。
    ...(input.linkedEventId !== undefined ? { linkedEventId: input.linkedEventId } : {}),
    ...(input.linkedCalendarId !== undefined ? { linkedCalendarId: input.linkedCalendarId } : {}),
  };
}

/**
 * 所要時間の出どころを決める。
 *
 * `estimateSource` を優先し、無ければ `estimated`（AIかどうか）から決める。
 * どちらも無ければ手入力。UIで隠すだけにせずここで決めるのは、DaySpanのAPIや
 * 将来のMCPから直接呼ばれた要求が画面を通らないため。
 */
function resolveEstimateSource(input: TravelWriteInput): TravelEstimateSource {
  if (isTravelEstimateSource(input.estimateSource)) return input.estimateSource;
  return input.estimated ? "AI" : "MANUAL";
}

export async function getTimeZone(userId: string): Promise<string> {
  const setting = await db.uiSetting.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  return setting?.timeZone ?? "Asia/Tokyo";
}
