"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** `/settings/<子画面>` の配下か（設定一覧 `/settings` 自体は含まない）。 */
function useIsSettingsChild() {
  const pathname = usePathname();
  return pathname.startsWith("/settings/");
}

/** ヘッダーの見出し。設定の子画面では画面名ではなく「設定」を出し、画面名はパンくずが示す（issue #1735）。 */
export function SettingsHeading({ title }: { title: string }) {
  const isChild = useIsSettingsChild();
  return <h1 className="type-title-large min-w-0 flex-1 truncate px-1">{isChild ? "設定" : title}</h1>;
}

/** 設定の子画面だけに出すパンくず。「設定」から一覧へ戻れる。 */
export function SettingsBreadcrumb({ title }: { title: string }) {
  const isChild = useIsSettingsChild();
  if (!isChild) return null;
  return (
    <nav aria-label="パンくずリスト" className="type-body-medium flex min-w-0 items-center gap-1 px-6 pt-4 text-on-surface-variant">
      <Link href="/settings" className="shrink-0 text-primary underline underline-offset-2">
        設定
      </Link>
      <ChevronRight className="size-4 shrink-0" aria-hidden />
      <span aria-current="page" className="min-w-0 truncate font-bold text-on-surface">
        {title}
      </span>
    </nav>
  );
}

/** 読み込み中の骨組み用。子画面のときだけパンくず行ぶんの高さを確保する。 */
export function SettingsBreadcrumbSkeleton() {
  const isChild = useIsSettingsChild();
  if (!isChild) return null;
  return (
    <div className="px-6 pt-4" aria-hidden>
      <div className="h-5 w-40 animate-pulse rounded-md bg-surface-container-high" />
    </div>
  );
}
