import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SettingsFrame } from "@/components/nav/settings-frame";
import { SettingsBottomNav } from "@/components/nav/settings-bottom-nav";
import { OfflineNotice } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 設定画面の枠。
 *
 * 設定は一覧から個別の画面へ入る形にしている（すべてを1画面に展開すると、
 * 目当ての項目にたどり着くまで縦に長くスクロールすることになるため）。
 * どの階層にいても戻り先が1つ上に固定されるよう、戻り先はここで受け取る。
 */
export function SettingsShell({
  title,
  description,
  backHref,
  backLabel,
  actions,
  wide = false,
  columns = false,
  children,
}: {
  title: string;
  description?: string;
  backHref: string;
  backLabel: string;
  /** 見出しの右へ置く操作（場所の「＋」など）。持たない画面がほとんどなので任意にする。 */
  actions?: ReactNode;
  /**
   * 1024px以上で本文の最大幅を広げる（issue #636）。一覧・グラフのように幅を使える画面だけに付ける。
   * 入力欄が並ぶ設定の各画面は、欄が横に伸びても読みやすくならないため従来の幅のままにする。
   */
  wide?: boolean;
  /**
   * 1024px以上で本文の子を2列に並べる（`wide` と組み合わせて使う）。全幅にしたい子には
   * `lg:col-span-2` を付ける。
   */
  columns?: boolean;
  children: ReactNode;
}) {
  return (
    <SettingsFrame>
    <div className="flex min-h-app flex-col">
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-10 flex items-center gap-1 bg-surface-container-low px-1 py-1.5 md:gap-2 md:px-2 md:py-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft className="size-4" />
            {backLabel}
          </Link>
        </Button>
        <h1 className="type-title-large min-w-0 flex-1 truncate px-1">{title}</h1>
        {actions}
      </header>

      <OfflineNotice />

      <div
        className={cn(
          "mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6",
          wide && "@3xl/main:max-w-5xl",
          columns && "@3xl/main:grid @3xl/main:grid-cols-2 @3xl/main:content-start @3xl/main:items-start",
        )}
      >
        {description && (
          <p className={cn("type-body-medium text-on-surface-variant", columns && "@3xl/main:col-span-2")}>
            {description}
          </p>
        )}
        {children}
      </div>

      {/* スマホ幅では下部ナビを下端に固定する（issue #1348）。本文が短くても flex-1 で下端へ押される。 */}
      <SettingsBottomNav />
    </div>
    </SettingsFrame>
  );
}
