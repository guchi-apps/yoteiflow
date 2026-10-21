/**
 * 「調べ直す」を押した移動を、Yahoo!アプリの共有で戻ってくるまで端末に覚えておく（issue #1301）。
 *
 * #1053 で移動の入力画面からYahoo!の貼り付けを外したため、Yahoo!の経路はアプリの共有
 * （共有拡張の「予定に紐づけて追加」）でしか戻ってこない。そのまま戻すと新しい移動が別に作られ、
 * 元の移動と二重になる。押した時点で元の移動と予定を覚えておき、共有で同じ予定が選ばれたら
 * 新規作成ではなく元の移動の編集として開く（紐づくタスク・持ち物の期限・通知設定を残すため）。
 *
 * サーバーに持たないのは、置き換えの判断が端末の操作の流れ（押してからYahoo!へ行って戻るまで）に
 * 閉じているため。DBに列を足すとマイグレーションが要る。30分で失効させ、別の日の共有を
 * 黙って置き換えに化けさせない。
 */

import type { TravelItem } from "@/types/calendar";

const STORAGE_KEY = "dayspan_travel_replace_pending";
export const TRAVEL_REPLACE_TTL_MS = 30 * 60 * 1000;

export type TravelReplacePending = {
  eventId: string;
  /** 押した時点の移動。編集の初期値と、保存先（PATCH の宛先）に使う。 */
  travel: TravelItem;
  expiresAt: number;
};

/** 保存した値から、まだ有効で予定が一致するものだけを返す（純粋関数・テスト用）。 */
export function matchReplacePending(
  raw: string | null,
  eventId: string,
  now: number,
): TravelReplacePending | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TravelReplacePending>;
    if (
      typeof value.eventId !== "string" ||
      typeof value.expiresAt !== "number" ||
      !value.travel ||
      typeof value.travel.id !== "string"
    ) {
      return null;
    }
    if (value.expiresAt <= now || value.eventId !== eventId) return null;
    return value as TravelReplacePending;
  } catch {
    return null;
  }
}

export function rememberReplacePending(eventId: string, travel: TravelItem, now = Date.now()): void {
  try {
    const value: TravelReplacePending = { eventId, travel, expiresAt: now + TRAVEL_REPLACE_TTL_MS };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 保存できない端末（プライベートブラウズ等）では、置き換えずに新しい移動として作られるだけ。
  }
}

/** 共有で同じ予定が選ばれたときだけ取り出し、取り出したら消す（2回目の共有は普通に作る）。 */
export function takeReplacePending(eventId: string, now = Date.now()): TravelReplacePending | null {
  try {
    const matched = matchReplacePending(localStorage.getItem(STORAGE_KEY), eventId, now);
    if (matched) localStorage.removeItem(STORAGE_KEY);
    return matched;
  } catch {
    return null;
  }
}
