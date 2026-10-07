"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INITIAL_CALENDAR_VIEW_OPTIONS,
  isInitialCalendarView,
  type InitialCalendarView,
} from "@/lib/calendar-initial-view";
import { WEEK_START_OPTIONS } from "@/lib/week-start";

const WIDE_QUERY = "(min-width: 768px)";

function subscribeWide(callback: () => void) {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function DisplaySection({
  weekStartsOn,
  defaultView,
}: {
  weekStartsOn: number;
  defaultView: InitialCalendarView;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(weekStartsOn);
  // 週表示を出せる幅（calendar-shell.tsx の desktopOnly と同じ768px）でだけ選択肢に出す。
  // サーバー描画では出さず、いま保存されている値のときは幅によらず出す（選択中の値が消えないよう）。
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
  const [view, setView] = useState(defaultView);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: number) => {
    const previous = value;
    await save({ weekStartsOn: next }, () => setValue(next), () => setValue(previous));
  };

  const changeView = async (next: string) => {
    if (!isInitialCalendarView(next)) return;
    const previous = view;
    await save({ defaultView: next }, () => setView(next), () => setView(previous));
  };

  const save = async (
    body: { weekStartsOn: number } | { defaultView: InitialCalendarView },
    apply: () => void,
    revert: () => void,
  ) => {
    // 応答を待ってから動かすと、選んだのに変わらない時間ができる。先に反映し、失敗したら戻す。
    apply();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/ui", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        revert();
        setError("設定を保存できませんでした。");
        return;
      }

      startTransition(() => router.refresh());
    } catch {
      revert();
      setError("設定を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="initial-view">カレンダーの初期表示</Label>
            <p className="type-body-small text-on-surface-variant">
              カレンダーを開いたときの表示形式です。週表示は幅の広い画面でだけ選べ、狭い画面では3日表示で開きます。画面内で切り替えても、この設定は変わりません。
            </p>
          </div>

          <Select value={view} onValueChange={changeView} disabled={busy || pending}>
            <SelectTrigger id="initial-view" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INITIAL_CALENDAR_VIEW_OPTIONS.filter(
                (option) => !option.desktopOnly || wide || option.value === view,
              ).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="week-starts-on">週の開始日</Label>
            <p className="type-body-small text-on-surface-variant">
              月表示・週表示で、いちばん左に置く曜日です。
            </p>
          </div>

          <Select
            value={String(value)}
            onValueChange={(next) => change(Number(next))}
            disabled={busy || pending}
          >
            <SelectTrigger id="week-starts-on" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEK_START_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
