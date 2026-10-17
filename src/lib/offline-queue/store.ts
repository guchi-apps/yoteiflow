"use client";

import { useSyncExternalStore } from "react";

import type { WriteOp } from "@/lib/offline-queue/ops";

const KEY = "dayspan:write-queue:v1";
const EMPTY: WriteOp[] = [];

const listeners = new Set<() => void>();
let cache: { raw: string | null; ops: WriteOp[] } = { raw: null, ops: EMPTY };

function notify() {
  for (const listener of listeners) listener();
}

/** 保存済みの操作。読めない・壊れた値は空として扱う（キューが原因で画面が開けなくならないように）。 */
export function readWriteQueue(): WriteOp[] {
  if (typeof localStorage === "undefined") return EMPTY;

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  // useSyncExternalStore は同じ値で同じ参照を返すことを求める。
  if (raw === cache.raw) return cache.ops;

  let ops: WriteOp[] = EMPTY;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) ops = parsed as WriteOp[];
    } catch {
      ops = EMPTY;
    }
  }
  cache = { raw, ops };
  return ops;
}

export function writeWriteQueue(ops: WriteOp[]): void {
  try {
    if (ops.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(ops));
  } catch {
    // 保存できない環境では、このタブの中だけで動かす。
    cache = { raw: null, ops: ops.length === 0 ? EMPTY : ops };
  }
  notify();
}

/** ログアウト・別アカウントへの切り替えで、前のユーザーの操作を残さない。 */
export function clearWriteQueue(): void {
  writeWriteQueue([]);
  try {
    localStorage.removeItem(CREATED_KEY);
  } catch {
    // 保存できない環境では何も残っていない。
  }
}

/**
 * 届いた作成の仮ID（clientId）と実IDの対応。作成が届いたあとに仮タスクの画面から積まれた操作を、
 * 実IDへ付け替えるために使う（issue #1247 B2）。古いものから捨て、直近の分だけ持つ。
 */
const CREATED_KEY = "dayspan:write-queue:created:v1";
const CREATED_LIMIT = 50;

function readCreatedIds(): [string, string][] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CREATED_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberCreatedTask(clientId: string, realId: string): void {
  try {
    const next = [...readCreatedIds().filter(([c]) => c !== clientId), [clientId, realId]].slice(-CREATED_LIMIT);
    localStorage.setItem(CREATED_KEY, JSON.stringify(next));
  } catch {
    // 保存できない環境では付け替えられない（仮IDの操作は送らずに捨てる）。
  }
}

export function createdTaskId(clientId: string): string | undefined {
  return readCreatedIds().find(([c]) => c === clientId)?.[1];
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** まだサーバーへ届いていない操作。サーバー描画では常に空。 */
export function usePendingWrites(): WriteOp[] {
  return useSyncExternalStore(subscribe, readWriteQueue, () => EMPTY);
}

type SyncState = { flushing: boolean; authRequired: boolean; notices: string[] };
let syncState: SyncState = { flushing: false, authRequired: false, notices: [] };

/** 他の端末の新しい変更で破棄した操作などを、利用者が閉じるまで画面に出す（issue #1242）。 */
export function addWriteNotice(message: string): void {
  setWriteSyncState({ notices: [...syncState.notices, message] });
}

export function dismissWriteNotices(): void {
  setWriteSyncState({ notices: [] });
}

export function setWriteSyncState(next: Partial<SyncState>): void {
  syncState = { ...syncState, ...next };
  notify();
}

export function useWriteSyncState(): SyncState {
  return useSyncExternalStore(
    subscribe,
    () => syncState,
    () => syncState,
  );
}
