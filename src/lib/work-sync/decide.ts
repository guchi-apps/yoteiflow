/**
 * 自動生成物ごとに「作る・更新・削除・触らない」を決める純粋関数（docs/spec.md §46）。
 *
 * 利用者が生成物を直接直したかどうかは、`updatedAt` ではなく、生成直後に控えた中身
 * （snapshot）との不一致で判定する。同期自身の更新でも updatedAt は進むため、
 * 更新日時では自分の書き込みを手動調整と取り違える。
 */

export type Snapshot = {
  /** ISO 8601 */
  start: string;
  end: string;
  title?: string;
  origin?: string;
  destination?: string;
};

export type RowState = { status: "ACTIVE" | "MANUAL"; snapshot: Snapshot };

export type Decision = "create" | "update" | "delete" | "keep" | "markManual" | "forget";

export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return (
    new Date(a.start).getTime() === new Date(b.start).getTime() &&
    new Date(a.end).getTime() === new Date(b.end).getTime() &&
    (a.title ?? "") === (b.title ?? "") &&
    (a.origin ?? "") === (b.origin ?? "") &&
    (a.destination ?? "") === (b.destination ?? "")
  );
}

/**
 * @param expected 勤務記録から導いた、あるべき中身。無ければ null
 * @param row 控え。無ければ null（生成したことが無い）
 * @param current 生成物の現在の中身。消されていれば null。控えが無い・手動扱いのときは見ない
 */
export function decide(
  expected: Snapshot | null,
  row: RowState | null,
  current: Snapshot | null,
): Decision {
  if (!row) return expected ? "create" : "keep";
  // 手動扱いの生成物は、以後も更新も削除もしない。対応表の行だけ、不要になれば捨てる。
  if (row.status === "MANUAL") return expected ? "keep" : "forget";

  const untouched = current !== null && sameSnapshot(current, row.snapshot);
  if (!untouched) {
    // 利用者が直した・消した。作り直さず、削除もしない。
    return expected ? "markManual" : "forget";
  }
  if (!expected) return "delete";
  return sameSnapshot(expected, row.snapshot) ? "keep" : "update";
}
