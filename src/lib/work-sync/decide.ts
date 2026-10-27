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
  /** 勤務予定の場所（issue #1319）。控えに無い旧い行は「場所なし」と同じに扱う。 */
  location?: string;
  /** 勤務予定のメモ（勤務記録のメモ・issue #1446）。控えに無い旧い行は「メモなし」と同じに扱う。 */
  description?: string;
  origin?: string;
  destination?: string;
  /** 移動の交通手段（issue #1453）。控えに無い旧い行は PUBLIC_TRANSIT（日別指定導入前の固定値）と同じに扱う。 */
  mode?: string;
};

export type RowState = { status: "ACTIVE" | "MANUAL"; snapshot: Snapshot };

export type Decision = "create" | "update" | "delete" | "keep" | "markManual" | "forget";

export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return (
    new Date(a.start).getTime() === new Date(b.start).getTime() &&
    new Date(a.end).getTime() === new Date(b.end).getTime() &&
    (a.title ?? "") === (b.title ?? "") &&
    (a.location ?? "") === (b.location ?? "") &&
    (a.description ?? "") === (b.description ?? "") &&
    (a.origin ?? "") === (b.origin ?? "") &&
    (a.destination ?? "") === (b.destination ?? "") &&
    (a.mode ?? "") === (b.mode ?? "")
  );
}

/**
 * 場所DBを読めなかった回の勤務予定の期待値（issue #1319）。場所は控えの値のまま保つ。
 * 名前だけの場所で住所付きの予定を更新すると、復旧後にもう一度更新が走り Google への
 * 書き込みが無駄に増えるため。控えが無い（新規）ときは期待値のまま。
 */
export function keepSnapshotLocation(expected: Snapshot, row: Snapshot | null): Snapshot {
  return row ? { ...expected, location: row.location ?? "" } : expected;
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

  // メモ導入前の控えは説明を持たない。そのとき Google 側の説明は利用者の手書きかもしれないが、
  // 手動調整とは見なさない（見なすと既存の勤務予定がすべて手動扱いになる）。
  const recorded =
    row.snapshot.description === undefined && current
      ? { ...row.snapshot, description: current.description ?? "" }
      : row.snapshot;
  // 交通手段導入前の移動の控えは、日別指定の無かった頃の固定値（PUBLIC_TRANSIT）として扱う。
  const legacyMode = (snap: Snapshot): Snapshot =>
    expected?.mode !== undefined && snap.mode === undefined
      ? { ...snap, mode: "PUBLIC_TRANSIT" }
      : snap;
  const recordedWithMode = legacyMode(recorded);
  const untouched = current !== null && sameSnapshot(current, recordedWithMode);
  if (!untouched) {
    // 利用者が直した・消した。作り直さず、削除もしない。
    return expected ? "markManual" : "forget";
  }
  if (!expected) return "delete";
  return sameSnapshot(expected, recordedWithMode) ? "keep" : "update";
}
