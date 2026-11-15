import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, MapPinned } from "lucide-react";

import { WorkAutoSection } from "@/components/settings/work-auto-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadWritableCalendars } from "@/services/calendar/load";
import { getWorkAutoSettings } from "@/services/work-sync/settings";
import { SESSION_UNLINKED_LOGIN_PATH } from "@/lib/login-errors";

export default async function WorkSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ place?: string; extra?: string }>;
}) {
  const { place, extra } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_UNLINKED_LOGIN_PATH);

  const connection = await db.notionConnection.findUnique({ where: { userId: user.id } });
  if (!connection) redirect("/settings/notion");

  // 勤務先の編集は勤務画面の「勤務先の登録」へ移した（issue #1611）。以前の `?place=` の
  // リンク（ブックマーク）は同じ勤務先の詳細へ引き継ぐ。
  if (place) {
    redirect(`/work/places?place=${encodeURIComponent(place)}${extra === "1" ? "&extra=1" : ""}`);
  }

  const [autoSettings, calendars] = await Promise.all([
    getWorkAutoSettings(user.id),
    loadWritableCalendars(user.id),
  ]);

  return (
    <SettingsShell
      title="勤務"
      description="勤務記録から勤務予定・移動を自動で作る設定です。勤務先ごとの経路・所要時間は勤務画面で登録します。"
      wide
    >
      <Link
        href="/work/places"
        className="flex items-center gap-3 rounded-xl border border-outline-variant p-4 transition-colors hover:bg-surface-container"
      >
        <MapPinned className="size-5 shrink-0 text-primary" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="type-title-small">勤務先の登録</span>
          <span className="type-body-small text-on-surface-variant">
            勤務場所の色・出張扱い・往復の経路と所要時間・電車を、勤務先ごとに登録します。
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
      </Link>
      <WorkAutoSection settings={autoSettings} calendars={calendars} />
    </SettingsShell>
  );
}
