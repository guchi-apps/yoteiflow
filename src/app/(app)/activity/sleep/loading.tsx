import { SkeletonBlock } from "@/components/calendar/calendar-skeleton";
import { LoadingRefreshMark } from "@/components/ui/refresh-button";

/**
 * 睡眠の横通し表示の骨組み。
 *
 * ルートの `loading.tsx` へ落とすと全面のアイコン（起動画面と同じ面）が挟まる（docs/spec.md §33）。
 * 枠は `SettingsShell` と同じ「戻るボタン付きのヘッダー」。
 */
export default function Loading() {
  return (
    <div className="flex min-h-app flex-col">
      <header className="flex items-center gap-1 bg-surface-container-low px-1 py-1.5 md:gap-2 md:px-2 md:py-2">
        <SkeletonBlock className="h-8 w-20 rounded-md" />
        <SkeletonBlock className="h-6 w-16" />
        <span className="flex-1" />
        <LoadingRefreshMark className="size-8 md:size-8" />
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 lg:max-w-5xl">
        {/* 平均と3つの数字。 */}
        <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
          <SkeletonBlock className="h-8 w-40" />
          <div className="flex gap-2">
            <SkeletonBlock className="h-9 flex-1" />
            <SkeletonBlock className="h-9 flex-1" />
            <SkeletonBlock className="h-9 flex-1" />
          </div>
        </div>

        {/* 期間のチップ。 */}
        <div className="flex gap-1.5">
          <SkeletonBlock className="h-8 w-16 rounded-md" />
          <SkeletonBlock className="h-8 w-16 rounded-md" />
        </div>

        {/* 夜ごとの行。 */}
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 14 }, (_, index) => (
            <SkeletonBlock key={index} className="h-4 w-full" />
          ))}
        </div>

        {/* 睡眠時間の推移と、睡眠負債・最長最短（issue #1303）。 */}
        <SkeletonBlock className="h-48 w-full rounded-xl" />
        <SkeletonBlock className="h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}
