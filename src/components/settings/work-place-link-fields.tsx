"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import type { WorkPlaceLinkRow } from "@/lib/work-place-link";

export type LinkablePlace = { id: string; name: string; address: string | null };

/**
 * 勤務場所の正式名称の場所と省略名（issue #1382・docs/spec.md §46）。
 *
 * 場所DBの名前と勤務場所の名前が違っても、結び付けた場所の住所を勤務予定・移動で使う。
 * 場所DBへは書かない。省略名（2文字・1文字）の入力欄は月表示の1文字（issue #1381）と重複するため外した（issue #1426）。
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  /** 選んだ時点で保存する（issue #1426。省略名の欄を外し、保存ボタンも要らなくなった）。 */
  const save = async (next: string) => {
    const before = placeId;
    setPlaceId(next);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/work-place-links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workPlace, placeId: next || null }),
      });
      const body = (await response.json().catch(() => null)) as {
        links?: WorkPlaceLinkRow[];
        message?: string;
      } | null;
      if (!response.ok || !body?.links) throw new Error(body?.message ?? "保存できませんでした。");
      onSaved(body.links);
      setMessage({ text: "保存しました。", error: false });
    } catch (caught) {
      setPlaceId(before);
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
          disabled={busy}
          onChange={(event) => void save(event.target.value)}
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
      {message && (
        <span className={message.error ? "type-body-small text-error" : "type-body-small text-on-surface-variant"}>
          {message.text}
        </span>
      )}
    </div>
  );
}
