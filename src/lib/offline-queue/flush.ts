"use client";

import {
  classifyWriteResponse,
  enqueue,
  nextSendable,
  planWorkToday,
  type SendOutcome,
  type WriteOp,
} from "@/lib/offline-queue/ops";
import { readWriteQueue, setWriteSyncState, writeWriteQueue } from "@/lib/offline-queue/store";
import { isOfflineNow } from "@/components/offline/offline-state";
import { coversDate, type WorkRecordItem } from "@/types/work";

export const WRITE_SYNCED_EVENT = "dayspan:write-queue-synced";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function outcomeOf(response: Response): Promise<SendOutcome> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  return classifyWriteResponse(response.status, body);
}

/** 勤務は意図だけを持つため、その日の記録を引き直してから書き込みを選ぶ。通信の失敗は例外で返る。 */
async function sendWorkToday(op: Extract<WriteOp, { kind: "workToday" }>): Promise<SendOutcome> {
  const monthResponse = await fetch(`/api/work/month?month=${op.date.slice(0, 7)}`, {
    headers: { "X-Dayspan-Fresh": "1" },
  });
  if (!monthResponse.ok) return outcomeOf(monthResponse);

  const month = (await monthResponse.json().catch(() => null)) as { records?: WorkRecordItem[] } | null;
  if (!month?.records) return { type: "retry" };

  const existing = month.records.find((record) => coversDate(record, op.date)) ?? null;
  const plan = planWorkToday(existing, op.place);
  const trip = op.businessTrip === undefined ? {} : { businessTrip: op.businessTrip };

  switch (plan.action) {
    case "none":
      return { type: "done" };
    case "delete":
      return outcomeOf(await fetch(`/api/work/records/${plan.id}`, { method: "DELETE" }));
    case "patch":
      return outcomeOf(
        await fetch(`/api/work/records/${plan.id}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          // 1押しは「その日まるごとこの場所」なので、時間帯の内訳があれば消す（issue #1155）。
          body: JSON.stringify({ place: op.place, title: op.place, ...trip, segments: [] }),
        }),
      );
    case "post":
      // 引き直した直後に他の端末が先に作ったときは date_taken の409になり、保留で利用者に任せる。
      return outcomeOf(
        await fetch("/api/work/records", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ startDate: op.date, place: op.place, title: op.place, ...trip }),
        }),
      );
  }
}

async function sendOp(op: WriteOp): Promise<SendOutcome> {
  switch (op.kind) {
    case "shoppingBought":
      return outcomeOf(
        await fetch(`/api/shopping/${op.itemId}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ bought: op.bought }),
        }),
      );
    case "taskDone":
      return outcomeOf(
        await fetch(`/api/tasks/${encodeURIComponent(op.taskId)}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ done: op.done, completeAction: true }),
        }),
      );
    case "workToday":
      return sendWorkToday(op);
  }
}

/** 同時に走らせない。複数のタブ・画面が同じ操作を二重に送るのを防ぐ。 */
async function withLock<T>(task: () => Promise<T>): Promise<T | null> {
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return navigator.locks.request("dayspan:write-queue", { ifAvailable: true }, async (lock) =>
      lock ? task() : null,
    );
  }
  return task();
}

/**
 * ためた操作を先頭から順にサーバーへ送る（issue #1135）。
 * 通信が戻ったとき・画面を開いたとき・操作を積んだときに呼ぶ。
 */
export async function flushWriteQueue(): Promise<{ changed: boolean }> {
  const result = await withLock(async () => {
    let changed = false;
    setWriteSyncState({ flushing: true });
    try {
      for (;;) {
        const op = nextSendable(readWriteQueue());
        if (!op) break;

        let outcome: SendOutcome;
        try {
          outcome = await sendOp(op);
        } catch {
          break; // 通信が戻っていない。残して次の機会に再試行する。
        }

        if (outcome.type === "retry") {
          setWriteSyncState({ authRequired: Boolean(outcome.authRequired) });
          break;
        }
        setWriteSyncState({ authRequired: false });

        if (outcome.type === "hold") {
          writeWriteQueue(
            readWriteQueue().map((o) => (o.id === op.id ? { ...o, heldReason: outcome.message } : o)),
          );
          break;
        }

        writeWriteQueue(readWriteQueue().filter((o) => o.id !== op.id));
        changed = true;
      }
    } finally {
      setWriteSyncState({ flushing: false });
    }
    return { changed };
  });
  // 届いたものがあれば、一覧を持つ画面へ取り直しを促す（use-write-synced.ts）。
  if (result?.changed && typeof window !== "undefined") {
    window.dispatchEvent(new Event(WRITE_SYNCED_EVENT));
  }
  return result ?? { changed: false };
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 操作をキューへ積み、すぐ送ってみる。オフラインなら送信は通信不達で止まり、そのまま残る。
 * 画面は積んだ操作を `usePendingWrites()` から重ねて描く。
 */
/** 積んでから送る経路を使うか。オフライン中、または先にためた操作がある（順序を守る）とき。 */
export function shouldQueueWrite(offline: boolean): boolean {
  return isOfflineNow(offline) || readWriteQueue().length > 0;
}

export function submitWrite(input: DistributiveOmit<WriteOp, "id" | "queuedAt" | "heldReason">): void {
  const op = { ...input, id: newId(), queuedAt: new Date().toISOString() } as WriteOp;
  writeWriteQueue(enqueue(readWriteQueue(), op));
  void flushWriteQueue();
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
