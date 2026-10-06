"use client";

import { useSyncExternalStore } from "react";

/** 時計の刻み（ミリ秒）。分の境目を最大でもこの遅れで跨げるようにする。 */
const TICK_MS = 30_000;

function subscribe(onStoreChange: () => void): () => void {
  const timer = setInterval(onStoreChange, TICK_MS);
  return () => clearInterval(timer);
}

/**
 * 分単位の現在時刻。
 *
 * 時計はReactの外にある変化する値なので、状態として持たず購読する。
 * サーバー側では値を返さないため、ハイドレーションのずれも起きない
 * （現在時刻に依存する描画は、クライアントで値が入ってから始まる）。
 */
export function useMinuteBucket(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
}

/** 現在時刻（ISO 8601）。分の境目でだけ変わる。サーバー描画時は null。 */
export function useNowIso(): string | null {
  const minuteBucket = useMinuteBucket();
  return minuteBucket === null ? null : new Date(minuteBucket * 60_000).toISOString();
}

function subscribeSecond(onStoreChange: () => void): () => void {
  const timer = setInterval(onStoreChange, 1_000);
  return () => clearInterval(timer);
}

/** 秒単位の現在時刻（ISO 8601）。購読している間だけ1秒ごとに変わる。サーバー描画時は null。 */
export function useSecondNowIso(): string | null {
  const second = useSyncExternalStore(
    subscribeSecond,
    () => Math.floor(Date.now() / 1000),
    () => null,
  );
  return second === null ? null : new Date(second * 1000).toISOString();
}
