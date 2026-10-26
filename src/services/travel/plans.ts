import type { TravelPlan } from "@prisma/client";

import { db } from "@/lib/db";
import { travelTitle } from "@/lib/travel-title";
import { parseVia, serializeVia } from "@/lib/travel-via";
import {
  isTravelEstimateSource,
  type TravelEstimateSource,
  type TravelItem,
  type TravelMode,
  type TravelSearchPurpose,
} from "@/types/calendar";

import {
  dropNotificationSettingForTravel,
  replanNotifications,
} from "@/services/calendar/event-notification-settings";
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
  /** 出発地と目的地の間の経由地（順番どおり）。省略・空なら経由なし（issue #1197） */
  via?: string[] | null;
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
  /**
   * 勤務同期（issue #1081）が生成する移動の旧区分。画面・判定では使わず、予定との前後は
   * 日時から決める（issue #1137）。通常の登録は省略（false）。
   */
  returnLeg?: boolean;
  /** 探したときの意図と余裕分（issue #1331）。項目ごと省くと触らない（編集で消さない） */
  searchPurpose?: TravelSearchPurpose | null;
  searchMarginMinutes?: number | null;
  /**
   * 探したときの紐づく予定の開始・終了・場所（issue #1332）。予定が後で変わったかを比べる相手。
   * 項目ごと省くと触らない。渡したときは「今は変更しない」の印も消す（新しい検索で見直したため）。
   */
  searchEvent?: { start: string; end: string; location: string | null } | null;
};

/** 共有から戻した経路で元の移動を更新しようとしたが、その間に紐づけが外れていた（issue #1332）。 */
export class TravelLinkChangedError extends Error {
  constructor() {
    super("元の移動の紐づけが変わっています。");
  }
}

export { validateTravelInput } from "./travel-validation";

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
    title: travelTitle(plan),
    via: parseVia(plan.via),
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
    searchPurpose: plan.searchPurpose,
    searchMarginMinutes: plan.searchMarginMinutes,
    searchEvent:
      plan.searchEventStart && plan.searchEventEnd
        ? {
            start: plan.searchEventStart.toISOString(),
            end: plan.searchEventEnd.toISOString(),
            location: plan.searchEventLocation,
          }
        : null,
    followDismissedKey: plan.followDismissedKey,
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
 * 移動を1件作る。帰りの移動も必要なら別の移動として登録する（issue #1137。
 * 以前あった復路の一括作成は廃止した）。
 */
export async function createTravel(
  userId: string,
  input: TravelWriteInput,
): Promise<TravelSaveResult> {
  const plan = await createTravelRecord(userId, input);
  const exported = await exportCreatedTravel(userId, plan);
  return toSaveResult(plan, exported);
}

/**
 * 移動をDBへ保存するだけ（Googleへは書かない）。保存と書き出しの間でIDを控えたい呼び出し元
 * （内部APIの冪等処理・issue #1432）のために `createTravel` から切り出した。
 */
export async function createTravelRecord(userId: string, input: TravelWriteInput): Promise<TravelPlan> {
  return db.travelPlan.create({
    data: { ...toWriteData(input), userId, returnLeg: input.returnLeg ?? false },
  });
}

/** 保存済みの移動をGoogleへ書き出す（書き出し先と時間帯は設定から解決する）。失敗しても投げない。 */
export async function exportCreatedTravel(userId: string, plan: TravelPlan): Promise<TravelExportResult> {
  const calendarId = await resolveTravelCalendarId(userId);
  const timeZone = await getTimeZone(userId);
  return exportTravelToGoogle(userId, plan, calendarId, timeZone);
}

export function toSaveResult(plan: TravelPlan, exported: TravelExportResult): TravelSaveResult {
  return {
    travels: [
      toTravelItem(
        exported.status === "exported"
          ? { ...plan, googleCalendarId: exported.calendarId, googleEventId: exported.eventId }
          : plan,
      ),
    ],
    exports: [exported],
  };
}

/**
 * 同じ出発地・目的地・経由地・出発・到着の移動が既にあればそのIDを返す（内部APIの重複確認用。
 * 共有取り込み `importSharedTravel` と同じ条件）。
 */
export async function findSameTravelId(
  userId: string,
  input: Pick<TravelWriteInput, "origin" | "destination" | "via" | "departAt" | "arriveAt">,
): Promise<string | null> {
  const existing = await db.travelPlan.findFirst({
    where: {
      userId,
      origin: input.origin.trim(),
      destination: input.destination.trim(),
      via: serializeVia(input.via),
      departAt: new Date(input.departAt),
      arriveAt: new Date(input.arriveAt),
    },
    select: { id: true },
  });
  return existing?.id ?? null;
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
      via: serializeVia(input.via),
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
  /** 共有から戻した経路での更新。紐づく予定が変わっていたら書かずに断る（issue #1332） */
  expect?: { linkedEventId: string },
): Promise<TravelSaveResult | null> {
  const existing = await getTravel(userId, travelId);
  if (!existing) return null;
  if (expect && existing.linkedEventId !== expect.linkedEventId) throw new TravelLinkChangedError();

  const updated = await db.travelPlan.update({
    where: { id: existing.id },
    data: toWriteData(input),
  });

  // 出発時刻が変わったら通知の下書きを作り直させる（issue #1112。次の作り直しまで古い時刻で送られない）。
  if (existing.departAt.getTime() !== updated.departAt.getTime()) await replanNotifications(userId);

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
 * 「今は変更しない」を押した変更の印を残す（issue #1332）。移動の中身・Googleの予定は触らない。
 * 同じ変更（印が同じ）では再提案を出さず、予定がさらに変われば印が変わってまた出る。
 */
export async function dismissTravelFollow(userId: string, travelId: string, key: string): Promise<boolean> {
  const result = await db.travelPlan.updateMany({
    where: { id: travelId, userId },
    data: { followDismissedKey: key.slice(0, 512) },
  });
  return result.count > 0;
}

/**
 * 既存の予定と移動を後から結ぶ・外す（issue #1105）。linkがnullなら解除。
 *
 * 紐づけ先の予定は存在を確かめない。Googleへの往復が増えるうえ、予定は取得範囲の外にもありうる
 * （タスクの紐づけと同じ割り切り）。Googleへ書き出す内容に紐づけは含まれないため再書き出しもしない。
 * 画面の判定は予定IDだけで、カレンダーIDは保存するだけ。往路・復路は持たず（issue #1137）、
 * 経路・日時も書き換えない。
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
      ? { linkedEventId: link.eventId, linkedCalendarId: link.calendarId }
      : { linkedEventId: null, linkedCalendarId: null },
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
  await dropNotificationSettingForTravel(userId, existing.id);

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
    via: serializeVia(input.via),
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
    // 探した意図も、渡されなかったときは触らない（意図を知らない経路の編集で消さない・issue #1331）
    ...(input.searchPurpose !== undefined ? { searchPurpose: input.searchPurpose } : {}),
    ...(input.searchMarginMinutes !== undefined ? { searchMarginMinutes: input.searchMarginMinutes } : {}),
    ...(input.searchEvent !== undefined
      ? {
          searchEventStart: input.searchEvent ? new Date(input.searchEvent.start) : null,
          searchEventEnd: input.searchEvent ? new Date(input.searchEvent.end) : null,
          searchEventLocation: input.searchEvent?.location?.trim() || null,
          followDismissedKey: null,
        }
      : {}),
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
