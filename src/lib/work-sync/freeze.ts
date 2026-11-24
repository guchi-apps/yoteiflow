/**
 * 移動詳細の「通勤経路に登録」で、他の日の既存の移動を据え置くための判定（issue #1753）。
 *
 * 勤務同期が生成した往路・復路の控え（`WorkGenerated.snapshot.title`）の見出しは
 * `<出発> → <到着>`（生の場所名）で、よく使う電車・既定の移動時間のキーと同じ組を指す。
 */

const SEPARATOR = " → ";

export type CommutePair = { origin: string; destination: string };

/** 控えの見出しから組を取り出す。読めなければ null。 */
export function parseCommuteTitle(title: unknown): CommutePair | null {
  if (typeof title !== "string") return null;
  const parts = title.split(SEPARATOR);
  if (parts.length !== 2) return null;
  const origin = parts[0].trim();
  const destination = parts[1].trim();
  return origin && destination ? { origin, destination } : null;
}

export type FreezeCandidate = {
  id: string;
  travelPlanId: string | null;
  status: "ACTIVE" | "MANUAL";
  snapshot: unknown;
};

/** 据え置く（手動調整にする）行。登録の元の移動以外で、同じ組の、まだ自動更新される行だけ。 */
export function pickRowsToFreeze(
  rows: FreezeCandidate[],
  pair: CommutePair,
  keepTravelId: string,
): string[] {
  return rows
    .filter((row) => {
      if (row.status !== "ACTIVE" || row.travelPlanId === keepTravelId) return false;
      const snapshot = row.snapshot as { title?: unknown } | null;
      const other = parseCommuteTitle(snapshot?.title);
      return other !== null && other.origin === pair.origin && other.destination === pair.destination;
    })
    .map((row) => row.id);
}
