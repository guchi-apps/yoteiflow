import { SkeletonBlock } from "@/components/calendar/calendar-skeleton";
import { LoadingRefreshMark } from "@/components/ui/refresh-button";

/**
 * 年休の取得状況の骨組み。
 *
 * ルートの `loading.tsx` へ落とすと全面のアイコン（起動画面と同じ面）が挟まるため、
 * この画面の形をここに持つ（docs/spec.md §33）。枠は `SettingsShell` と同じ
 * 「戻るボタン付きのヘッダー」。1024px以上では実物と同じくカードを2列に並べる（issue #636）。
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

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6 lg:grid lg:max-w-5xl lg:grid-cols-2 lg:content-start lg:items-start">
        <div className="flex items-center justify-between gap-2 lg:col-span-2">
          <SkeletonBlock className="size-8 rounded-md" />
          <SkeletonBlock className="h-6 w-28" />
          <SkeletonBlock className="size-8 rounded-md" />
        </div>

        {/* 残り日数・ペース・月ごと・一覧の4枚。 */}
        <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
          <SkeletonBlock className="h-9 w-32" />
          <SkeletonBlock className="h-3.5 w-full rounded-sm" />
          <SkeletonBlock className="h-4 w-48" />
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
          <SkeletonBlock className="h-4 w-24" />
          <SkeletonBlock className="h-2 w-full rounded-full" />
          <SkeletonBlock className="h-2 w-full rounded-full" />
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
          <SkeletonBlock className="h-4 w-24" />
          <SkeletonBlock className="h-16 w-full" />
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
          <SkeletonBlock className="h-4 w-24" />
          {Array.from({ length: 3 }, (_, i) => (
            <SkeletonBlock key={i} className="h-4 w-40" />
          ))}
        </div>
      </div>
    </div>
  );
}
