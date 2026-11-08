import { SkeletonBlock } from "@/components/calendar/calendar-skeleton";

/**
 * 勤務の骨組み（docs/spec.md §33・issue #508）。
 *
 * この画面はNotionを読んでから描くため、置かないとルートの `loading.tsx` へ落ちて
 * 全面のブランド面が挟まる。下部ナビの1枠になったため、枠は `reminders/loading.tsx` と
 * 同じ形（メニューボタン風のヘッダー＋ `BottomNavSkeleton`）にする。
 * 出張・年休の手続きはヘッダー右上のアイコンへ移り（issue #1271）、本文は月の見出し・
 * 集計・日別の一覧の1列になった。
 */
export default function Loading() {
  return (
    <>
            <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <SkeletonBlock className="h-8 w-8 rounded-md" />
              <SkeletonBlock className="h-5 w-40" />
              <SkeletonBlock className="h-8 w-8 rounded-md" />
            </div>

            <div className="flex gap-4 px-1">
              {Array.from({ length: 3 }, (_, i) => (
                <SkeletonBlock key={i} className="h-4 w-14" />
              ))}
            </div>

            <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <SkeletonBlock className="h-3 w-12" />
                  <SkeletonBlock className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
