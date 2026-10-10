import assert from "node:assert/strict";
import test from "node:test";

import { resolveSharedImport } from "@/lib/share-import/resolve";
import { yahooFare } from "@/lib/share-import/yahoo";
import { parseSharedTravelBody } from "@/lib/share-import/travel-body";

/** 経路ページの取得は実通信しない（既存のAI経路のテスト用） */
const noDirections = async () => ({ ok: false as const, reason: "unreadable" as const });

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
      directions: noDirections,
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
      directions: noDirections,
      analyze: async () => ({ origin: "A", destination: "B", mode: "CAR", minutes: 30 }),
    },
  );
  assert.ok(result.ok);
  assert.equal(result.item.registrable, true);
  // !8j は現地の壁時計: 08:45（Asia/Tokyo）＋30分（9時間ずれない・issue #1160）
  assert.equal(result.item.startAt, "2026-10-03T23:45:00.000Z");
  assert.equal(result.item.endAt, "2026-10-04T00:15:00.000Z");
});

test("AI未設定・失敗でも読めた経路を残し、所要時間は未取得として移動の入力へ引き継ぐ", async () => {
  for (const analyze of [async () => null, async () => { throw new Error("boom"); }]) {
    const result = await resolveSharedImport({ url: "https://www.google.com/maps/dir/A/B/data=!3e3" }, "Asia/Tokyo", {
      expand: async (value, parse) => ({ result: parse(value)!, url: value }),
      directions: noDirections,
      analyze,
    });
    assert.ok(result.ok);
    assert.equal(result.item.type, "route");
    assert.equal(result.item.origin, "A");
    assert.equal(result.item.destination, "B");
    assert.equal(result.item.mode, "PUBLIC_TRANSIT");
    assert.equal(result.item.durationMinutes, null);
    assert.equal(result.item.estimated, false);
    assert.equal(result.item.registrable, false);
    assert.match(result.item.notice ?? "", /日時・所要時間/);
  }
});

test("空の共有は422", async () => {
  const empty = await resolveSharedImport({ text: "  " }, "Asia/Tokyo");
  assert.ok(!empty.ok && empty.status === 422);
});

test("短縮URLが saddr・daddr 形式へ展開される経路共有を移動として読み、元の共有URLを残す（issue #1142）", async () => {
  const shortUrl = "https://maps.app.goo.gl/AbCdEf123?g_st=ic";
  const expanded = "https://maps.google.com/?daddr=%E6%9D%B1%E4%BA%AC%E9%83%BD%E5%8D%83%E4%BB%A3%E7%94%B0%E5%8C%BA&saddr=35.6812360,139.7671250&dirflg=d&g_st=ic";
  const result = await resolveSharedImport({ url: shortUrl }, "Asia/Tokyo", {
    directions: noDirections,
    expand: async (value, parse) => {
      assert.equal(parse(value), null);
      const parsed = parse(expanded);
      return parsed ? { result: parsed, url: expanded } : null;
    },
    analyze: async () => ({ origin: "x", destination: "y", mode: "WALK", minutes: 25 }),
  });
  assert.ok(result.ok);
  assert.equal(result.item.type, "route");
  // 発着地・移動手段はURLの値を使い、AIの返した値で置き換えない
  assert.equal(result.item.origin, "35.6812360,139.7671250");
  assert.equal(result.item.destination, "東京都千代田区");
  assert.equal(result.item.mode, "CAR");
  assert.equal(result.item.durationMinutes, 25);
  assert.equal(result.item.estimated, true);
  assert.equal(result.item.registrable, false);
  assert.equal(result.item.sourceUrl, shortUrl);
});

test("出発地の無い経路は場所として誤登録せず、読み取り失敗として案内する", async () => {
  const result = await resolveSharedImport({ url: "https://maps.google.com/?daddr=B&q=35.6,139.7&dirflg=d" }, "Asia/Tokyo", {
    directions: noDirections,
    expand: async (value, parse) => {
      const parsed = parse(value);
      return parsed ? { result: parsed, url: value } : null;
    },
    analyze: async () => assert.fail("経路が読めないときはAIを呼ばない"),
  });
  assert.ok(!result.ok);
  assert.equal(result.error, "incomplete_route");
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
