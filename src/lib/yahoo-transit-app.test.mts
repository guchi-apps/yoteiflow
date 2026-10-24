import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  transitConditionSummary,
  transitSearchCondition,
  yahooTransitAppLink,
} from "@/lib/yahoo-transit-app";
import type { YahooTransitPlace } from "@/lib/yahoo-transit-link";

const station: YahooTransitPlace = { name: "梅田", query: "梅田", coordinates: null };
const address: YahooTransitPlace = { name: "本社", query: "大阪府大阪市北区中之島1-1", coordinates: null };
const point: YahooTransitPlace = { name: "自宅", query: "自宅", coordinates: { lat: 34.7, lng: 135.5 } };

function params(url: string | null): URLSearchParams {
  assert.ok(url);
  assert.ok(url.startsWith("ytransit://conditions?"));
  return new URLSearchParams(url.slice("ytransit://conditions?".length));
}

describe("yahooTransitAppLink", () => {
  it("公式の変換と同じ形で日時・基準を渡し、交通機関はすべて利用にする", () => {
    const p = params(yahooTransitAppLink({ origin: station, destination: address, at: "2026-11-01T09:30", basis: "arrive" }));
    assert.equal(p.get("from"), "梅田");
    assert.equal(p.get("to"), "大阪府大阪市北区中之島1-1");
    assert.equal(p.get("prop"), "y");
    assert.equal(p.get("d"), "20261101");
    assert.equal(p.get("t"), "0930");
    assert.equal(p.get("type"), "4");
    for (const key of ["ex", "se", "al", "hb", "lb", "sr"]) assert.equal(p.get(key), "1", key);
  });

  it("出発基準は type=1", () => {
    assert.equal(params(yahooTransitAppLink({ origin: station, destination: station, at: "2026-11-01T23:50", basis: "depart" })).get("type"), "1");
  });

  it("座標は 名前,経度,緯度 の順で渡す（Web用の flatlon と逆）", () => {
    assert.equal(params(yahooTransitAppLink({ origin: point, destination: station, at: "2026-11-01T09:30", basis: "depart" })).get("from"), "自宅,135.5,34.7");
  });

  it("日時の形が違えば組み立てない", () => {
    assert.equal(yahooTransitAppLink({ origin: station, destination: station, at: "2026-11-01", basis: "depart" }), null);
  });
});

describe("transitSearchCondition", () => {
  it("基準側の日時だけあれば検索できる（反対側は不要）", () => {
    const condition = transitSearchCondition({ origin: station, destination: address, departAt: "", arriveAt: "2026-11-01T13:45", basis: "arrive" });
    assert.equal(condition.ok, true);
    if (condition.ok) assert.equal(condition.at, "2026-11-01T13:45");
  });

  it("基準側の日時が空なら、反対側があっても足りないと伝える", () => {
    const condition = transitSearchCondition({ origin: station, destination: address, departAt: "2026-11-01T13:00", arriveAt: "", basis: "arrive" });
    assert.deepEqual(condition, { ok: false, missing: ["到着日時"] });
  });

  it("足りない項目をすべて挙げる", () => {
    assert.deepEqual(transitSearchCondition({ origin: null, destination: null, departAt: "", arriveAt: "", basis: "depart" }), {
      ok: false,
      missing: ["出発地", "目的地", "出発日時"],
    });
  });
});

describe("transitConditionSummary", () => {
  it("何で探すかと曜日つきの日時を出す", () => {
    const condition = transitSearchCondition({ origin: point, destination: address, departAt: "2026-11-01T09:05", arriveAt: "", basis: "depart" });
    assert.ok(condition.ok);
    assert.equal(transitConditionSummary(condition), "自宅（地点で検索） → 大阪府大阪市北区中之島1-1（住所で検索）・11/1(日) 9:05 出発");
  });
});
