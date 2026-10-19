import { AppFrameSkeleton, BottomNavSkeleton, SkeletonBlock } from "@/components/calendar/calendar-skeleton";
import { LoadingRefreshMark } from "@/components/ui/refresh-button";

/**
 * 活動記録の骨組み（issue #352）。
 *
 * 起動直後は上に起動画面（AppLaunchScreen）が乗っているため、これが実際に見えるのは主に
 * 下部ナビから記録の画面へ移ったとき。押した直後に「受け付けた」ことが見えるように、
 * 実際の配置と同じ形を先に描いてから内容を差し替える。
 *
 * 下部ナビの帯まで描くのは、そこが画面をまたいで残り続ける枠のため。広い画面ではサイドバーと
 * 左右2列の配置も実物に合わせる（issue #636）。
 */
export default function Loading() {
  return (
    <AppFrameSkeleton>
      <div className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
        <SkeletonBlock className="size-8 rounded-full md:hidden" />
        <SkeletonBlock className="h-6 w-20" />
        <span className="flex-1" />
        <SkeletonBlock className="h-8 w-24 rounded-full" />
        <LoadingRefreshMark />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 @4xl/main:grid @4xl/main:max-w-6xl @4xl/main:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @4xl/main:items-start @4xl/main:gap-6 @4xl/main:p-6">
          {/* 記録中のカード、または「いま記録しているものはありません」の枠 */}
          <SkeletonBlock className="h-32 w-full rounded-lg @4xl/main:row-span-2" />

          <div className="@container/start flex flex-col gap-4 @4xl/main:col-start-2">
            <SkeletonBlock className="h-4 w-24" />

            {/* 項目のボタン。実物と同じ高さ・列数にする。 */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:@lg/start:grid-cols-4">
              {Array.from({ length: 6 }, (_, i) => (
                <SkeletonBlock key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          </div>

          <SkeletonBlock className="h-14 w-full rounded-sm @4xl/main:col-start-2" />
        </div>
      </div>

      <BottomNavSkeleton />
    </AppFrameSkeleton>
  );
}
