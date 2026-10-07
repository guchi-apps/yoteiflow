/**
 * オフライン中にためる書き込み操作（issue #1135）。
 *
 * 活動記録のキュー（`activity-queue`・issue #974）とは別に持つ。ここに入れるのは「状態を指定する」
 * 冪等な操作だけで、新規作成・繰り返しタスクの完了（次回分を作る）・予定の変更は対象外。
 * 純粋な関数だけを置き、保存（store.ts）・送信（flush.ts）と分けて回帰テストできるようにする。
 */

type Base = { id: string; queuedAt: string; heldReason?: string };

export type WriteOp = Base &
  (
    | { kind: "shoppingBought"; itemId: string; bought: boolean }
    | { kind: "taskDone"; taskId: string; done: boolean }
    /**
     * 勤務の今日の1押し。持つのは意図だけ（日付と場所。null はその日の記録を取り消す）。
     * 送信時にその日の記録を引き直してから DELETE / PATCH / POST を選ぶ。オフライン中の
     * 一覧は古いことがあり、新規に作った記録にはIDも無いため。
     */
    | { kind: "workToday"; date: string; place: string | null; businessTrip?: boolean }
  );

/** 同じ対象への操作かを決める鍵。同じ鍵の操作は後に積んだものだけを残す。 */
export function opKey(op: WriteOp): string {
  switch (op.kind) {
    case "shoppingBought":
      return `shoppingBought:${op.itemId}`;
    case "taskDone":
      return `taskDone:${op.taskId}`;
    case "workToday":
      return `workToday:${op.date}`;
  }
}

/**
 * 操作を積む。同じ対象の古い操作は捨てる（どれも「その状態にする」操作で、最後の指定が結果になる）。
 * 保留中だった同じ対象の操作も、新しい指定で置き換わる。
 */
export function enqueue(ops: WriteOp[], op: WriteOp): WriteOp[] {
  const key = opKey(op);
  return [...ops.filter((o) => opKey(o) !== key), op];
}

export type SendOutcome =
  | { type: "done" }
  /** 通信不達・401・5xx。残して次の機会に再試行する。 */
  | { type: "retry"; authRequired?: boolean }
  /** 自動では解決できない。理由を出して利用者の判断を待つ。 */
  | { type: "hold"; message: string };

/**
 * 応答から次の動きを決める。404 は対象が他の端末で消えたことなので完了扱いにする。
 * それ以外の4xx（重なり・検証エラー）は握りつぶさず保留にし、サーバーの理由をそのまま出す。
 */
export function classifyWriteResponse(
  status: number,
  body: { message?: string; error?: string } | null,
): SendOutcome {
  if (status >= 200 && status < 300) return { type: "done" };
  if (status === 404) return { type: "done" };
  if (status === 401) return { type: "retry", authRequired: true };
  if (status >= 500) return { type: "retry" };
  return { type: "hold", message: body?.message ?? body?.error ?? "同期できませんでした。" };
}

/** 先頭から送れる操作。保留中の操作があればそこで止まる（順序を守る）。 */
export function nextSendable(ops: WriteOp[]): WriteOp | null {
  const head = ops[0];
  if (!head || head.heldReason) return null;
  return head;
}

/** 表示中の購入済みへ、まだ届いていない操作を重ねる。 */
export function applyBoughtOps<T extends { id: string; bought: boolean }>(
  items: T[],
  ops: WriteOp[],
): T[] {
  const map = new Map<string, boolean>();
  for (const op of ops) if (op.kind === "shoppingBought") map.set(op.itemId, op.bought);
  if (map.size === 0) return items;
  return items.map((item) => (map.has(item.id) ? { ...item, bought: map.get(item.id)! } : item));
}

/** 表示中のタスクの完了へ、まだ届いていない操作を重ねる。完了にしたものは「対応しない」を外す。 */
export function applyTaskOps<T extends { id: string; done: boolean; skipped?: boolean }>(
  tasks: T[],
  ops: WriteOp[],
): T[] {
  const map = new Map<string, boolean>();
  for (const op of ops) if (op.kind === "taskDone") map.set(op.taskId, op.done);
  if (map.size === 0) return tasks;
  return tasks.map((task) =>
    map.has(task.id) ? { ...task, done: map.get(task.id)!, skipped: false } : task,
  );
}

/** 勤務の送信時の分岐。その日の記録（あれば）と意図から、次にする書き込みを決める。 */
export type WorkPlan =
  | { action: "none" }
  | { action: "delete"; id: string }
  | { action: "patch"; id: string }
  | { action: "post" };

export function planWorkToday(
  existing: { id: string; place: string | null; annualLeave?: unknown; companyHoliday?: unknown } | null,
  place: string | null,
): WorkPlan {
  // 年休・休みは場所と無関係に決まった記録で、チップでは触らない（画面と同じ規則）。
  if (existing && (existing.annualLeave || existing.companyHoliday)) return { action: "none" };

  if (place === null) return existing ? { action: "delete", id: existing.id } : { action: "none" };
  if (!existing) return { action: "post" };
  // 1回目が実は届いていた再送。同じ場所ならそのまま完了にする。
  if (existing.place === place) return { action: "none" };
  return { action: "patch", id: existing.id };
}
