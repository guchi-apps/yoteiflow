import { LoadingRefreshMark } from "@/components/ui/refresh-button";
import { cn } from "@/lib/utils";

/**
 * 読み込み中の骨組み。押した直後に「受け付けた」ことが見えるように、
 * 実際の配置と同じ形を先に描いてから内容を差し替える。
 */
export function CalendarSkeleton() {
  return (
    <AppFrameSkeleton>
      <div className="flex items-center gap-2 bg-surface-container-low px-2 py-2 md:max-lg:flex-wrap md:max-lg:justify-end">
        <SkeletonBlock className="h-8 w-8 rounded-md md:hidden" />
        <SkeletonBlock className="h-8 w-8 rounded-md md:max-lg:size-10" />
        <SkeletonBlock className="hidden size-8 rounded-md md:block md:max-lg:size-10" />
        <SkeletonBlock className="h-6 w-32" />
        <span className="flex-1" />
        <span aria-hidden className="hidden md:max-lg:block md:max-lg:basis-full" />
        <SkeletonBlock className="h-8 w-14 rounded-md md:max-lg:h-10" />
        <SkeletonBlock className="h-8 w-24 rounded-md md:max-lg:h-10" />
        <LoadingRefreshMark />
      </div>

      <CalendarGridSkeleton />

      <BottomNavSkeleton />
    </AppFrameSkeleton>
  );
}

/**
 * 下部ナビから開く5画面の骨組みの外枠（issue #636）。実物の `AppFrame` と同じく、
 * 768px以上では左端にサイドバーの帯を置き、本文の列を `@container/main` にする。
 * 骨組みだけ1列のままだと、読み込みが終わった瞬間に割り付けが跳ねる。
 */
export function AppFrameSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-app overflow-hidden">
      <SidebarSkeleton />
      <div className="@container/main flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

/** サイドバー（app-sidebar.tsx）と同じ幅・同じ行数の帯。 */
function SidebarSkeleton() {
  return (
    <div
      aria-hidden
      className="hidden w-48 shrink-0 flex-col gap-1 border-r border-outline-variant bg-surface-container-low px-3 pt-4 md:flex lg:w-56"
    >
      <SkeletonBlock className="mx-3 mb-3 h-5 w-20" />
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className={cn("flex items-center gap-3 px-4 py-3", i === 5 && "mt-6")}>
          <SkeletonBlock className="size-5 rounded-sm" />
          <SkeletonBlock className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * 予定とタスクの到着を待っている間のグリッド。ヘッダーは実物が先に描けるため含めない
 * （どの期間を見ているかは、データが揃う前から確定している）。
 */
export function CalendarGridSkeleton() {
  return (
    <>
      <div className="grid shrink-0 grid-cols-7 border-b border-outline-variant">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex justify-center py-2">
            <SkeletonBlock className="h-3 w-4" />
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {Array.from({ length: 6 }, (_, week) => (
          <div key={week} className="grid grid-cols-7 border-b border-outline-variant" style={{ height: 112 }}>
            {Array.from({ length: 7 }, (_, day) => (
              <div key={day} className="flex flex-col gap-1 border-r border-outline-variant p-1 last:border-r-0">
                <SkeletonBlock className="size-5 rounded-full" />
                {/* 予定の量は日によって違う。同じ本数を並べると、かえって作り物に見える。 */}
                {Array.from({ length: (week * 7 + day) % 3 }, (_, item) => (
                  <SkeletonBlock key={item} className="h-4 w-full rounded-item" />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-sm bg-on-surface/8", className)} />;
}

/**
 * 下部ナビと同じ寸法の帯（issue #352）。
 *
 * ナビは画面をまたいで残り続ける枠で、骨組みから落とすと、押したナビそのものが
 * 一瞬消えて戻る。中央の記録だけが上へはみ出した円になるのも実物と同じ
 * （src/components/nav/main-nav.tsx）。
 */
export function BottomNavSkeleton() {
  return (
    <nav
      aria-hidden
      className="relative grid shrink-0 grid-cols-5 items-start bg-surface-container px-2 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
    >
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="flex w-full min-w-0 flex-col items-center gap-1">
          <span className="relative flex h-8 w-16 items-center justify-center">
            {i === 2 ? (
              <SkeletonBlock className="absolute bottom-0 size-14 rounded-full border-4 border-surface-container" />
            ) : (
              <SkeletonBlock className="size-6 rounded-sm" />
            )}
          </span>
          <SkeletonBlock className="h-3 w-10" />
        </span>
      ))}
    </nav>
  );
}
