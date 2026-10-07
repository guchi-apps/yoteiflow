import { parseRelationEvent, type RelationEvent } from "@/lib/travel-relation";

/**
 * 既存の予定と移動を後から結ぶ入力の検証（issue #1105）。
 *
 * DBを読み込まない純粋な関数に閉じているのは、`node --test` で単体に確かめるため。
 * 画面でも同じ検証をしているが、DaySpanのAPIや将来のMCPから直接呼ばれた要求は画面を通らない。
 *
 * 往路・復路は指定させない（issue #1137）。旧クライアントが `returnLeg` を送ってきても受け取って
 * 無視する。予定との前後は日時から判断する（`src/lib/travel-relation.ts`）。
 */
export type TravelLinkInput = {
  calendarId: string;
  eventId: string;
  /** 予定の時刻。持ち物の期限の自動紐づけ判定にだけ使う（無ければ自動では紐づけない）。 */
  event: RelationEvent | null;
};

export function parseTravelLinkInput(
  body: Record<string, unknown> | null | undefined,
): { ok: true; value: TravelLinkInput } | { ok: false; message: string } {
  const calendarId = typeof body?.calendarId === "string" ? body.calendarId.trim() : "";
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  if (!calendarId || !eventId) return { ok: false, message: "紐づける予定を指定してください。" };
  return { ok: true, value: { calendarId, eventId, event: parseRelationEvent(body ?? {}) } };
}
