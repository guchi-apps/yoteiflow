"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasNativeTransit, openTransitInNativeApp } from "@/lib/native-transit";
import { rememberTransitSession } from "@/lib/transit-search-session";
import { yahooTransitAppLink } from "@/lib/yahoo-transit-app";
import { yahooTransitLink, type YahooTransitPlace } from "@/lib/yahoo-transit-link";
import { toTime } from "@/lib/work-sync/form";
import type { WorkTrainItem } from "@/lib/work-sync/plan";
import { trainFromYahooText, type TrainFromText } from "@/lib/work-sync/train";
import { workTrainSearchAt, type WorkTrainLeg } from "@/lib/work-train-import";

const noSubscribe = () => () => {};

/** 端末の今日（YYYY-MM-DD）。押した時点で求める（描画に使うとサーバーとずれる）。 */
function localTodayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * 勤務先の区間（往路・復路）ごとの「よく使う電車」（issue #1347・#1716・docs/spec.md §46）。
 *
 * 公共交通の詳細の中に置き、登録済みの電車（★デフォルト・削除）と、Yahoo!乗換案内から取り込む入口を並べる。
 * 手で時刻を入れるフォームは持たない（#1716）。iOSアプリではYahoo!アプリを開き、選んだ経路を共有 ▸ YoteiFlow で
 * 戻すと、勤務先の登録画面の確認枠（`imported`）に入る。アプリ外は共有拡張が無いため、Web版で調べて
 * コピーした経路を「コピーした経路を取り込む」で読む（`trainFromYahooText`・結果ページは取得しない）。
 * 電車の時刻は電車そのものの発着で持ち、徒歩は呼び出し側の「徒歩（前後の合計）」で足す。
 */
export function LegTrains({
  leg,
  place,
  extra,
  origin,
  destination,
  originPlace,
  destinationPlace,
  searchMinutes,
  trains,
  imported,
  onImported,
  onChange,
}: {
  leg: WorkTrainLeg;
  /** 勤務先・出張先のキー（勤務同期の場所名） */
  place: string;
  extra: boolean;
  /** 電車のキー（往路は自宅 → place、復路は place → 自宅） */
  origin: string;
  destination: string;
  /** Yahoo!乗換案内に渡す地点（`resolveYahooPlace`） */
  originPlace: YahooTransitPlace | null;
  destinationPlace: YahooTransitPlace | null;
  /** 探す時刻（往路は勤務開始の到着・復路は勤務終了の出発。0時からの分） */
  searchMinutes: number;
  /** この区間の登録済みの電車 */
  trains: WorkTrainItem[];
  /** 取り込んだが未登録の電車（確認枠に出す） */
  imported: TrainFromText | null;
  onImported: (train: TrainFromText | null) => void;
  onChange: (trains: WorkTrainItem[]) => void;
}) {
  const native = useSyncExternalStore(noSubscribe, hasNativeTransit, () => false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [label, setLabel] = useState(imported?.label ?? "");
  const [isDefault, setIsDefault] = useState(false);
  const [shownImport, setShownImport] = useState(imported);
  // 取り込み直したら名前・デフォルトの初期値を合わせ直す（レンダー中に前回の値と比べる）
  if (shownImport !== imported) {
    setShownImport(imported);
    setLabel(imported?.label ?? "");
    setIsDefault(trains.length === 0);
  }

  // 共有から戻って確認枠が出たら、そこまでスクロールする（詳細画面の下のほうにあるため）
  const importRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (imported) importRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [imported]);

  const legLabel = leg === "out" ? "往路" : "復路";
  const basis = leg === "out" ? "arrive" : "depart";
  const sorted = [...trains].sort((a, b) => a.departMinutes - b.departMinutes);
  const canSearch = !!originPlace && !!destinationPlace;

  const request = async (init: RequestInit, url = "/api/settings/work-trains") => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(url, init);
      const body = (await response.json().catch(() => null)) as { trains?: WorkTrainItem[]; message?: string } | null;
      if (!response.ok || !body?.trains) throw new Error(body?.message ?? "保存できませんでした。");
      onChange(body.trains);
      return true;
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "保存できませんでした。");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const links = () => {
    const at = workTrainSearchAt(localTodayKey(), searchMinutes);
    const web = yahooTransitLink({
      origin: originPlace,
      destination: destinationPlace,
      departAt: basis === "depart" ? at : "",
      arriveAt: basis === "arrive" ? at : "",
      basis,
    });
    const app =
      originPlace && destinationPlace
        ? yahooTransitAppLink({ origin: originPlace, destination: destinationPlace, at, basis })
        : null;
    return { at, web, app };
  };

  const search = async () => {
    setMessage(null);
    const { at, web, app } = links();
    if (!native || !app) {
      window.open(web, "_blank", "noopener,noreferrer");
      return;
    }
    const session = rememberTransitSession(`${origin.split(/\s+/)[0]}→${destination.split(/\s+/)[0]}（${legLabel}の電車）`, {
      origin,
      destination,
      mode: "PUBLIC_TRANSIT",
      departAt: basis === "depart" ? at : "",
      arriveAt: basis === "arrive" ? at : "",
      workTrain: { place, leg, extra },
    });
    const opened = await openTransitInNativeApp({
      appUrl: app,
      webUrl: web,
      session: { id: session.id, label: session.label, expiresAt: session.expiresAt },
    });
    if (opened === "failed") setMessage("Yahoo!乗換案内を開けませんでした。");
  };

  const pasteFromClipboard = async () => {
    setMessage(null);
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return setMessage("クリップボードを読み取れませんでした。Yahoo!乗換案内の共有 ▸ コピーのあとに押してください。");
    }
    if (!text.trim()) return setMessage("クリップボードが空です。Yahoo!乗換案内の共有 ▸ コピーのあとに押してください。");
    const parsed = trainFromYahooText(text);
    if (!parsed) return setMessage("経路を読み取れませんでした。Yahoo!乗換案内の経路をコピーしてから押してください。");
    onImported(parsed);
  };

  const register = async () => {
    if (!imported) return;
    const ok = await request({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin,
        destination,
        label: label.trim(),
        departMinutes: imported.departMinutes,
        durationMinutes: imported.durationMinutes,
        isDefault,
        note: imported.note.trim() || null,
      }),
    });
    if (ok) onImported(null);
  };

  const toggleDefault = (train: WorkTrainItem) =>
    request({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...train, isDefault: !train.isDefault }),
    });

  const remove = (id: string) => request({ method: "DELETE" }, `/api/settings/work-trains?id=${encodeURIComponent(id)}`);

  return (
    <div className="flex flex-col gap-2">
      {imported && (
        <div ref={importRef} className="flex flex-col gap-2 rounded-xl border-2 border-primary bg-secondary-container/40 p-3">
          <p className="type-label-large text-primary">Yahoo!乗換案内から取り込んだ電車</p>
          <p className="type-title-small tabular-nums">
            {toTime(imported.departMinutes)} 発 → {toTime((imported.departMinutes + imported.durationMinutes) % 1440)} 着・
            {imported.durationMinutes}分
          </p>
          {imported.note && (
            <p className="type-body-small line-clamp-6 whitespace-pre-line border-l-4 border-outline-variant pl-2 text-on-surface-variant">
              {imported.note}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor={`train-label-${leg}-${place}`}>名前（区別するための呼び名）</Label>
            <Input
              id={`train-label-${leg}-${place}`}
              variant="flat"
              placeholder="例: 朝の通勤、定時後の帰り"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <label className="type-body-medium flex items-center gap-2">
            <Checkbox checked={isDefault} onCheckedChange={(checked) => setIsDefault(checked === true)} />
            {legLabel}のデフォルトの電車にする
          </label>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy || !label.trim()} onClick={register}>
              登録
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onImported(null)}>
              やめる
            </Button>
          </div>
        </div>
      )}

      {sorted.length > 0 ? (
        <>
          <p className="type-label-medium text-on-surface-variant">登録した電車（勤務の入力で選べます）</p>
          {sorted.map((train) => (
            <div
              key={train.id}
              className={`flex items-center gap-3 rounded-xl border p-2.5 ${train.isDefault ? "border-primary bg-secondary-container" : "border-outline-variant"}`}
            >
              <button
                type="button"
                className="type-title-medium shrink-0 disabled:opacity-38"
                disabled={busy}
                aria-pressed={train.isDefault}
                aria-label={train.isDefault ? "デフォルトを外す" : "デフォルトにする"}
                onClick={() => toggleDefault(train)}
              >
                {train.isDefault ? "★" : "☆"}
              </button>
              <div className="min-w-0 flex-1">
                <p className="type-title-small tabular-nums">
                  {toTime(train.departMinutes)} 発 → {toTime((train.departMinutes + train.durationMinutes) % 1440)} 着
                  {train.isDefault && (
                    <span className="type-label-small ml-2 rounded-sm bg-primary px-2 py-0.5 text-on-primary">デフォルト</span>
                  )}
                </p>
                <p className="type-body-small truncate text-on-surface-variant">
                  {train.label}・{train.durationMinutes}分
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => remove(train.id)}>
                削除
              </Button>
            </div>
          ))}
        </>
      ) : (
        !imported && <p className="type-body-small text-on-surface-variant">まだ電車がありません。</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!canSearch} onClick={search}>
          <ExternalLink className="size-4" />
          Yahoo!乗換案内で調べて取り込む
        </Button>
        {!native && (
          <Button type="button" variant="outline" disabled={busy} onClick={pasteFromClipboard}>
            コピーした経路を取り込む
          </Button>
        )}
      </div>
      <p className="type-body-small text-on-surface-variant">
        {canSearch
          ? `${originPlace?.name ?? origin} → ${destinationPlace?.name ?? destination}・次の平日の${toTime(searchMinutes)}${basis === "arrive" ? "着" : "発"}で検索します。`
          : "出発地・行き先の地点が決まらないため検索できません。"}
        {native
          ? "経路を選んで共有 ▸ YoteiFlow を押すと、ここに取り込まれます。"
          : "経路を選んで共有 ▸ コピーしたあと、「コピーした経路を取り込む」を押してください。"}
      </p>
      {message && <p className="type-body-small text-error">{message}</p>}
    </div>
  );
}
