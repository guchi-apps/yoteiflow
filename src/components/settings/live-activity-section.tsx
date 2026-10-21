"use client";

import { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  disableNativeLiveActivity,
  enableNativeLiveActivity,
  hasNativeLiveActivityBridge,
  nativeLiveActivityStatus,
  type NativeLiveActivityStatus,
} from "@/lib/native-live-activity";

/**
 * この端末でライブアクティビティ（記録中の表示・issue #971）を出すか（issue #1297）。
 *
 * 表示はアプリが端末ごとに持つため、iOSアプリの中（ブリッジがあるとき）だけ出す。
 * ブラウザ・PWA・ブリッジを持たない古いアプリでは何も描かない。
 */
export function LiveActivitySection() {
  // ブリッジの有無はブラウザでしか分からない。サーバーの描画と食い違わないよう、マウント後に読む
  const [status, setStatus] = useState<NativeLiveActivityStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasNativeLiveActivityBridge()) return;
    let cancelled = false;
    nativeLiveActivityStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;

  const toggle = async (checked: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = await (checked ? enableNativeLiveActivity() : disableNativeLiveActivity());
      setStatus(next);
      setError(next.error);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "切り替えられませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="live-activity-enabled">ライブアクティビティを表示</Label>
            <p className="type-body-small text-on-surface-variant">
              記録中の項目と経過時間を、この端末のロック画面とDynamic Islandに出します。
            </p>
          </div>
          <Switch
            id="live-activity-enabled"
            checked={status.supported && status.enabled}
            disabled={busy || !status.supported}
            onCheckedChange={(checked) => void toggle(checked)}
          />
        </div>

        {!status.supported ? (
          <p className="type-body-small rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
            iPhoneの「設定」でこのアプリのライブアクティビティが許可されていません。
          </p>
        ) : (
          !status.enabled && (
            <p className="type-body-small rounded-lg bg-surface-container px-3 py-2 text-on-surface-variant">
              オフの間は、記録を始めてもこの端末には表示されません。ほかの端末には影響しません。
            </p>
          )
        )}

        {error && (
          <p className="type-body-small rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
