import type { WidgetView } from "@/types/widget";

/**
 * ウィジェットの面ごとの取得結果を、プロセス内で短時間だけ持ち回す（docs/spec.md §28）。
 *
 * ウィジェットは更新のたびに外部APIへ問い合わせる。同じ面をホーム画面とロック画面の両方に
 * 置くと、同じものを見るために枠の数だけ往復が増える。iOSは同じアプリのウィジェットを
 * まとめて更新するため、そのぶんが1回で済むようにする（docs/spec.md §20
 * 「過剰なアクセスを発生させない」）。
 *
 * 活動記録は先に `services/activity/today-cache.ts` が同じことをしている。あちらは保存先
 * カレンダーまで鍵に含み、記録を止めた時点で捨てる作りのため、そのまま残す。
 *
 * 持ち回すのは**取得したもの**だけで、そこから作る値（今日の合計・済んだ予定かどうか・
 * 期限の言葉）は毎回その時点の時刻で組み立て直す。組み立てた後の値を持つと、記録中のぶんが
 * 伸びても合計だけが止まる、といった食い違いが起きる。
 *
 * 本番はPM2の `instances: 1` / `exec_mode: "fork"`（deploy/ecosystem.config.js）で1プロセス。
 * 増やしたときもプロセスごとに持つだけで、正しさは変わらない（往復が減りにくくなるだけ）。
 */

/**
 * 持ち回す時間。
 *
 * 台本が要求する更新間隔（`WIDGET_REFRESH_MINUTES` = 5分）より短くしてある。同じ枠の次の更新は
 * 必ず取り直しになり、まとめて走った他の枠のぶんだけが1回に収まる。
 *
 * 引き換えに、DaySpanの画面で買い物にチェックを付けた直後にウィジェットを見ると、最大この
 * 時間だけ前の状態が出る。書き込みの経路すべてに破棄の呼び出しを足すことはしない。
 */
const TTL_MS = 3 * 60_000;

/**
 * 何を取ったかを決める条件。
 *
 * 日付とタイムゾーンまで鍵に入れる。取ってあるのは「その日」を切り出したあとのもので、
 * 00:00 をまたいだ直後に前日ぶんを使い回すと、最大3分のあいだ前日の予定と前日基準の
 * 期限の言葉が「今日」として出る（today-cache.ts が鍵に日付を入れているのと同じ理由）。
 */
export type WidgetCacheKey = {
  userId: string;
  view: WidgetView;
  /** 設定タイムゾーンでの今日（YYYY-MM-DD）。 */
  dateKey: string;
  timeZone: string;
};

/**
 * 取得の指定。`fresh` はiOSアプリが求めた取り直し（`lib/widget-fresh.ts`）で、持ち回しを読まずに
 * 取り直す。取り直した結果は書き込むので、同じ回にまとめて走る他の枠はそれを使い回せる。
 */
export type WidgetFetchOptions = { fresh?: boolean };

type CacheEntry = { value: unknown; fetchedAt: number };

const cache = new Map<string, CacheEntry>();

/** まだ使える取得結果。無ければ null。 */
export function readWidgetCache<T>(key: WidgetCacheKey, now: Date): T | null {
  const id = cacheKey(key);
  const entry = cache.get(id);
  if (!entry) return null;

  if (now.getTime() - entry.fetchedAt >= TTL_MS) {
    cache.delete(id);
    return null;
  }

  return entry.value as T;
}

export function writeWidgetCache<T>(key: WidgetCacheKey, value: T, now: Date): void {
  expire(now);
  cache.set(cacheKey(key), { value, fetchedAt: now.getTime() });
}

function cacheKey(key: WidgetCacheKey): string {
  // 改行で繋ぐ。ユーザーID・面の名前・日付・タイムゾーンのいずれにも改行は入らない。
  return `${key.userId}\n${key.view}\n${key.timeZone}\n${key.dateKey}`;
}

/**
 * 使えなくなった行を落とす。日付が変わるとその日の鍵は二度と引かれず、
 * 放っておくとプロセスの間ずっと残る。
 */
function expire(now: Date): void {
  for (const [id, entry] of cache) {
    if (now.getTime() - entry.fetchedAt >= TTL_MS) cache.delete(id);
  }
}
