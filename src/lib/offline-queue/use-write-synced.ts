"use client";

import { useEffect, useRef } from "react";

import { WRITE_SYNCED_EVENT } from "@/lib/offline-queue/flush";

/** ためた操作がサーバーへ届いたとき、一覧を取り直す（`useApiResource` の `reload`）。 */
export function useWriteSynced(reload: () => void): void {
  const ref = useRef(reload);
  useEffect(() => {
    ref.current = reload;
  });
  useEffect(() => {
    const handler = () => ref.current();
    window.addEventListener(WRITE_SYNCED_EVENT, handler);
    return () => window.removeEventListener(WRITE_SYNCED_EVENT, handler);
  }, []);
}
