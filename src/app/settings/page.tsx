import type { ComponentType, ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  Briefcase,
  CalendarDays,
  ChevronRight,
  Diamond,
  HeartPulse,
  History,
  LayoutGrid,
  ListTodo,
  NotebookPen,
  ShoppingCart,
  Timer,
  UserRound,
} from "lucide-react";

import { SettingsShell } from "@/components/settings/settings-shell";
import { AttentionDot } from "@/components/settings/attention-dot";
import { Card } from "@/components/ui/card";
import { countNotionActions } from "@/lib/notion-action-needed";
import type { PropertyMap } from "@/services/notion/task-database";
import type { PlacePropertyMap } from "@/services/notion/place-database";
import type { ShoppingPropertyMap } from "@/services/notion/shopping-database";
import type { WorkPropertyMap } from "@/services/notion/work-database";
import { WIDE_TWO_COLUMN_ROW_CLASS } from "@/components/ui/wide-section";
import { APP_VERSION } from "@/lib/app-version";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { resolveInternalPath, START_PATH_COOKIE, startPathLabel } from "@/lib/home-path";
import { getNotificationSettings } from "@/services/notifications/settings";
import { countNotificationDevices } from "@/services/notifications/subscriptions";
import { weekStartLabel } from "@/lib/week-start";
import { TRAVEL_MODE_LABELS } from "@/types/calendar";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  // 一覧では外部APIを叩かない。カレンダー一覧やタスクDB一覧の取得はそれぞれの画面へ入って
  // からで足り、ここで待たせるとGoogle / Notionが遅い日は設定を開くこと自体ができなくなる。
  const [
    googleAccounts,
    notionConnection,
    uiSetting,
    activityPresetCount,
    pushDeviceCount,
    notificationSettings,
    cookieStore,
  ] = await Promise.all([
    db.googleAccount.findMany({ where: { userId: user.id }, select: { email: true } }),
    db.notionConnection.findUnique({ where: { userId: user.id } }),
    db.uiSetting.findUnique({ where: { userId: user.id } }),
    db.activityPreset.count({ where: { userId: user.id } }),
    countNotificationDevices(user.id),
    getNotificationSettings(user.id),
    cookies(),
  ]);

  // 保存済みの対応付けだけで数える（外部APIの往復を足さない）。最大24時間遅れうる目安。
  const notionActionCount = notionConnection
    ? countNotionActions({
        taskDataSourceId: notionConnection.taskDataSourceId,
        propertyMap: notionConnection.propertyMap as PropertyMap | null,
        placeDataSourceId: notionConnection.placeDataSourceId,
        placePropertyMap: notionConnection.placePropertyMap as PlacePropertyMap | null,
        workDataSourceId: notionConnection.workDataSourceId,
        workPropertyMap: notionConnection.workPropertyMap as WorkPropertyMap | null,
        shoppingDataSourceId: notionConnection.shoppingDataSourceId,
        shoppingPropertyMap: notionConnection.shoppingPropertyMap as ShoppingPropertyMap | null,
      })
    : 0;

  const startPathCookieValue = cookieStore.get(START_PATH_COOKIE)?.value;
  // 設定画面の戻り先はアプリの起点（起動画面）で揃える（docs/spec.md §4）。
  const startPath = resolveInternalPath(undefined, startPathCookieValue);

  return (
    // 広い画面では行を2列に並べる（issue #636）。各項目の中身の画面は入力欄が並ぶため従来の幅のまま。
    <SettingsShell title="設定" backHref={startPath} backLabel={startPathLabel(startPathCookieValue)} wide>
      {/*
        共通設定・外部連携・機能ごとの設定の3区分に分ける（issue #706）。以前は11項目が
        見出しなくフラットに並んでおり、どこで何が設定できるか分かりにくかった。
        タグ・種類・カテゴリの選択肢管理（旧「タグ」1項目）は、タスク・日付リマインド・
        勤務・買い物リストそれぞれの設定サブページへ分散させた（場所のタグは `/places` の
        ヘッダーから開く専用ページに置くため、ここには出さない）。
      */}
      <SettingsSection heading="共通設定">
        <Card className="gap-0 py-0 lg:grid lg:grid-cols-2">
          <MenuItem
            href="/settings/account"
            icon={UserRound}
            label="アカウント"
            value={user.email ?? "ログイン中"}
          />
          <MenuItem
            href="/settings/display"
            icon={LayoutGrid}
            label="表示"
            value={`起動画面: ${startPathLabel(startPathCookieValue)} / 週の開始日: ${weekStartLabel(uiSetting?.weekStartsOn ?? 0)}`}
          />
          {/* 通知はGoogle・Notionが未接続でも開ける。許可そのものは端末ごとに持つため、
              この行には「この端末で受け取っているか」ではなく登録済みの端末の数を出す。 */}
          <MenuItem
            href="/settings/notifications"
            icon={Bell}
            label="通知"
            value={
              pushDeviceCount === 0
                ? "未設定"
                : notificationSummary(notificationSettings, pushDeviceCount)
            }
          />
          <MenuItem
            href="/settings/changelog"
            icon={History}
            label="更新履歴"
            value={`v${APP_VERSION}`}
          />
        </Card>
      </SettingsSection>

      <SettingsSection heading="外部連携">
        <Card className="gap-0 py-0 lg:grid lg:grid-cols-2">
          <MenuItem
            href="/settings/google"
            icon={CalendarDays}
            label="Google Calendar"
            value={
              googleAccounts.length === 0
                ? "未接続"
                : googleAccounts.length === 1
                  ? googleAccounts[0].email
                  : `${googleAccounts.length}件のアカウント`
            }
          />
          <MenuItem
            href="/settings/notion"
            icon={NotebookPen}
            label="Notion"
            attention={notionActionCount > 0}
            value={
              !notionConnection
                ? "未接続"
                : !notionConnection.taskDataSourceId
                  ? "タスクDB未選択"
                  : (notionConnection.taskTitle ?? "接続済み")
            }
          />
        </Card>
      </SettingsSection>

      <SettingsSection heading="機能ごとの設定">
        <Card className="gap-0 py-0 lg:grid lg:grid-cols-2">
          {/* タグ・種類・カテゴリの選択肢はNotionのプロパティ定義そのもので、DB単位の
              未接続はページ内の案内文で吸収する。行の表示・非表示はNotion全体の接続の
              有無で揃える（以前の「タグ」項目と同じ条件）。 */}
          {notionConnection && (
            <>
              <MenuItem
                href="/settings/tasks"
                icon={ListTodo}
                label="タスク"
                value={notionConnection.taskTitle ?? "タグを色つきで登録"}
              />
              <MenuItem
                href="/settings/reminders"
                icon={Diamond}
                label="日付リマインド"
                value={notionConnection.reminderTitle ?? "種類を色つきで登録"}
              />
              <MenuItem
                href="/settings/work"
                icon={Briefcase}
                label="勤務"
                value={notionConnection.workTitle ?? "勤務場所を色つきで登録"}
              />
              <MenuItem
                href="/settings/shopping"
                icon={ShoppingCart}
                label="買い物リスト"
                value={notionConnection.shoppingTitle ?? "カテゴリを色つきで登録"}
              />
            </>
          )}
          {/* 記録の保存先はGoogle Calendar。未接続では保存先が選べないため、行ごと出さない。 */}
          {googleAccounts.length > 0 && (
            <MenuItem
              href="/settings/activities"
              icon={Timer}
              label="活動記録"
              value={
                activityPresetCount === 0
                  ? "項目なし"
                  : `${activityPresetCount}件の項目`
              }
            />
          )}
          {/* 移動の本体はDaySpanのDBにあるため、Google・Notionが未接続でも使える。常に出す。 */}
          <MenuItem
            href="/settings/travel"
            icon={ArrowRight}
            label="移動"
            value={
              uiSetting?.travelDefaultOrigin
                ? `${uiSetting.travelDefaultOrigin}から / ${TRAVEL_MODE_LABELS[uiSetting.travelDefaultMode]}`
                : `既定の交通手段: ${TRAVEL_MODE_LABELS[uiSetting?.travelDefaultMode ?? "PUBLIC_TRANSIT"]}`
            }
          />
          {/* 連携はiOSアプリ（HealthKit）が行う。Webでは使えない旨を案内するだけで、常に出す。 */}
          <MenuItem
            href="/settings/health"
            icon={HeartPulse}
            label="ヘルスケア"
            value="睡眠をiPhoneのヘルスケアと連携"
          />
        </Card>
      </SettingsSection>
    </SettingsShell>
  );
}

/** 通知の行に出す現在の値。何を知らせているのかが、開かなくても分かるようにする。 */
function notificationSummary(
  settings: { eventEnabled: boolean; taskEnabled: boolean },
  deviceCount: number,
): string {
  const targets = [
    settings.eventEnabled ? "予定" : null,
    settings.taskEnabled ? "タスク" : null,
  ].filter(Boolean);

  const devices = `${deviceCount}台`;
  return targets.length === 0 ? `${devices} / 知らせない` : `${devices} / ${targets.join("・")}`;
}

/** 見出し付きの区分。1つの区分が空になることは無いため、空のときの扱いは持たない。 */
function SettingsSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="type-title-small px-1 text-on-surface-variant">{heading}</h2>
      {children}
    </section>
  );
}

/**
 * 一覧の1行。現在の値を行に出しておき、開かなくても設定の状態が分かるようにする。
 * 行全体をリンクにするのは、指で押す対象を文字幅ではなく行の高さで確保するため。
 */
function MenuItem({
  href,
  icon: Icon,
  label,
  value,
  attention = false,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  /** 操作が必要なことを示す丸印を出す（issue #1171）。 */
  attention?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 px-4 py-3.5 transition-colors not-last:border-b not-last:border-outline-variant hover:bg-on-surface/8",
        WIDE_TWO_COLUMN_ROW_CLASS,
      )}
    >
      <Icon className="size-5 shrink-0 text-on-surface-variant" />

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-body-large flex items-center gap-2">
          {label}
          {attention && <AttentionDot />}
        </span>
        <span className="type-body-small truncate text-on-surface-variant">{value}</span>
      </div>

      <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
    </Link>
  );
}
