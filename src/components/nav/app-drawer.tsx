"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, ChevronRight, History, MapPin, Menu, Moon, Settings } from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { NAV_ITEMS, type NavKey } from "@/components/nav/nav-items";
import { isPlainClick, useOfflineNavigate } from "@/components/nav/offline-navigate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { APP_VERSION } from "@/lib/app-version";
import { cn } from "@/lib/utils";

/**
 * ヘッダー左上のメニューボタンと、そこから左端に出るドロワー（issue #328・#463・#508）。
 *
 * 画面の移動（カレンダー・タスク・記録・勤務・買い物リスト）と、毎日は押さない日付・場所・設定を
 * ここへまとめる。iPad・PCではこれらをヘッダーへ横一列に並べていたが、
 * カレンダーでは同じ帯に前へ・次へ・年月・今日・表示形式・再取得も乗るため、いま見ている期間が
 * 押しどころの列の中に埋もれていた。ヘッダーにはその画面の操作だけを残す。
 *
 * 768px以上では同じ中身を左端に開いたまま置く（app-sidebar.tsx・issue #636）ため、
 * このボタンは出さない。中身は画面幅で変えない。同じアプリの中で、探す位置が幅によって
 * 入れ替わらないようにするため。
 */
export function AppMenuButton({
  current,
  activityRunning = false,
  className,
}: {
  /** いまいる画面。その行を選択状態にする。 */
  current?: NavKey;
  /** 活動を記録中かどうか。記録の行と、閉じているときのボタンへ印を出す。 */
  activityRunning?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const workTodoCount = useWorkTodoCount(open);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={activityRunning ? "メニュー（記録中）" : "メニュー"}
          className={cn("relative shrink-0 md:hidden", className)}
        >
          <Menu />
          {/*
            記録中だと、メニューを開かなくても分かるようにする（docs/spec.md §4）。
            止め忘れたまま別の画面で作業していると、その間ずっと同じ項目を記録し続けるため。
            記録の項目がドロワーの中へ入ったぶん、印はその入口にあたるこのボタンへ出す。
          */}
          {activityRunning && <RunningDot className="absolute top-0.5 right-0.5" />}
        </Button>
      </DialogTrigger>

      <DialogContent
        position="left"
        showCloseButton={false}
        className="bg-surface-container-low pt-[calc(1rem_+_env(safe-area-inset-top,0px))] pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <DialogTitle className="px-6 pb-2">
          <Wordmark size={24} compact className="text-base" />
        </DialogTitle>
        {/* 読み上げ用。見出しだけでは、ここが何の一覧なのかが読み上げでは伝わらない。 */}
        <DialogDescription className="sr-only">画面の切り替えと設定</DialogDescription>

        <DrawerNavContent
          current={current}
          activityRunning={activityRunning}
          workTodoCount={workTodoCount}
          onNavigate={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * 手続きが残っている出張・年休の件数（docs/spec.md §34）。`active` になるたびに1回取りにいく。
 *
 * 各画面のサーバー側で数えると、勤務を開かない日もNotionへの往復が画面の数だけ増える
 * （記録の長押しシートと同じ扱い）。そのためドロワーは開いたとき、1024px以上のサイドバーは
 * ポインタが乗った・フォーカスが入ったときだけ読む（issue #636）。取れなければ数字を出さないだけで、
 * メニューそのものは使える。勤務は下部ナビ（NAV_ITEMS）へ移ったが（issue #508）、ドロワーには
 * 「画面」グループの行として引き続き出るため、この取得自体は変えていない。
 */
export function useWorkTodoCount(active: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;

    let alive = true;
    fetch("/api/work/alerts")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { count?: number } | null) => {
        if (alive) setCount(body?.count ?? null);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [active]);

  return count;
}

/**
 * ドロワーとサイドバー（app-sidebar.tsx）の中身。画面幅によって並びや項目が食い違わないよう、
 * 1か所で持つ（issue #636）。
 */
export function DrawerNavContent({
  current,
  activityRunning,
  workTodoCount = null,
  footer,
  onNavigate,
}: {
  current?: NavKey;
  activityRunning: boolean;
  /** 勤務の行に出す未対応の件数（`useWorkTodoCount`）。まだ読んでいなければ null。 */
  workTodoCount?: number | null;
  /** バージョンの行の上に置くもの（サイドバーの記録中カード）。 */
  footer?: React.ReactNode;
  /** 行を押したとき（ドロワーを閉じる）。 */
  onNavigate?: () => void;
}) {
  const navigateOffline = useOfflineNavigate();

  // 行はソフトナビゲーションで移動する。オフラインでは保存済みがあれば
  // ハードナビゲーションへ切り替える（issue #321。メインナビの項目と同じ扱い）。
  const handleClick = (href: string) => (event: React.MouseEvent) => {
    onNavigate?.();
    if (isPlainClick(event) && navigateOffline(href)) event.preventDefault();
  };

  return (
    <>
      <nav className="flex min-h-0 flex-col overflow-y-auto">
        <DrawerGroup>画面</DrawerGroup>
        {NAV_ITEMS.map((item) => (
          <DrawerItem
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={item.key === current}
            running={item.key === "activity" && activityRunning}
            badge={item.key === "work" && workTodoCount && workTodoCount > 0 ? workTodoCount : null}
            onClick={handleClick(item.href)}
          />
        ))}

        <DrawerGroup>そのほか</DrawerGroup>
        {/* 睡眠（docs/spec.md §39）は記録（/activity）の下位画面で、この区画の中でも
            いちばん「記録」に近い性質を持つため先頭に置く。以前は /activity のヘッダーの
            ボタンからしか開けず、ドロワーには出ていなかった（issue #620）。あちらのボタンは
            記録画面からの最短経路として残す。 */}
        <DrawerItem
          href="/activity/sleep"
          icon={Moon}
          label="睡眠"
          onClick={handleClick("/activity/sleep")}
        />
        {/* 日付リマインドは以前ここが「勤務」だった（issue #508）。勤務は出張・年休の申請漏れを
            気にする画面で開く頻度が高く、下部ナビへ移した。日付リマインドは一度登録すれば
            数年触らないため、毎日押さないこちらの区画へ入れ替えた。 */}
        <DrawerItem
          href="/reminders"
          icon={BellRing}
          label="日付"
          onClick={handleClick("/reminders")}
        />
        {/* 場所（docs/spec.md §9）。登録した地点を直す・消すための画面で、毎日押すものでは
            ないため下部ナビの5枠には入れない（設定を下部ナビから外したのと同じ理由）。 */}
        <DrawerItem
          href="/places"
          icon={MapPin}
          label="場所"
          onClick={handleClick("/places")}
        />
        <DrawerItem
          href="/settings"
          icon={Settings}
          label="設定"
          onClick={handleClick("/settings")}
        />
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        {footer}

        {/*
          バージョンはいちばん下に置く。押すとその版で何が変わったかを読める場所（更新履歴）へ入る。
          数字だけを出しても、変わった中身は結局設定から探すことになるため。
        */}
        <Link
          href="/settings/changelog"
          onClick={handleClick("/settings/changelog")}
          className="flex items-center gap-2 border-t border-outline-variant px-6 pt-3 text-on-surface-variant transition-colors hover:bg-on-surface/8"
        >
          <History className="size-4 shrink-0" />
          <span className="type-body-small flex-1">v{APP_VERSION}</span>
          <span className="type-body-small">更新履歴</span>
          <ChevronRight className="size-4 shrink-0" />
        </Link>
      </div>
    </>
  );
}

/**
 * 区画の見出し。画面の移動と、それ以外（勤務・場所・設定）は押す頻度も性質も違う。
 * 続けて並べると、毎日押す項目と月に一度の項目が同じ一続きの列に見える。
 */
function DrawerGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="type-label-small px-6 pt-3 pb-1 text-on-surface-variant">{children}</div>
  );
}

/** 記録中であることを示す印（下部ナビの記録の円に出しているものと同じ）。 */
export function RunningDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 animate-pulse rounded-full bg-primary", className)}
    />
  );
}

/** ドロワーの1行。押す対象は文字幅ではなく行の高さで確保する（設定画面の一覧と同じ）。 */
function DrawerItem({
  href,
  icon: Icon,
  label,
  badge,
  active = false,
  running = false,
  onClick,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** 開く前に片付けるものがあると分かる数字。0件のときは出さない。 */
  badge?: number | null;
  /** いまいる画面かどうか。色だけに頼らないよう aria-current も添える。 */
  active?: boolean;
  /** 記録中の印を出すか。 */
  running?: boolean;
  onClick: (event: React.MouseEvent) => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "mx-3 flex items-center gap-3 rounded-md px-4 py-3 transition-colors",
        active
          ? "bg-secondary-container text-on-secondary-container"
          : "text-on-surface hover:bg-on-surface/8",
      )}
    >
      <Icon className={cn("size-5 shrink-0", active ? undefined : "text-on-surface-variant")} />
      <span className="type-body-large flex-1">{label}</span>
      {running && <RunningDot />}
      {badge != null && (
        <span className="type-label-medium rounded-full bg-error-container px-2 py-0.5 tabular-nums text-on-error-container">
          {badge}
        </span>
      )}
    </Link>
  );
}
