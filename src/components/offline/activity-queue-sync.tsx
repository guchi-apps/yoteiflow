"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { CloudUpload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { flushActivityQueue } from "@/lib/activity-queue/flush";
import { flushWriteQueue } from "@/lib/offline-queue/flush";
import {
  readWriteQueue,
  useWriteSyncState,
  usePendingWrites,
  writeWriteQueue,
} from "@/lib/offline-queue/store";
import { usePendingOps, useSyncState, writeQueue, readQueue } from "@/lib/activity-queue/store";

/**
 * オフライン中にためた活動記録の操作を、通信が戻ったときにサーバーへ送る（issue #974）。
 *
 * レイアウトに1つ置く。画面を開いたとき・通信が戻ったとき・画面に戻ってきたときに送り、
 * 届いたものがあればサーバーの内容を取り直して他の端末の変更と合わせる。
 * 描画するものは無い（状態の表示は ActivityQueueNotice）。
 */
export function ActivityQueueSync() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const offline = useOffline();

  useEffect(() => {
    if (offline) return;

    let cancelled = false;
    const run = () => {
      void flushWriteQueue();
      void flushActivityQueue().then((result) => {
        if (!cancelled && result.changed) startTransition(() => router.refresh());
      });
    };

    run();

    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [offline, router]);

  return null;
}

/** ためている操作の件数と、同期できなかった理由。何も無ければ出さない。 */
export function ActivityQueueNotice() {
  const ops = usePendingOps();
  const { flushing, authRequired } = useSyncState();
  const router = useRouter();
  const [, startTransition] = useTransition();

  if (ops.length === 0) return null;

  const held = ops.find((op) => op.heldReason);

  const retry = () => {
    writeQueue(readQueue().map((op) => ({ ...op, heldReason: undefined })));
    void flushActivityQueue().then((result) => {
      if (result.changed) startTransition(() => router.refresh());
    });
  };
  // 保留している先頭の操作だけを捨てる。他の端末の記録を守るため、自動では捨てない。
  const discardHeld = () => {
    if (!held) return;
    writeQueue(readQueue().filter((op) => op.id !== held.id));
  };

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 bg-secondary-container px-3 py-2 text-xs text-on-secondary-container"
    >
      <CloudUpload className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {held
          ? `記録の操作${ops.length}件を同期できていません。${held.heldReason}`
          : authRequired
            ? `記録の操作${ops.length}件は、ログインし直すと同期されます。`
            : flushing
              ? `記録の操作${ops.length}件を同期しています…`
              : `記録の操作${ops.length}件は、通信が戻ると同期されます。`}
      </span>
      {held && (
        <>
          <Button size="sm" variant="ghost" onClick={retry}>
            再試行
          </Button>
          <Button size="sm" variant="ghost" onClick={discardHeld}>
            この操作を破棄
          </Button>
        </>
      )}
      {authRequired && !held && (
        <Button size="sm" variant="ghost" asChild>
          <a href="/login">ログイン</a>
        </Button>
      )}
    </div>
  );
}

/** ためている買い物・タスク・勤務の操作の件数と、同期できなかった理由。何も無ければ出さない。 */
export function WriteQueueNotice() {
  const ops = usePendingWrites();
  const { flushing, authRequired } = useWriteSyncState();

  if (ops.length === 0) return null;

  const held = ops.find((op) => op.heldReason);
  const retry = () => {
    writeWriteQueue(readWriteQueue().map((op) => ({ ...op, heldReason: undefined })));
    void flushWriteQueue();
  };
  const discardHeld = () => {
    if (!held) return;
    writeWriteQueue(readWriteQueue().filter((op) => op.id !== held.id));
  };

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 bg-secondary-container px-3 py-2 text-xs text-on-secondary-container"
    >
      <CloudUpload className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {held
          ? `操作${ops.length}件を同期できていません。${held.heldReason}`
          : authRequired
            ? `操作${ops.length}件は、ログインし直すと同期されます。`
            : flushing
              ? `操作${ops.length}件を同期しています…`
              : `操作${ops.length}件は、通信が戻ると同期されます。`}
      </span>
      {held && (
        <>
          <Button size="sm" variant="ghost" onClick={retry}>
            再試行
          </Button>
          <Button size="sm" variant="ghost" onClick={discardHeld}>
            この操作を破棄
          </Button>
        </>
      )}
      {authRequired && !held && (
        <Button size="sm" variant="ghost" asChild>
          <a href="/login">ログイン</a>
        </Button>
      )}
    </div>
  );
}
