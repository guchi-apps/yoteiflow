/**
 * 勤務の自動生成で「枠を先に確保してから外部（Google・移動）へ書く」ための手順（issue #1180）。
 *
 * 先にGoogleへ書くと、同じ記録の同期が重なったとき両方が予定を作り、負けた側の予定は
 * どの控え（WorkGenerated）にも紐づかず残る。一意制約で枠を確保した側だけが外部へ書く。
 * DBとの境界は `ReserveStore` で差し込み、並行実行を `reserve.test.mts` で確かめる。
 */

export type ReserveStore<Row extends { id: string }> = {
  /** 枠を確保する。一意制約に負けたら null（例外にしない）。 */
  reserve(): Promise<Row | null>;
  /** 確保した行を消す（外部への書き込みが失敗したとき）。 */
  release(id: string): Promise<void>;
};

export type ReserveOutcome = "created" | "lost";

/**
 * 枠を確保できたときだけ `write` を実行する。
 * `write` が失敗したら確保を解いて例外を投げる（次の同期でやり直せる）。
 * 書き戻し（attach）が失敗したら、作ってしまった外部の物を `rollback` で片付けてから確保を解く。
 */
export async function createWithReservation<Row extends { id: string }, Created>(
  store: ReserveStore<Row>,
  write: () => Promise<Created>,
  attachCreated: (rowId: string, created: Created) => Promise<void>,
  rollback: (created: Created) => Promise<void>,
): Promise<ReserveOutcome> {
  const row = await store.reserve();
  if (!row) return "lost";

  let created: Created;
  try {
    created = await write();
  } catch (error) {
    await store.release(row.id).catch(() => undefined);
    throw error;
  }

  try {
    await attachCreated(row.id, created);
  } catch (error) {
    await rollback(created).catch(() => undefined);
    await store.release(row.id).catch(() => undefined);
    throw error;
  }
  return "created";
}

/** 確保したまま外部IDが入っていない行が、この時間を過ぎたら異常終了の残骸とみなす。 */
export const STALE_RESERVATION_MS = 2 * 60 * 1000;

export function isReservation(row: {
  status: string;
  googleEventId: string | null;
  travelPlanId: string | null;
}): boolean {
  return row.status === "ACTIVE" && !row.googleEventId && !row.travelPlanId;
}
