/**
 * 既存の予定と移動を後から結ぶ入力の検証（issue #1105）。
 *
 * DBを読み込まない純粋な関数に閉じているのは、`node --test` で単体に確かめるため。
 * 画面でも同じ検証をしているが、DaySpanのAPIや将来のMCPから直接呼ばれた要求は画面を通らない。
 */
export type TravelLinkInput = {
  calendarId: string;
  eventId: string;
  /** 復路として結ぶか。往路・復路は予定の前後どちらの移動かを示す。 */
  returnLeg: boolean;
};

export function parseTravelLinkInput(
  body: Partial<Record<keyof TravelLinkInput, unknown>> | null | undefined,
): { ok: true; value: TravelLinkInput } | { ok: false; message: string } {
  const calendarId = typeof body?.calendarId === "string" ? body.calendarId.trim() : "";
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  if (!calendarId || !eventId) return { ok: false, message: "紐づける予定を指定してください。" };
  if (typeof body?.returnLeg !== "boolean") {
    return { ok: false, message: "往路か復路かを指定してください。" };
  }
  return { ok: true, value: { calendarId, eventId, returnLeg: body.returnLeg } };
}

/**
 * 往路か復路かの既定。予定の開始より前に着く移動は往路、後に出る移動は復路。
 * どちらでもない（予定の最中にまたがる）ときは、出発が予定の開始より前なら往路にする。
 */
export function defaultReturnLeg(
  travel: { start: string; end: string },
  event: { start: string; end: string },
): boolean {
  const departs = new Date(travel.start).getTime();
  const arrives = new Date(travel.end).getTime();
  const eventStart = new Date(event.start).getTime();
  const eventEnd = new Date(event.end).getTime();
  if (arrives <= eventStart) return false;
  if (departs >= eventEnd) return true;
  return departs >= eventStart;
}
