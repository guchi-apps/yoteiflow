"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WorkPlaceLinkRow } from "@/lib/work-place-link";

export type LinkablePlace = { id: string; name: string; address: string | null };

/**
 * 勤務場所の正式名称の場所と省略名（issue #1382・docs/spec.md §46）。
 *
 * 場所DBの名前と勤務場所の名前が違っても、結び付けた場所の住所を勤務予定・移動で使う。
 * 場所DBへは書かない。省略名はカレンダーの狭い列の勤務チップが幅に応じて使う（空なら従来の表示）。
 */
export function WorkPlaceLinkFields({
  workPlace,
  places,
  link,
  onSaved,
}: {
  workPlace: string;
  places: LinkablePlace[];
  link: WorkPlaceLinkRow | null;
  onSaved: (links: WorkPlaceLinkRow[]) => void;
}) {
  const [placeId, setPlaceId] = useState(link?.placeId ?? "");
  const [short2, setShort2] = useState(link?.shortLabel2 ?? "");
  const [short1, setShort1] = useState(link?.shortLabel1 ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/work-place-links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workPlace,
          placeId: placeId || null,
          shortLabel2: short2,
          shortLabel1: short1,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        links?: WorkPlaceLinkRow[];
        message?: string;
      } | null;
      if (!response.ok || !body?.links) throw new Error(body?.message ?? "保存できませんでした。");
      onSaved(body.links);
      setMessage({ text: "保存しました。", error: false });
    } catch (caught) {
      setMessage({ text: caught instanceof Error ? caught.message : "保存できませんでした。", error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-outline-variant pt-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`link-${workPlace}`}>正式名称（場所に登録済みの場所）</Label>
        <select
          id={`link-${workPlace}`}
          className="type-body-medium h-10 rounded-md border border-outline-variant bg-surface px-3"
          value={placeId}
          onChange={(event) => setPlaceId(event.target.value)}
        >
          <option value="">結び付けない（同じ名前の場所を使う）</option>
          {places.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name}
              {place.address ? `（${place.address}）` : ""}
            </option>
          ))}
        </select>
        <p className="type-body-small text-on-surface-variant">
          勤務場所の名前が場所の名前と違っていても、ここで選んだ場所の住所を使います。場所は増えません。
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`short2-${workPlace}`}>省略名（2文字）</Label>
          <Input
            id={`short2-${workPlace}`}
            maxLength={2}
            placeholder="例: 本社"
            value={short2}
            onChange={(event) => setShort2(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`short1-${workPlace}`}>省略名（1文字）</Label>
          <Input
            id={`short1-${workPlace}`}
            maxLength={1}
            placeholder="例: 本"
            value={short1}
            onChange={(event) => setShort1(event.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={save}>
          正式名称・省略名を保存
        </Button>
        {message && (
          <span className={message.error ? "type-body-small text-error" : "type-body-small text-on-surface-variant"}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
