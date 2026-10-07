/**
 * iOSアプリ（WKWebView）が睡眠をHealthKitへ書くためのブリッジ（issue #976・docs/spec.md §40）。
 *
 * HealthKitはアプリ（Swift）からしか書けない。画面はここを通してアプリへ頼み、アプリは
 * `/api/sleep/health` を取得→HealthKitへ書き込み→確定の順に進めて結果を返す。
 */

import { NATIVE_HEALTH_BRIDGE } from "@/lib/native-auth/native-app";
import { parseSleepFocusStatus, type SleepFocusStatus } from "@/lib/sleep-focus-status";

export type NativeHealthPermission = "unavailable" | "notDetermined" | "denied" | "granted";

export type NativeHealthRange = { start: string; end: string };

export type NativeHealthSyncResult = {
  permission: NativeHealthPermission;
  /** HealthKitへ書いた睡眠の件数。 */
  sent: number;
  /** 送った古い時間帯のうち、アプリが消せた件数。 */
  removed: number;
  /** アプリが消せなかった古い時間帯（ショートカットで送った分など）。利用者に消してもらう。 */
  staleLeft: NativeHealthRange[];
  /** 失敗の理由（アプリ・サーバーが返した日本語の文）。 */
  error: string | null;
};

type Bridge = { postMessage: (message: unknown) => Promise<unknown> };

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const handlers = (window as unknown as { webkit?: { messageHandlers?: Record<string, Bridge> } })
    .webkit?.messageHandlers;
  return handlers?.[NATIVE_HEALTH_BRIDGE] ?? null;
}

/** アプリが睡眠のHealthKit連携を持っているか。古いビルドのアプリでは false（ハンドラが無い）。 */
export function hasNativeHealth(): boolean {
  return bridge() !== null;
}

function isRange(value: unknown): value is NativeHealthRange {
  const record = value as Record<string, unknown> | null;
  return (
    typeof record === "object" &&
    record !== null &&
    typeof record.start === "string" &&
    typeof record.end === "string"
  );
}

/** アプリからの返事を画面が扱える形へ寄せる。想定外の形は「何も送れていない」として扱う。 */
export function parseNativeHealthResult(value: unknown): NativeHealthSyncResult {
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const permission =
    record.permission === "unavailable" ||
    record.permission === "denied" ||
    record.permission === "granted"
      ? record.permission
      : "notDetermined";
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

  return {
    permission,
    sent: count(record.sent),
    removed: count(record.removed),
    staleLeft: Array.isArray(record.staleLeft) ? record.staleLeft.filter(isRange) : [],
    error: typeof record.error === "string" ? record.error : null,
  };
}

/** 結果を画面に出す一文にする。 */
export function nativeHealthSummary(result: NativeHealthSyncResult, title: string): string {
  if (result.error) return result.error;
  if (result.permission === "unavailable") return "この端末ではヘルスケアを使えません。";
  if (result.permission === "denied") {
    return "ヘルスケアへの書き込みが許可されていません。iPhoneの「設定 > ヘルスケア > データアクセスとデバイス」から許可してください。";
  }

  const parts: string[] = [];
  if (result.sent > 0) parts.push(`${title}を${result.sent}件ヘルスケアへ送りました。`);
  if (result.removed > 0) parts.push(`送ったあとに直した古い時間帯を${result.removed}件消しました。`);
  return parts.length > 0 ? parts.join("") : `ヘルスケアへ送る${title}はありません。`;
}

/** 睡眠をヘルスケアへ送る（書き込みの許可は初回にアプリが求める）。 */
export async function syncNativeHealth(): Promise<NativeHealthSyncResult> {
  const target = bridge();
  if (!target) throw new Error("アプリのヘルスケア連携を呼べませんでした。アプリを最新にしてください。");
  return parseNativeHealthResult(await target.postMessage({ action: "sync" }));
}

export type NativeHealthStatus = {
  /** 睡眠のヘルスケアへの書き込み許可。 */
  permission: NativeHealthPermission;
  /** 読み取り（取り込み）の許可を求め済みか。Appleは読み取りの許可/拒否を返さない。 */
  importPermission: "unavailable" | "notDetermined" | "requested";
};

/** アプリからヘルスケアの許可の状態を読む（画面が開いたときに使う。許可の確認画面は出ない）。 */
export async function statusNativeHealth(): Promise<NativeHealthStatus> {
  const target = bridge();
  if (!target) throw new Error("アプリのヘルスケア連携を呼べませんでした。アプリを最新にしてください。");

  const value = (await target.postMessage({ action: "status" })) as Record<string, unknown> | null;
  const record = value ?? {};
  const permission = parseNativeHealthResult({ permission: record.permission }).permission;
  const importPermission =
    record.importPermission === "unavailable" || record.importPermission === "requested"
      ? record.importPermission
      : "notDetermined";

  return { permission, importPermission };
}

export type NativeHealthImportResult = {
  importPermission: NativeHealthStatus["importPermission"];
  /** 睡眠の活動記録として新しく作った件数。 */
  imported: number;
  /** すでに同じ時間帯の睡眠があった等で作らなかった件数。 */
  skipped: number;
  error: string | null;
};

/** ヘルスケアの睡眠分析を読み、睡眠の活動記録として取り込む（読み取りの許可は初回にアプリが求める）。 */
export async function importNativeHealth(): Promise<NativeHealthImportResult> {
  const target = bridge();
  if (!target) throw new Error("アプリのヘルスケア連携を呼べませんでした。アプリを最新にしてください。");

  const value = (await target.postMessage({ action: "import" })) as Record<string, unknown> | null;
  const record = value ?? {};
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

  return {
    importPermission:
      record.permission === "unavailable" ? "unavailable" : record.permission === "requested" ? "requested" : "notDetermined",
    imported: count(record.imported),
    skipped: count(record.skipped),
    error: typeof record.error === "string" ? record.error : null,
  };
}

/** 取り込みの結果を画面に出す一文にする。 */
export function nativeHealthImportSummary(result: NativeHealthImportResult, title: string): string {
  if (result.error) return result.error;
  if (result.importPermission === "unavailable") return "この端末ではヘルスケアを使えません。";
  if (result.imported > 0) return `ヘルスケアから${title}を${result.imported}件取り込みました。`;
  return `取り込む新しい${title}はありません。`;
}

/** 睡眠モード連動の最後の呼び出しと認証情報の準備状態を、アプリから読む（トークンは含まれない）。 */
export async function statusSleepFocus(): Promise<SleepFocusStatus> {
  const target = bridge();
  if (!target) throw new Error("アプリの睡眠モード連動を呼べませんでした。アプリを最新にしてください。");
  return parseSleepFocusStatus(await target.postMessage({ action: "sleepFocus" }));
}
