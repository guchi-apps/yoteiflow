/** 同期結果（`WorkSyncResult`）の画面向けの要約。何も知らせる必要が無ければ null。 */
export type SyncSummary = {
  status?: string;
  errors?: string[];
  missingRoutes?: Array<{ origin: string | null; destination: string }>;
} | null | undefined;

export function describeSync(sync: SyncSummary): string | null {
  if (!sync || sync.status === "disabled") return null;
  const parts: string[] = [];
  const missing = sync.missingRoutes ?? [];
  if (missing.some((route) => route.origin === null)) {
    parts.push("移動を作るには、設定の「移動」で既定の出発地を入れてください。");
  }
  const places = [
    ...new Set(missing.filter((route) => route.origin !== null).map((route) => route.destination)),
  ];
  if (places.length > 0) {
    parts.push(
      `${places.join("・")}への既定の移動時間が未設定のため、移動は作っていません。設定の「勤務」で設定できます。`,
    );
  }
  if (sync.errors && sync.errors.length > 0) {
    parts.push(`勤務予定・移動の反映に失敗しました（${sync.errors[0]}）。`);
  }
  return parts.length > 0 ? parts.join("") : null;
}
