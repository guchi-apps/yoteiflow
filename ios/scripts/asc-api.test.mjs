// asc-api.mjs の純関数のテスト（`node --test ios/scripts/*.test.mjs`）。ネットワークは使わない。

import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, it } from "node:test";

import { AscClient, createJwt, isRetryableStatus, pickApiCreatedDevCertificates, pickInternalGroup } from "./asc-api.mjs";

const g = (name, isInternalGroup) => ({ id: name, attributes: { name, isInternalGroup } });

describe("createJwt", () => {
  it("ES256の3部構成で、署名が公開鍵で検証できる", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    const jwt = createJwt({ keyId: "KID", issuerId: "ISS", privateKeyPem: pem, now: 1_000_000 });
    const [h, p, s] = jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "KID", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url"));
    assert.equal(payload.iss, "ISS");
    assert.equal(payload.aud, "appstoreconnect-v1");
    assert.equal(payload.exp - payload.iat, 600);
    assert.ok(
      verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))
    );
  });
});

describe("pickInternalGroup", () => {
  it("名前指定があれば内部グループからその名前を選ぶ（外部グループは選ばない）", () => {
    assert.equal(pickInternalGroup([g("A", false), g("A", true), g("B", true)], "A").attributes.isInternalGroup, true);
  });
  it("名前が無くても内部グループが1つなら選べる", () => {
    assert.equal(pickInternalGroup([g("外部", false), g("自分", true)], "").id, "自分");
  });
  it("内部グループが複数で名前が無いと失敗する", () => {
    assert.throws(() => pickInternalGroup([g("A", true), g("B", true)], ""), /1つに決められません/);
  });
  it("指定した名前が無いと失敗する", () => {
    assert.throws(() => pickInternalGroup([g("A", true)], "Z"), /見つかりません/);
  });
});

describe("pickApiCreatedDevCertificates", () => {
  // 実際の応答の形: name は種別の接頭辞付き、displayName が素の名前（#1010 で実応答から確認）
  const c = (id, displayName, certificateType, prefix = "Apple Development") => ({
    id,
    attributes: { name: `${prefix}: ${displayName}`, displayName, certificateType },
  });
  it("API作成のDevelopment証明書だけを選ぶ（自分用・Distributionは残す）", () => {
    const picked = pickApiCreatedDevCertificates([
      c("1", "Created via API", "DEVELOPMENT"),
      c("2", "Created via API", "IOS_DEVELOPMENT", "iOS Development"),
      c("3", "Kazuki Guchi", "DEVELOPMENT"),
      c("4", "Created via API", "DISTRIBUTION", "Apple Distribution"),
      c("5", "Created via API", "IOS_DISTRIBUTION", "iPhone Distribution"),
    ]);
    assert.deepEqual(picked.map((x) => x.id), ["1", "2"]);
  });
  it("接頭辞付きの name だけでは選ばない（displayName で判定する）", () => {
    const picked = pickApiCreatedDevCertificates([
      { id: "6", attributes: { name: "Apple Development: Created via API", certificateType: "DEVELOPMENT" } },
    ]);
    assert.deepEqual(picked, []);
  });
});

describe("isRetryableStatus", () => {
  it("5xx と 429 だけを再試行する", () => {
    for (const s of [429, 500, 502, 503, 504]) assert.equal(isRetryableStatus(s), true, String(s));
    for (const s of [200, 400, 404, 409, 422]) assert.equal(isRetryableStatus(s), false, String(s));
  });
});

describe("AscClient.request の再試行", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const env = {
    ASC_KEY_ID: "KID",
    ASC_ISSUER_ID: "ISS",
    ASC_KEY_P8: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64"),
  };
  const res = (status, body = {}) => new Response(JSON.stringify(body), { status });
  const make = (responses) => {
    const calls = [];
    const slept = [];
    const client = new AscClient(env, {
      fetchImpl: async (url, init) => {
        calls.push(init.method);
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
      },
      sleepImpl: async (ms) => slept.push(ms),
      retryDelaysMs: [1, 2],
      log: () => {},
    });
    return { client, calls, slept };
  };

  it("GET の HTTP 500 は待って再試行し、成功すればその応答を返す（#1334）", async () => {
    const { client, calls, slept } = make([res(500), res(200, { data: [1] })]);
    assert.deepEqual(await client.request("GET", "/v1/builds"), { data: [1] });
    assert.equal(calls.length, 2);
    assert.deepEqual(slept, [1]);
  });
  it("GET の通信エラーも再試行する", async () => {
    const { client, calls } = make([new TypeError("fetch failed"), res(200, { ok: true })]);
    assert.deepEqual(await client.request("GET", "/v1/apps"), { ok: true });
    assert.equal(calls.length, 2);
  });
  it("再試行しきっても 5xx なら失敗する", async () => {
    const { client, calls } = make([res(503), res(503), res(503)]);
    await assert.rejects(client.request("GET", "/v1/builds"), /HTTP 503/);
    assert.equal(calls.length, 3);
  });
  it("4xx は再試行しない", async () => {
    const { client, calls } = make([res(404)]);
    await assert.rejects(client.request("GET", "/v1/builds"), /HTTP 404/);
    assert.equal(calls.length, 1);
  });
  it("認証の失敗は再試行しない", async () => {
    const { client, calls } = make([res(401)]);
    await assert.rejects(client.request("GET", "/v1/builds"), /認証に失敗/);
    assert.equal(calls.length, 1);
  });
  it("POST・DELETE は 5xx でも再試行しない", async () => {
    for (const method of ["POST", "DELETE"]) {
      const { client, calls } = make([res(500)]);
      await assert.rejects(client.request(method, "/v1/x", {}), /HTTP 500/);
      assert.equal(calls.length, 1);
    }
  });
});
