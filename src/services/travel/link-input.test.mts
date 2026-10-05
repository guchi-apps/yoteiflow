import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultReturnLeg, parseTravelLinkInput } from "@/services/travel/link-input";

describe("parseTravelLinkInput", () => {
  it("予定IDと往復の別が揃っていれば受ける", () => {
    const result = parseTravelLinkInput({ calendarId: " c ", eventId: "e", returnLeg: true });
    assert.deepEqual(result, { ok: true, value: { calendarId: "c", eventId: "e", returnLeg: true } });
  });

  it("予定が欠けていれば断る", () => {
    assert.equal(parseTravelLinkInput({ calendarId: "", eventId: "e", returnLeg: false }).ok, false);
    assert.equal(parseTravelLinkInput(null).ok, false);
  });

  it("returnLegが真偽値でなければ断る", () => {
    assert.equal(parseTravelLinkInput({ calendarId: "c", eventId: "e", returnLeg: "yes" }).ok, false);
  });
});

describe("defaultReturnLeg", () => {
  const event = { start: "2026-10-05T10:00:00Z", end: "2026-10-05T11:00:00Z" };

  it("予定の前に着く移動は往路", () => {
    assert.equal(defaultReturnLeg({ start: "2026-10-05T09:00:00Z", end: "2026-10-05T10:00:00Z" }, event), false);
  });

  it("予定の後に出る移動は復路", () => {
    assert.equal(defaultReturnLeg({ start: "2026-10-05T11:00:00Z", end: "2026-10-05T12:00:00Z" }, event), true);
  });
});
