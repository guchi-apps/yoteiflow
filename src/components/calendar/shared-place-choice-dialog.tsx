"use client";

import { useState } from "react";
import { useOffline } from "next/offline";

import { readErrorMessage } from "@/components/calendar/response-error";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ShareHandoff } from "@/lib/share-import/handoff";

export type SharedPlace = Extract<ShareHandoff, { kind: "place" }>;

/**
 * Googleマップの場所を共有したときの選択画面（issue #1677）。
 * 名称と住所は分けた欄で確認・修正し、「予定を作る」か「場所として登録」を選ぶ。
 * どちらも名称・住所を別々に渡す（予定は名称→タイトル、`名称 住所`→場所欄）。
 */
export function SharedPlaceChoiceDialog({
  place,
  onClose,
  onCreateEvent,
}: {
  place: SharedPlace;
  onClose: () => void;
  onCreateEvent: (input: { name: string; address: string }) => void;
}) {
  const offline = useOffline();
  const [name, setName] = useState(place.title);
  const [address, setAddress] = useState(place.address);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const hasPoint = place.lat !== null && place.lng !== null;
  const canSubmit = name.trim() !== "" || address.trim() !== "" || hasPoint;

  const register = async () => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }
    // 場所DBの名前は必須。名称が空なら住所を名前に使う（地点だけの共有は名前を求める）
    const placeName = name.trim() || address.trim();
    if (!placeName) {
      setError("場所として登録するには、名称か住所を入力してください。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: placeName,
          address: name.trim() ? address.trim() || null : null,
          coordinates: hasPoint ? `${place.lat},${place.lng}` : null,
        }),
      });
      if (response.status === 404) {
        setError("NotionのDBに場所のデータベースが設定されていないため、登録できません。設定 ▸ Notion を確認してください。");
        return;
      }
      if (!response.ok) {
        setError(await readErrorMessage(response, "場所を登録できませんでした。"));
        return;
      }
      setDone(true);
    } catch {
      setError("場所を登録できませんでした。通信を確認してください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-y-auto">
        <DialogTitle>Googleマップから場所を追加</DialogTitle>
        <DialogDescription className="sr-only">
          共有された場所で予定を作るか、場所として登録するかを選びます。
        </DialogDescription>

        {done ? (
          <>
            <p className="type-body-medium">場所「{name.trim() || address.trim()}」を登録しました。</p>
            <Button onClick={onClose}>閉じる</Button>
          </>
        ) : (
          <>
            {error && (
              <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">{error}</p>
            )}
            <label className="type-label-medium flex flex-col gap-1">
              名称
              <Input value={name} onChange={(e) => setName(e.target.value)} onClear={() => setName("")} />
            </label>
            <label className="type-label-medium flex flex-col gap-1">
              住所
              <Input value={address} onChange={(e) => setAddress(e.target.value)} onClear={() => setAddress("")} />
            </label>
            {hasPoint && (
              <p className="type-body-small text-on-surface-variant">
                地点 {place.lat}, {place.lng}（登録時に一緒に保存します）
              </p>
            )}
            <Button disabled={!canSubmit || busy} onClick={() => onCreateEvent({ name, address })}>
              この場所で予定を作る
            </Button>
            <Button variant="secondary" disabled={!canSubmit || busy} onClick={() => void register()}>
              {busy ? "登録しています…" : "場所として登録する"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              キャンセル
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
