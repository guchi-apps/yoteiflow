"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Moon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatSleepMinutes } from "@/lib/sleep";
import type { ActivityPresetItem } from "@/types/activity";

/**
 * 睡眠の横通し表示の設定（docs/spec.md §39）。
 *
 * 活動記録の設定と同じ画面に置く。睡眠は活動記録の1項目そのもので、
 * どの項目を睡眠として数えるかは項目の一覧を見ながらでないと決められない。
 */
export function SleepSection({
  presets,
  title,
  targetMinutes,
}: {
  presets: ActivityPresetItem[];
  title: string;
  targetMinutes: number;
}) {
  const router = useRouter();

  const [name, setName] = useState(title);
  const [hours, setHours] = useState(String(Math.floor(targetMinutes / 60)));
  const [minutes, setMinutes] = useState(String(targetMinutes % 60));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 分の欄を空にしただけで保存できなくならないよう、空欄は0として扱う（年休の付与と同じ）。
  const target = Number(hours || 0) * 60 + Number(minutes.trim() === "" ? 0 : minutes);
  const invalid =
    name.trim().length === 0 || !Number.isInteger(target) || target < 60 || target > 16 * 60;

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/activities/sleep", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name.trim(), targetMinutes: target }),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        setError((body?.message as string) ?? "睡眠の設定を保存できませんでした。");
        return;
      }

      setSaved(true);
      // 睡眠の画面はサーバー側でこの設定を読む。開いたときに古い値で描かれないよう取り直させる。
      router.refresh();
    } catch {
      setError("睡眠の設定を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Moon className="size-5 text-on-surface-variant" />
          <h2 className="type-title-medium flex-1">睡眠</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/activity/sleep">記録を見る</Link>
          </Button>
        </div>

        {error && (
          <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <Input
            id="sleep-title"
            label="睡眠として数える項目名"
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
          />

          {/* 項目を消したり改名したりしても、その名前で残っている過去の記録は数えられる必要が
              あるため自由入力にする。ふだんは一覧から押して入れれば足りる。 */}
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setName(preset.name);
                    setSaved(false);
                  }}
                  className={cn(
                    "type-label-medium rounded-md border px-3 py-1 transition-colors",
                    preset.name === name.trim()
                      ? "border-transparent bg-secondary-container font-bold text-on-surface"
                      : "border-outline-variant text-on-surface-variant hover:bg-on-surface/8",
                  )}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          )}

          <p className="type-body-small text-on-surface-variant">
            この名前で保存された記録だけを睡眠として数えます。
          </p>
        </div>

        {/* 時と分を分けるのは、7.5 のような小数を打たせないため（所定労働時間と同じ・issue #537）。 */}
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Input
              id="sleep-target-hours"
              label="1晩の目標睡眠時間（時）"
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              max="16"
              value={hours}
              disabled={busy}
              onChange={(event) => {
                setHours(event.target.value);
                setSaved(false);
              }}
            />
            <Input
              id="sleep-target-minutes"
              label="（分）"
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              max="59"
              value={minutes}
              disabled={busy}
              onChange={(event) => {
                setMinutes(event.target.value);
                setSaved(false);
              }}
            />
          </div>
          <p className="type-body-small text-on-surface-variant">
            {invalid
              ? "目標睡眠時間は1時間〜16時間の範囲で入力してください。"
              : `1晩あたり${formatSleepMinutes(target)}を目標にします。すべての期間に効きます。`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" disabled={busy || invalid} onClick={save}>
            保存
          </Button>
          {saved && <span className="type-body-small text-on-surface-variant">保存しました</span>}
        </div>
      </CardContent>
    </Card>
  );
}
