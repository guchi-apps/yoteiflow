import { createECDH, createPrivateKey, type KeyObject } from "node:crypto";

/**
 * VAPID鍵の読み込み（RFC 8292。docs/notifications.md）。
 *
 * 鍵は1行のbase64urlで持つ。PEMを環境変数へ入れると改行が `\n` の文字列になり、復元し損ねた
 * ときに「鍵が途中で切れている」形の失敗になる。公開鍵はブラウザの
 * `subscribe()` へそのまま渡す65バイトの非圧縮点、秘密鍵は32バイトのdとし、どちらも1行に収める。
 *
 * 鍵の生成は `node scripts/gen-vapid-keys.mjs`。
 * このファイルは他のモジュールを読み込まない（検証を scripts/check-web-push.mjs から直接行うため）。
 */

export type VapidKeys = {
  /** ブラウザへ渡す applicationServerKey（base64url・65バイトの非圧縮点） */
  publicKey: string;
  privateKey: KeyObject;
  /** `mailto:` か `https:` のURL。送信先が連絡先として使う（RFC 8292 §2.1）。 */
  subject: string;
};

export class VapidConfigError extends Error {}

let cached: VapidKeys | null = null;

/** 設定されているか。未設定なら通知の機能ごと出さない（画面で理由を出すために使う）。 */
export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT,
  );
}

/**
 * 送信に使う鍵を返す。
 *
 * 公開鍵と秘密鍵は別々の環境変数にあるため、片方だけ入れ替わっていても値としては読める。
 * その状態では購読は作れるのに配信だけが 401 で落ち続け、原因が画面のどこにも出ない。
 * ここで秘密鍵から公開鍵を計算し直して突き合わせ、食い違っていれば読み込みの時点で断る。
 */
export function getVapidKeys(): VapidKeys {
  if (cached) return cached;

  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKeyRaw = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();

  if (!publicKey || !privateKeyRaw || !subject) {
    throw new VapidConfigError(
      "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT が設定されていません。",
    );
  }

  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    throw new VapidConfigError("VAPID_SUBJECT は mailto: か https:// で始まる必要があります。");
  }

  const point = Buffer.from(publicKey, "base64url");
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new VapidConfigError(
      "VAPID_PUBLIC_KEY は65バイトの非圧縮点（base64url）である必要があります。",
    );
  }

  const d = Buffer.from(privateKeyRaw, "base64url");
  if (d.length !== 32) {
    throw new VapidConfigError(
      "VAPID_PRIVATE_KEY は32バイト（base64url）である必要があります。公開鍵を入れていないか確認してください。",
    );
  }

  // 秘密鍵から公開鍵を計算する。JWKで x・y を渡す形だと、Nodeはその値が d と対になっているかを
  // 確かめずに受け取るため、書かれている値どうしを比べても食い違いを見つけられない。
  let derived: Buffer;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(d);
    derived = ecdh.getPublicKey();
  } catch {
    throw new VapidConfigError("VAPID_PRIVATE_KEY がP-256の秘密鍵として読めません。");
  }

  if (!derived.equals(point)) {
    throw new VapidConfigError(
      "VAPID_PUBLIC_KEY が VAPID_PRIVATE_KEY と対になっていません。鍵を作り直して両方を入れ替えてください。",
    );
  }

  const privateKey = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: derived.subarray(1, 33).toString("base64url"),
      y: derived.subarray(33, 65).toString("base64url"),
      d: d.toString("base64url"),
    },
    format: "jwk",
  });

  cached = { publicKey: point.toString("base64url"), privateKey, subject };
  return cached;
}
