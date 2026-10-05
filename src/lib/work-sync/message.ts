/** 同期結果（`WorkSyncResult`）の画面向けの要約。何も知らせる必要が無ければ null。 */
export type SyncSummary = {
  status?: string;
  errors?: string[];
  /** 手で調整済みとして触らなかった数。 */
  manual?: number;
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
    // 勤務記録の保存は成功している。カレンダーへの反映だけが失敗したことを分けて伝える。
    parts.push(
      `勤務記録は保存しましたが、勤務予定・移動の反映に失敗しました（${sync.errors[0]}）。保存し直すか、勤務画面の「再計算」で再試行できます。`,
    );
  }
  if (sync.manual && sync.manual > 0) {
    parts.push(
      `手で調整した予定・移動 ${sync.manual}件は、自動では変更していません。必要ならカレンダー側で直してください。`,
    );
  }
  return parts.length > 0 ? parts.join("") : null;
}
