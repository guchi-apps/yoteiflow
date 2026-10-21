"use client";

import Link from "next/link";
import { Settings2 } from "lucide-react";

import { SleepChart } from "@/components/activity/sleep-chart";
import { SleepHealthButton } from "@/components/activity/sleep-health-button";
import { SleepTrendChart } from "@/components/activity/sleep-trend-chart";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { SettingsShell } from "@/components/settings/settings-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { weekdayLabel } from "@/lib/day-tone";
import {
  SLEEP_RANGE_DAYS,
  formatSleepDiff,
  formatSleepMinutes,
  formatSleepShort,
  offsetToClock,
  summarizeSleepNights,
  type SleepNight,
} from "@/lib/sleep";
import { cn } from "@/lib/utils";

/**
 * 睡眠の横通し表示（docs/spec.md §39）。
 *
 * 記録の画面（`/activity`）の下位画面。あちらが「いま始める・終える」ための画面なのに対し、
 * ここは「足りているか・毎晩どのくらいの時刻に寝ているか」を見るための画面で、開く理由が違う
 * （勤務画面と年休の取得状況の関係と同じ）。
 */
export function SleepScreen({
  nights,
  targetMinutes,
  todayKey,
  days,
  activityTitle,
  timeZone,
  exportedLabel,
  loadError = null,
}: {
  /** 古い順の行。 */
  nights: SleepNight[];
  targetMinutes: number;
  todayKey: string;
  days: number;
  /** 睡眠として数えている項目名。1件も無いときに何を探しているのかを示すために使う。 */
  activityTitle: string;
  /** 利用者のタイムゾーン。ヘルスケアに残る古い時間帯の日時を出すために使う。 */
  timeZone: string;
  /** 最後にヘルスケアへ送り終えた睡眠の終わり。設定タイムゾーンで整形済み。未送信なら null。 */
  exportedLabel: string | null;
  /** Googleから読めなかったときの理由。画面は開いたまま、何が起きたかだけを伝える。 */
  loadError?: string | null;
}) {
  useReconnectRefresh();
  // オフラインでもこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  useWarmOfflinePage("/activity/sleep");

  const summary = summarizeSleepNights(nights, targetMinutes);

  return (
    // 広い画面では幅を広げる（issue #636）。1行が24時間の横軸のため、幅がそのまま時刻の目盛りの
    // 細かさになる。
    <SettingsShell
      title="睡眠"
      backHref="/activity"
      backLabel="記録"
      wide
      actions={
        <>
          <SleepHealthButton title={activityTitle} timeZone={timeZone} exportedLabel={exportedLabel} />
          <Button variant="ghost" size="sm" asChild>
            <Link href="/settings/activities">
              <Settings2 className="size-4" />
              <span className="hidden sm:inline">設定</span>
            </Link>
          </Button>
        </>
      }
    >
      {loadError && (
        <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
          {loadError}
        </p>
      )}

      <Card>
        {/* 広い画面では平均と3つの数字を横1段に並べ、グラフを上へ詰める（issue #636）。 */}
        <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-8">
          {/* この画面を開く理由のほとんどが「足りているか」のため、平均をいちばん大きい字にする。 */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 lg:shrink-0">
            <span className="type-headline-small font-bold tabular-nums">
              {summary.averageMinutes === null ? "—" : formatSleepMinutes(summary.averageMinutes)}
            </span>
            <span className="type-body-small text-on-surface-variant">
              1晩あたり ·{" "}
              {/* 平均は記録のある夜だけで割る。分母を出さないと、何夜から出した数字なのかが読めない。 */}
              {summary.recordedCount === 0
                ? `直近${days}日に記録なし`
                : `記録のある${summary.recordedCount}夜 / ${summary.settledCount}夜`}
            </span>
          </div>

          <dl className="flex gap-2 border-t border-outline-variant pt-3 lg:flex-1 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <Stat
              label="目標との差"
              value={summary.diffMinutes === null ? "—" : formatSleepDiff(summary.diffMinutes)}
              negative={summary.diffMinutes !== null && summary.diffMinutes < 0}
            />
            <Stat
              label="目標未満の夜"
              value={
                summary.recordedCount === 0
                  ? "—"
                  : `${summary.belowTargetCount} / ${summary.recordedCount}夜`
              }
              negative={summary.belowTargetCount > 0}
            />
            <Stat
              label="就寝・起床"
              value={
                summary.medianBedOffset === null || summary.medianWakeOffset === null
                  ? "—"
                  : `${offsetToClock(summary.medianBedOffset)} → ${offsetToClock(summary.medianWakeOffset)}`
              }
              small
            />
          </dl>
        </CardContent>
      </Card>

      {/* 並べる日数はURLで決める。再読み込み・共有されたURLで見え方が変わらないようにするため
          （年休の年度と同じ扱い）。 */}
      <div className="flex gap-1.5">
        {SLEEP_RANGE_DAYS.map((value) => (
          <Link
            key={value}
            href={`/activity/sleep?days=${value}`}
            aria-current={value === days ? "page" : undefined}
            className={cn(
              "type-label-large rounded-full border px-4 py-1.5 transition-colors",
              value === days
                ? "border-transparent bg-secondary-container font-bold text-on-surface"
                : "border-outline-variant text-on-surface-variant hover:bg-on-surface/8",
            )}
          >
            {value}日
          </Link>
        ))}
      </div>

      {/* 判定に summary を使わない。あれは終わった夜だけを数えるため、いま睡眠を記録している
          最中（今夜の行に破線の帯がある）でも「記録がありません」になってしまう。 */}
      {nights.every((night) => night.segments.length === 0) && !loadError ? (
        <Card>
          <CardContent className="flex flex-col gap-2">
            <p className="type-title-medium">「{activityTitle}」の記録がありません</p>
            <p className="type-body-medium text-on-surface-variant">
              記録の画面で「{activityTitle}」を押して始め、起きたときに止めると、その時間帯が
              ここに並びます。別の名前で記録している場合は、設定の活動記録で名前を合わせてください。
            </p>
            <div className="flex gap-2 pt-1">
              <Button asChild size="sm">
                <Link href="/activity">記録へ</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/settings/activities">設定へ</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <SleepChart nights={nights} targetMinutes={targetMinutes} todayKey={todayKey} />

          {/* 追加の分析（issue #1303）。数字は上のカードと同じ summary から出し、取得は増やさない。 */}
          <Card>
            <CardContent className="flex flex-col gap-3">
              <h2 className="type-title-small font-bold">睡眠時間の推移</h2>
              <SleepTrendChart nights={nights} targetMinutes={targetMinutes} />
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <div className="min-w-0">
                  <dt className="type-label-medium text-on-surface-variant">睡眠負債</dt>
                  <dd
                    className={cn(
                      "type-title-medium font-bold tabular-nums",
                      summary.debtMinutes !== null && summary.debtMinutes > 0 && "text-error",
                    )}
                  >
                    {summary.debtMinutes === null
                      ? "—"
                      : summary.debtMinutes === 0
                        ? "不足なし"
                        : `計 ${formatSleepMinutes(summary.debtMinutes)}`}
                  </dd>
                  {summary.debtMinutes !== null && summary.debtMinutes > 0 && (
                    <dd className="type-body-small text-on-surface-variant">
                      目標に足りなかった{summary.belowTargetCount}夜の合計
                    </dd>
                  )}
                </div>
                <div className="min-w-0">
                  <dt className="type-label-medium text-on-surface-variant">最長・最短</dt>
                  <ExtremeNight label="最長" night={summary.longest} />
                  <ExtremeNight label="最短" night={summary.shortest} />
                </div>
              </dl>
            </CardContent>
          </Card>
        </>
      )}
    </SettingsShell>
  );
}

function ExtremeNight({
  label,
  night,
}: {
  label: string;
  night: { dateKey: string; minutes: number } | null;
}) {
  if (!night) return <dd className="type-title-medium font-bold">—</dd>;

  const [, month, day] = night.dateKey.split("-");

  return (
    <dd className="tabular-nums">
      <span className="type-body-medium">{label} </span>
      <span className="type-title-medium font-bold">{formatSleepShort(night.minutes)}</span>
      <span className="type-body-small ml-1 text-on-surface-variant">
        {Number(month)}/{Number(day)}({weekdayLabel(night.dateKey)})
      </span>
    </dd>
  );
}

function Stat({
  label,
  value,
  negative = false,
  small = false,
}: {
  label: string;
  value: string;
  negative?: boolean;
  small?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <dt className="type-label-small text-on-surface-variant">{label}</dt>
      <dd
        className={cn(
          "font-bold",
          small ? "type-body-medium" : "type-title-medium",
          negative && "text-error",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
