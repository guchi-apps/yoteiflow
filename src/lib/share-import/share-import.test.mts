import assert from "node:assert/strict";
import test from "node:test";

import { resolveSharedImport } from "@/lib/share-import/resolve";
import { yahooFare } from "@/lib/share-import/yahoo";
import { parseSharedTravelBody } from "@/lib/share-import/travel-body";

const placeUrl = "https://www.google.com/maps/place/Tower/@34.1,135.1,17z/data=!3d34.1!4d135.1";

test("Googleマップの場所はテキスト中のURLからも判別し、直接登録対象にしない", async () => {
  const result = await resolveSharedImport({ text: `Tower\n${placeUrl}` }, "Asia/Tokyo", {
    expand: async (value, parse) => {
      const parsed = parse(value);
      return parsed ? { result: parsed, url: value } : null;
    },
  });
  assert.ok(result.ok);
  assert.equal(result.item.type, "place");
  assert.equal(result.item.title, "Tower");
  assert.equal(result.item.registrable, false);
});

test("Googleマップ経路は日時が無ければ直接登録できず、AI解析は1回", async () => {
  let calls = 0;
  const result = await resolveSharedImport(
    { url: "https://www.google.com/maps/dir/A駅/B駅/data=!3e3" },
    "Asia/Tokyo",
    {
      expand: async (value, parse) => ({ result: parse(value)!, url: value }),
      analyze: async () => {
        calls += 1;
        return { origin: "A駅", destination: "B駅", mode: "WALK", minutes: 12 };
      },
    },
  );
  assert.ok(result.ok);
  assert.equal(calls, 1);
  assert.equal(result.item.registrable, false);
  assert.equal(result.item.estimated, true);
  assert.equal(result.item.durationMinutes, 12);
});

test("出発日時があれば到着を作って登録可能にする", async () => {
  const result = await resolveSharedImport(
    { url: "https://www.google.com/maps/dir/A/B/data=!8j1791103500!3e0" },
    "Asia/Tokyo",
    {
      expand: async (value, parse) => ({ result: parse(value)!, url: value }),
      analyze: async () => ({ origin: "A", destination: "B", mode: "CAR", minutes: 30 }),
    },
  );
  assert.ok(result.ok);
  assert.equal(result.item.registrable, true);
  assert.equal(result.item.endAt, "2026-10-04T09:15:00.000Z");
});

test("AI未設定は503、空の共有は422", async () => {
  const noAi = await resolveSharedImport({ url: "https://www.google.com/maps/dir/A/B" }, "Asia/Tokyo", {
    expand: async (value, parse) => ({ result: parse(value)!, url: value }),
    analyze: async () => null,
  });
  assert.ok(!noAi.ok && noAi.status === 503);
  const empty = await resolveSharedImport({ text: "  " }, "Asia/Tokyo");
  assert.ok(!empty.ok && empty.status === 422);
});

test("運賃を拾う・拾えなければnull", () => {
  assert.equal(yahooFare("運賃 1,240円\n距離"), 1240);
  assert.equal(yahooFare("所要時間 23分"), null);
});

test("登録本文の検証", () => {
  const ok = { origin: "A", destination: "B", mode: "CAR", departAt: "2026-10-04T08:00:00Z", arriveAt: "2026-10-04T09:00:00Z" };
  assert.ok(parseSharedTravelBody(ok));
  assert.equal(parseSharedTravelBody({ ...ok, arriveAt: ok.departAt }), null);
  assert.equal(parseSharedTravelBody({ ...ok, mode: "ROCKET" }), null);
  assert.equal(parseSharedTravelBody({ ...ok, origin: "" }), null);
});
