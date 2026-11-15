import assert from "node:assert/strict";
import test from "node:test";

import { allDayNotifyBase } from "@/lib/all-day-notify";

test("allDayNotifyBase: 日本時間の9:00（UTCの0:00）", () => {
  assert.equal(allDayNotifyBase("2026-11-14", "Asia/Tokyo").toISOString(), "2026-11-14T00:00:00.000Z");
});

test("allDayNotifyBase: 設定タイムゾーンに従う", () => {
  assert.equal(allDayNotifyBase("2026-11-14", "UTC").toISOString(), "2026-11-14T09:00:00.000Z");
});
