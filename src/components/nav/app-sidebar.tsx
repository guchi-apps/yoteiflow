"use client";

import { useState } from "react";
import Link from "next/link";
import { Square } from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { formatElapsed } from "@/components/calendar/activity-format";
import { DrawerNavContent, RunningDot, useWorkTodoCount } from "@/components/nav/app-drawer";
import type { NavKey } from "@/components/nav/nav-items";
import { useRunningActivityStop } from "@/components/nav/use-running-activity-stop";
import { Button } from "@/components/ui/button";
import type { RunningActivitySummary } from "@/types/activity";

/**
 * 768px以上で左端に常に出すナビ（issue #636）。
 *
 * 中身はドロワーと同じもの（`DrawerNavContent`）をそのまま描く。狭い画面ではメニューボタンから
 * 開き、広い画面では開いたまま置いておく、という違いだけにして、探す位置（左端）も並びも
 * 画面幅で入れ替えない（docs/spec.md §4）。
 *
 * 勤務の未対応の件数は、ポインタが乗った・フォーカスが入ったときに、この画面で1回だけ取りにいく。
 * 表示と同時に数えると画面を開くたびにNotionへの往復が1本増え、数えないと768px以上では
 * メニューボタンが無いぶんこの件数を見る経路が無くなる。サイドバーへ手を伸ばした時点を、ドロワーを
 * 開いた時点と同じ「画面を移ろうとしている」合図として扱う（issue #636 計画レビューG1の指摘）。
 */
export function AppSidebar({
  current,
  activityRunning,
  running,
}: {
  /** どの5画面でもない画面（睡眠・日付・場所・設定）では null。 */
  current: NavKey | null;
  activityRunning: boolean;
  /** 下端に出す記録中の1件。記録画面ではカードが本文にあるため null を渡す。 */
  running: RunningActivitySummary | null;
}) {
  // 一度 true になったら戻さない。触れるたびに取り直すと、行の上をなぞるだけで往復が積み上がる。
  const [touched, setTouched] = useState(false);
  const workTodoCount = useWorkTodoCount(touched);

  return (
    <aside
      aria-label="画面の切り替え"
      className="hidden w-48 shrink-0 flex-col border-r border-outline-variant bg-surface-container-low pt-4 pb-3 md:flex lg:w-56"
      onPointerEnter={() => setTouched(true)}
      onFocus={() => setTouched(true)}
    >
      <div className="px-6 pb-2">
        <Wordmark size={24} compact className="text-base" />
      </div>
      <DrawerNavContent
        current={current ?? undefined}
        activityRunning={activityRunning}
        workTodoCount={workTodoCount}
        footer={<SidebarRunningCard running={running} />}
      />
    </aside>
  );
}

/**
 * サイドバーの下端の記録中カード。狭い画面で下部ナビの直上に出す帯（running-activity-bar.tsx）と
 * 同じ役割で、止めるまでの最短経路。詳しい操作は記録画面に閉じる。
 */
function SidebarRunningCard({ running }: { running: RunningActivitySummary | null }) {
  const { running: current, nowIso, busy, error, stop } = useRunningActivityStop(running);

  if (!current) return null;

  return (
    <div className="mx-3 flex flex-col gap-2 rounded-2xl bg-primary-container p-3 text-on-primary-container elevation-1">
      <Link href="/activity" className="flex min-w-0 flex-col gap-0.5 leading-tight">
        <span className="flex min-w-0 items-center gap-2">
          <RunningDot />
          <span className="type-body-medium clip-nowrap">{error ?? current.title}</span>
        </span>
        {nowIso && !error && (
          <span className="type-headline-small tabular-nums">
            {formatElapsed(current.startedAt, nowIso)}
          </span>
        )}
      </Link>

      <Button
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={stop}
      >
        <Square className="fill-current" />
        停止
      </Button>
    </div>
  );
}
