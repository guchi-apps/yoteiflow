import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { listShoppingItems, shoppingDatabaseReady } from "@/services/notion/shopping-items";
import { readWidgetCache, type WidgetFetchOptions, writeWidgetCache } from "@/services/widget/cache";
import { sortShoppingItems, type ShoppingItem } from "@/types/shopping";
import type { WidgetShoppingPayload } from "@/types/widget";

/** 返す最大件数。ネイティブ版が枠の高さに入るだけ並べるための上限で、残りは件数にだけ含める（#969）。 */
const MAX_ITEMS = 30;

/**
 * iPhoneウィジェットの「買い物リスト」（docs/spec.md §28・§36）。
 *
 * 出すのは未購入のものだけ。買い物中に見るのは残っているもので、買ったものが混ざると
 * 残りを数えるのに読み飛ばすことになる（買い物画面が購入済みを末尾へ送っているのと同じ理由）。
 * 並びは優先度順にする。枠に入るのは数行しかなく、そこへ出すなら先に買うべきものから。
 */
export async function buildWidgetShopping(
  userId: string,
  options: WidgetFetchOptions = {},
): Promise<WidgetShoppingPayload> {
  const now = new Date();

  const uiSetting = await db.uiSetting.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";

  const source = await loadSource(userId, timeZone, createCalendarDateUtils(timeZone).todayKey(), now, options);
  if (!source.ok) {
    return {
      timeZone,
      now: now.toISOString(),
      remaining: 0,
      items: [],
      unavailable: source.unavailable,
    };
  }

  const remaining = sortShoppingItems(source.items, "priority").filter(
    (item) => !item.wishlisted && !item.bought,
  );

  return {
    timeZone,
    now: now.toISOString(),
    remaining: remaining.length,
    items: remaining.slice(0, MAX_ITEMS).map((item) => ({
      name: item.name,
      category: item.category,
      priority: item.priority,
    })),
    unavailable: null,
  };
}

type ShoppingSource =
  | { ok: true; items: ShoppingItem[] }
  | { ok: false; unavailable: WidgetShoppingPayload["unavailable"] };

async function loadSource(
  userId: string,
  timeZone: string,
  dateKey: string,
  now: Date,
  options: WidgetFetchOptions,
): Promise<ShoppingSource> {
  // 買い物リストは日付を持たないが、鍵の形は他の面と揃える。日付・タイムゾーンが変われば
  // 取り直しになるだけで、正しさは変わらない。
  const cacheKey = { userId, view: "shopping" as const, dateKey, timeZone };
  const cached = options.fresh ? null : readWidgetCache<ShoppingItem[]>(cacheKey, now);
  if (cached) return { ok: true, items: cached };

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  // データソースと項目名のプロパティが揃っていないと読めない（買い物画面と同じ判定）。
  if (!connection || !shoppingDatabaseReady(connection)) {
    return { ok: false, unavailable: "shopping_not_ready" };
  }

  let items: ShoppingItem[];
  try {
    items = await listShoppingItems(createNotionClient(connection), connection);
  } catch (error) {
    // 握りつぶさずログへ全文を残す（CLAUDE.md「外部APIの扱い」）。画面には理由を出す。
    console.error("[dayspan] widget shopping failed:", error);
    return { ok: false, unavailable: "notion_unavailable" };
  }

  writeWidgetCache(cacheKey, items, now);
  return { ok: true, items };
}
