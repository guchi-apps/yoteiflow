import { SkeletonBlock } from "@/components/calendar/calendar-skeleton";
import { LoadingRefreshMark } from "@/components/ui/refresh-button";

/**
 * 設定の骨組み（issue #352）。
 *
 * 設定は一覧から個別の画面へ入る形で、どの階層も SettingsShell の同じ枠を持つ
 * （src/components/settings/settings-shell.tsx）。配下の画面はここを共有する。
 */
export default function Loading() {
  return (
    <div className="flex min-h-app flex-col">
      <header className="flex items-center gap-1 bg-surface-container-low px-1 py-1.5 md:gap-2 md:px-2 md:py-2">
        <SkeletonBlock className="h-8 w-20 rounded-md" />
        <SkeletonBlock className="h-6 w-24" />
        <span className="flex-1" />
        <LoadingRefreshMark className="size-8 md:size-8" />
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <SkeletonBlock className="size-5 rounded-sm" />
              <SkeletonBlock className="h-4 w-32" />
              <span className="flex-1" />
              <SkeletonBlock className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
