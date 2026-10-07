import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseTravelLinkInput } from "@/services/travel/link-input";

describe("parseTravelLinkInput", () => {
  it("予定IDを前後の空白を除いて受け取る", () => {
    const result = parseTravelLinkInput({ calendarId: " c ", eventId: "e" });
    assert.deepEqual(result, { ok: true, value: { calendarId: "c", eventId: "e", event: null } });
  });

  it("予定の時刻が付いていれば取る", () => {
    const result = parseTravelLinkInput({
      calendarId: "c",
      eventId: "e",
      eventStart: "2026-10-10T10:00:00.000Z",
      eventEnd: "2026-10-10T11:00:00.000Z",
      eventAllDay: false,
    });
    assert.equal(result.ok && result.value.event?.start, "2026-10-10T10:00:00.000Z");
  });

  it("旧クライアントのreturnLegは受けて無視する", () => {
    assert.equal(parseTravelLinkInput({ calendarId: "c", eventId: "e", returnLeg: true }).ok, true);
  });

  it("カレンダーIDか予定IDが空なら断る", () => {
    assert.equal(parseTravelLinkInput({ calendarId: "", eventId: "e" }).ok, false);
    assert.equal(parseTravelLinkInput({ calendarId: "c", eventId: "" }).ok, false);
    assert.equal(parseTravelLinkInput(null).ok, false);
  });
});
