"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WorkTrainItem } from "@/lib/work-sync/plan";
import { fromTime, toTime } from "@/lib/work-sync/form";
import { trainDuration, trainFromYahooText } from "@/lib/work-sync/train";

type Direction = "out" | "back";

/**
 * よく使う電車（issue #1347・docs/spec.md §46）。出発地 → 行き先ごとに、名前・出発時刻・到着時刻を
 * 複数登録する。勤務の入力で往路・復路に選ぶと、その時刻で移動を作る。時刻表は取りにいかず、
 * ここに入れた値だけを使う。所要時間は出発と到着から求める（到着が出発以前なら翌日着）。
 */
export function WorkTrains({
  trains: initial,
  home,
  place,
}: {
  trains: WorkTrainItem[];
  home: string | null;
  /** この電車の一覧が属する勤務先・出張先。往路は自宅 → place、復路は place → 自宅。 */
  place: string;
}) {
  const [trains, setTrains] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>("out");
  const [label, setLabel] = useState("");
  const [depart, setDepart] = useState("");
  const [arrive, setArrive] = useState("");
  const [note, setNote] = useState("");
  const [pasted, setPasted] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [pasteInfo, setPasteInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEditing(null);
    setLabel("");
    setDepart("");
    setArrive("");
    setNote("");
    setPasted("");
    setIsDefault(false);
    setPasteInfo(null);
    setError(null);
  };

  // Yahoo!乗換案内の経路を貼ると、時刻と詳細を入れる（結果ページは取得しない・issue #1371）。
  const readPasted = (text: string) => {
    setPasted(text);
    if (!text.trim()) return setPasteInfo(null);
    const parsed = trainFromYahooText(text);
    if (!parsed) return setPasteInfo("経路を読み取れませんでした。時刻を手で入力してください。");
    setDepart(toTime(parsed.departMinutes));
    setArrive(toTime((parsed.departMinutes + parsed.durationMinutes) % 1440));
    setNote(parsed.note);
    if (!label.trim() && parsed.label) setLabel(parsed.label);
    setPasteInfo(
      `読み取りました: ${toTime(parsed.departMinutes)} 発・${parsed.durationMinutes}分。内容を確かめて追加してください。`,
    );
  };

  const startEdit = (train: WorkTrainItem) => {
    setEditing(train.id);
    setDirection(train.origin === home ? "out" : "back");
    setLabel(train.label);
    setDepart(toTime(train.departMinutes));
    setArrive(toTime((train.departMinutes + train.durationMinutes) % 1440));
    setNote(train.note ?? "");
    setIsDefault(train.isDefault);
    setPasted("");
    setPasteInfo(null);
    setError(null);
  };

  const setDefault = (train: WorkTrainItem) =>
    request({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...train, isDefault: !train.isDefault }),
    });

  const request = async (init: RequestInit, url = "/api/settings/work-trains") => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, init);
      const body = (await response.json().catch(() => null)) as {
        trains?: WorkTrainItem[];
        message?: string;
      } | null;
      if (!response.ok || !body?.trains) throw new Error(body?.message ?? "保存できませんでした。");
      setTrains(body.trains);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存できませんでした。");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!home) return setError("先に設定の「移動」で既定の出発地を入れてください。");
    const target = place;
    const departMinutes = fromTime(depart);
    const arriveMinutes = fromTime(arrive);
    if (departMinutes === null || arriveMinutes === null) {
      return setError("出発・到着の時刻を入力してください。");
    }
    const ok = await request({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editing ?? undefined,
        origin: direction === "out" ? home : target,
        destination: direction === "out" ? target : home,
        label: label.trim(),
        departMinutes,
        durationMinutes: trainDuration(departMinutes, arriveMinutes),
        isDefault,
        note: note.trim() || null,
      }),
    });
    if (ok) reset();
  };

  const remove = async (id: string) => {
    if (await request({ method: "DELETE" }, `/api/settings/work-trains?id=${encodeURIComponent(id)}`)) {
      if (editing === id) reset();
    }
  };

  const shown = trains.filter(
    (train) =>
      (train.origin === home && train.destination === place) ||
      (train.origin === place && train.destination === home),
  );

  return (
    <div className="flex flex-col gap-3 border-t border-dashed border-outline-variant pt-3">
      <Label>電車</Label>
      <p className="type-body-small text-on-surface-variant">
        この場所で使う電車を登録しておくと、勤務の入力で往路・復路に選べます。選ぶと、勤務開始からの
        逆算ではなく、ここの出発時刻でカレンダーに移動を作ります。時刻表は取得しないので、時刻は
        自分で入れてください。
      </p>

      {shown.length === 0 && (
        <p className="type-body-small text-on-surface-variant">まだ登録がありません。</p>
      )}
      {shown.map((train) => {
        const out = train.origin === home;
        const arriveAt = (train.departMinutes + train.durationMinutes) % 1440;
        return (
          <div
            key={train.id}
            className={`flex items-center gap-3 rounded-xl border p-3 ${train.isDefault ? "border-primary bg-secondary-container" : "border-outline-variant"}`}
          >
            <button
              type="button"
              className="type-title-medium shrink-0 disabled:opacity-38"
              disabled={busy}
              aria-pressed={train.isDefault}
              aria-label={train.isDefault ? "デフォルトを外す" : "デフォルトにする"}
              onClick={() => setDefault(train)}
            >
              {train.isDefault ? "★" : "☆"}
            </button>
            <div className="min-w-0 flex-1">
              <p className="type-title-small tabular-nums">
                {toTime(train.departMinutes)} 発 → {toTime(arriveAt)} 着
                {train.isDefault && (
                  <span className="type-label-small ml-2 rounded-sm bg-primary px-2 py-0.5 text-on-primary">
                    デフォルト
                  </span>
                )}
              </p>
              <p className="type-body-small truncate text-on-surface-variant">
                {train.label}・{train.origin} → {train.destination}・{train.durationMinutes}分
                {out ? "（往路）" : train.destination === home ? "（復路）" : ""}
              </p>
              {train.note && (
                <p className="type-body-small mt-1 line-clamp-3 whitespace-pre-line border-l-4 border-outline-variant pl-2 text-on-surface-variant">
                  {train.note}
                </p>
              )}
            </div>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => startEdit(train)}>
              編集
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => remove(train.id)}>
              削除
            </Button>
          </div>
        );
      })}

      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-outline-variant p-3">
        <p className="type-title-small">{editing ? "電車を編集" : "電車を追加"}</p>
        <div className="flex gap-2">
          {(
            [
              ["out", "往路（自宅 → 行き先）"],
              ["back", "復路（行き先 → 自宅）"],
            ] as const
          ).map(([value, text]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={direction === value ? "secondary" : "outline"}
              aria-pressed={direction === value}
              onClick={() => setDirection(value)}
            >
              {text}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`train-paste-${place}`}>Yahoo!乗換案内の経路（任意）</Label>
          <Textarea
            id={`train-paste-${place}`}
            rows={3}
            placeholder="Yahoo!乗換案内の共有 ▸ コピーで得た経路をここに貼り付けると、時刻と詳細が入ります"
            value={pasted}
            onChange={(event) => readPasted(event.target.value)}
          />
          {pasteInfo && <p className="type-body-small text-on-surface-variant">{pasteInfo}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`train-label-${place}`}>名前（例: のぞみ）</Label>
          <Input id={`train-label-${place}`} value={label} onChange={(event) => setLabel(event.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`train-depart-${place}`}>出発時刻</Label>
            <Input id={`train-depart-${place}`} type="time" value={depart} onChange={(event) => setDepart(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`train-arrive-${place}`}>到着時刻</Label>
            <Input id={`train-arrive-${place}`} type="time" value={arrive} onChange={(event) => setArrive(event.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`train-note-${place}`}>詳細（乗換・路線・運賃など）</Label>
          <Textarea id={`train-note-${place}`} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <label className="type-body-medium flex items-center gap-2">
          <input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />
          この区間のデフォルトにする（勤務の入力で最初から選ばれます）
        </label>
        {error && <p className="type-body-small text-error">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={save}>
            {editing ? "更新" : "追加"}
          </Button>
          {editing && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={reset}>
              やめる
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
