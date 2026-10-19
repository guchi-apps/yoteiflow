import { AppFrameSkeleton, BottomNavSkeleton, SkeletonBlock } from "@/components/calendar/calendar-skeleton";
import { LoadingRefreshMark } from "@/components/ui/refresh-button";
import { WIDE_SECTION_CARD_CLASS } from "@/components/ui/wide-section";
import { cn } from "@/lib/utils";

/**
 * 買い物リストの骨組み（docs/spec.md §36）。
 *
 * この画面はNotionへ取りにいくため、下部ナビから移ったときに待ちが入る。独自の骨組みを
 * 持たせないと、根の loading.tsx（面と回る更新アイコンだけ）に落ちる。
 * 広い画面では実物の「すべて」と同じく、サイドバーとカテゴリのカードの段組みにする（issue #636）。
 */
export default function Loading() {
  return (
    <AppFrameSkeleton>
      <div className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
        <SkeletonBlock className="size-8 rounded-full md:hidden" />
        <span className="flex-1" />
        <SkeletonBlock className="h-8 w-20 rounded-full" />
        <SkeletonBlock className="h-8 w-8 rounded-full" />
        <LoadingRefreshMark />
      </div>

      {/* カテゴリのタブ。件数はDBによって違うため、幅を揃えず3つだけ置く。 */}
      <div className="flex gap-2 border-b border-rule bg-surface-container-low px-3 pt-1 pb-2">
        <SkeletonBlock className="h-7 w-20 rounded-full" />
        <SkeletonBlock className="h-7 w-16 rounded-full" />
        <SkeletonBlock className="h-7 w-24 rounded-full" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden @xl/main:columns-2 @xl/main:gap-3 @xl/main:p-3 @5xl/main:columns-3">
        {/* カテゴリの見出しと、その下に並ぶ項目。件数はカテゴリによって違う。 */}
        {Array.from({ length: 3 }, (_, section) => (
          <div
            key={section}
            className={cn(WIDE_SECTION_CARD_CLASS, "@xl/main:mb-3 @xl/main:break-inside-avoid")}
          >
            <div className="border-b border-rule px-3 py-1.5">
              <SkeletonBlock className="h-3 w-16" />
            </div>
            {Array.from({ length: section === 1 ? 2 : 3 }, (_, row) => (
              <div key={row} className="flex items-start gap-2 py-2 pr-3 pl-2">
                <SkeletonBlock className="size-4 rounded-xs" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <SkeletonBlock className="h-4 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <BottomNavSkeleton />
    </AppFrameSkeleton>
  );
}
