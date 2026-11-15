import { SkeletonBlock } from "@/components/calendar/calendar-skeleton";

/** 勤務先の登録の骨組み。ルートの `loading.tsx` へ落とすと全面のブランド面が挟まるため、この画面の形を持つ。 */
export default function Loading() {
  return (
    <div className="flex min-h-app flex-col">
      <header className="flex items-center gap-1 bg-surface-container-low px-1 py-1.5 md:gap-2 md:px-2 md:py-2">
        <SkeletonBlock className="size-8 rounded-md" />
        <SkeletonBlock className="h-6 w-32" />
      </header>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 p-6 @3xl/main:max-w-5xl">
        {Array.from({ length: 5 }, (_, i) => (
          <SkeletonBlock key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
