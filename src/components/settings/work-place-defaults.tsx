"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Clock, ExternalLink, Footprints, Route } from "lucide-react";

import { FormRow, ToggleCard } from "@/components/calendar/event-form-row";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { matchPlaceByText } from "@/lib/place-text";
import { resolveYahooPlace, yahooTransitLink } from "@/lib/yahoo-transit-link";
import {
  initialLegWalkText,
  initialWalkText,
  nearestStationName,
  nearestStationWalk,
  placeForWorkPlace,
} from "@/lib/work-sync/place-walk";
import { WorkTrains } from "@/components/settings/work-trains";
import { fromTime, toTime } from "@/lib/work-sync/form";
import type { WorkTrainItem } from "@/lib/work-sync/plan";
import type { WorkPlaceLinkRow } from "@/lib/work-place-link";

import { WorkPlaceLinkFields, type LinkablePlace } from "./work-place-link-fields";
import { MODE_RANK_ORDER, pickDefaultRoute, transitBaseTrain, transitMinutes } from "@/lib/work-sync/route-modes";
import { MAX_TRAVEL_WALK_MINUTES, TRAVEL_MODES, TRAVEL_MODE_LABELS, type TravelMode } from "@/types/calendar";

export type WorkRouteRow = {
  id: string;
  origin: string;
  destination: string;
  mode: TravelMode;
  minutes: number;
  /** 組（出発地・行き先）の既定の移動方法か（issue #1447）。 */
  isDefault: boolean;
  /** 公共交通の徒歩の分（issue #1458）。電車があるとき minutes = 基準の電車 + これ。 */
  walkMinutes: number;
};

/** 1組（出発地・行き先）の、方法別の行の全体。保存後に組ごと置き換える。 */
export type SavedRoutePair = { origin: string; destination: string; routes: WorkRouteRow[] };

export type WorkPlaceDefaultRow = {
  key: string;
  isTrip: boolean;
  workEnabled: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
  outboundEnabled: boolean;
  returnEnabled: boolean;
  /** Yahoo!取り込みで足す徒歩の自宅側・勤務先側（issue #1471）。null は設定 ▸ 移動の共通値 */
  walkHomeMinutes: number | null;
  walkPlaceMinutes: number | null;
};

export type Entry = { key: string; isTrip: boolean };

type EntryForm = {
  workEnabled: boolean;
  start: string;
  end: string;
  outEnabled: boolean;
  backEnabled: boolean;
  /** 方法ごとの所要時間（分・入力途中の文字列。空は未登録）。 */
  outMinutes: Record<TravelMode, string>;
  backMinutes: Record<TravelMode, string>;
  /** 往路・復路のデフォルトの方法。 */
  outDefault: TravelMode;
  backDefault: TravelMode;
  /** 公共交通の徒歩（分・入力途中の文字列）。電車が登録済みの区間でだけ使う。 */
  outWalk: string;
  backWalk: string;
  /** Yahoo!取り込みで電車の前後に足す徒歩（入力途中の文字列。空は共通値・issue #1471） */
  importWalkHome: string;
  importWalkPlace: string;
  /** 方法ごとの「使う」チェック（issue #1707）。オフの方法は保存時に登録なしになる。入力値はオフ中も保持する。 */
  outModes: Record<TravelMode, boolean>;
  backModes: Record<TravelMode, boolean>;
};

type Leg = "out" | "back";

const minutesByMode = (rows: WorkRouteRow[]): Record<TravelMode, string> => ({
  CAR: String(rows.find((row) => row.mode === "CAR")?.minutes ?? ""),
  PUBLIC_TRANSIT: String(rows.find((row) => row.mode === "PUBLIC_TRANSIT")?.minutes ?? ""),
  WALK: String(rows.find((row) => row.mode === "WALK")?.minutes ?? ""),
  OTHER: String(rows.find((row) => row.mode === "OTHER")?.minutes ?? ""),
});

/**
 * 保存済みの公共交通行の徒歩分。電車が無い区間の行は walkMinutes が常に0で保存される（手入力が合計のため）ので、
 * 保存済みの値として扱うのは電車登録済みの区間だけ。それ以外は null（最寄り駅の値を初期値にする）。0分は有効値。
 */
const walkOf = (rows: WorkRouteRow[], hasTrains: boolean): number | null =>
  hasTrains ? (rows.find((row) => row.mode === "PUBLIC_TRANSIT")?.walkMinutes ?? null) : null;

const defaultModeOf = (rows: WorkRouteRow[]): TravelMode =>
  pickDefaultRoute(rows)?.mode ?? "PUBLIC_TRANSIT";

/**
 * 勤務先・出張先ごとの既定値（issue #1099・docs/spec.md §46）。勤務場所の詳細画面（issue #1405）の一部。
 *
 * 勤務時間・往路・復路のカレンダー反映の有無と、勤務開始・終了、往路・復路の所要時間を持つ。
 * 勤務入力で選ぶと、ここの値が初期表示になる。ここを変えても、保存済みの勤務記録・予定は
 * 変えない（記録ごとの値を優先し、すでに作った予定にも触れない）。時刻を空にすると共通設定を使う。
 * 移動の出発地は設定の「移動」の既定の出発地。在宅として扱う勤務先は移動を作らない。
 */
export function PlaceDefaultFields({
  entry,
  extra,
  remote,
  home,
  linkablePlaces,
  link,
  onSavedLinks,
  row,
  outRoutes,
  backRoutes,
  trains,
  onTrainsChanged,
  commonStart,
  commonEnd,
  onSavedDefaults,
  onSavedRoutes,
}: {
  entry: Entry;
  /** 勤務場所の選択肢に無い出張先（自由記述の行き先）。場所DBに当たらないため徒歩・紐づけは持たせない（issue #1475） */
  extra: boolean;
  remote: boolean;
  home: string | null;
  linkablePlaces: LinkablePlace[];
  link: WorkPlaceLinkRow | null;
  onSavedLinks: (links: WorkPlaceLinkRow[]) => void;
  row: WorkPlaceDefaultRow | null;
  outRoutes: WorkRouteRow[];
  backRoutes: WorkRouteRow[];
  trains: WorkTrainItem[];
  onTrainsChanged: (trains: WorkTrainItem[]) => void;
  commonStart: number;
  commonEnd: number;
  onSavedDefaults: (rows: WorkPlaceDefaultRow[]) => void;
  onSavedRoutes: (pairs: SavedRoutePair[]) => void;
}) {
  // 最寄り駅の徒歩分は、保存済みの値が無い欄の初期値にだけ使う（issue #1707）。
  const homePlace = home ? matchPlaceByText(home, linkablePlaces) : null;
  const workPlace = placeForWorkPlace(entry.key, link?.placeId ?? null, linkablePlaces);
  const homeWalk = nearestStationWalk(homePlace);
  const placeWalk = nearestStationWalk(workPlace);
  const legHasTrains = (kind: Leg) =>
    !!home &&
    trains.some((train) =>
      kind === "out"
        ? train.origin === home && train.destination === entry.key
        : train.origin === entry.key && train.destination === home,
    );
  const initialModes = (rows: WorkRouteRow[], kind: Leg): Record<TravelMode, boolean> => {
    const minutes = minutesByMode(rows);
    const hasTrains = legHasTrains(kind);
    return {
      CAR: minutes.CAR !== "",
      PUBLIC_TRANSIT: minutes.PUBLIC_TRANSIT !== "" || hasTrains,
      WALK: minutes.WALK !== "",
      OTHER: minutes.OTHER !== "",
    };
  };
  const [legOpen, setLegOpen] = useState<Record<Leg, boolean>>({ out: false, back: false });
  const [form, setForm] = useState<EntryForm>({
    outModes: initialModes(outRoutes, "out"),
    backModes: initialModes(backRoutes, "back"),
    workEnabled: row?.workEnabled ?? true,
    start: row?.startMinutes != null ? toTime(row.startMinutes) : "",
    end: row?.endMinutes != null ? toTime(row.endMinutes) : "",
    outEnabled: row?.outboundEnabled ?? true,
    backEnabled: row?.returnEnabled ?? true,
    outMinutes: minutesByMode(outRoutes),
    backMinutes: minutesByMode(backRoutes),
    outDefault: defaultModeOf(outRoutes),
    backDefault: defaultModeOf(backRoutes),
    outWalk: initialLegWalkText(walkOf(outRoutes, legHasTrains("out")), homeWalk, placeWalk),
    backWalk: initialLegWalkText(walkOf(backRoutes, legHasTrains("back")), homeWalk, placeWalk),
    importWalkHome: initialWalkText(row?.walkHomeMinutes, homeWalk),
    importWalkPlace: initialWalkText(row?.walkPlaceMinutes, placeWalk),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const patch = (next: Partial<EntryForm>) => {
    setForm((current) => ({ ...current, ...next }));
    setMessage(null);
  };

  /** 区間（往路: 自宅 → 勤務先、復路: 勤務先 → 自宅）によく使う電車があるか。あれば公共交通は電車＋徒歩で決まる。 */
  const trainsOf = (kind: Leg) =>
    home
      ? trains.filter((train) =>
          kind === "out"
            ? train.origin === home && train.destination === entry.key
            : train.origin === entry.key && train.destination === home,
        )
      : [];

  const save = async () => {
    const start = form.start ? fromTime(form.start) : null;
    const end = form.end ? fromTime(form.end) : null;
    if ((form.start && start === null) || (form.end && end === null)) {
      return setMessage({ text: "時刻が正しくありません。", error: true });
    }
    if ((start === null) !== (end === null)) {
      return setMessage({ text: "勤務開始と終了は、両方入れるか両方空にしてください。", error: true });
    }
    if (start !== null && end !== null && end <= start) {
      return setMessage({ text: "勤務終了は開始より後にしてください。", error: true });
    }
    const minutes = (text: string, label: string) => {
      if (text.trim() === "") return null;
      const value = Number(text);
      if (!Number.isInteger(value) || value < 1 || value > 1440) {
        throw new Error(`${label}の所要時間は1〜1440分で入力してください。`);
      }
      return value;
    };

    const importWalk = (text: string, label: string) => {
      if (text.trim() === "") return null;
      const value = Number(text);
      if (!Number.isInteger(value) || value < 0 || value > MAX_TRAVEL_WALK_MINUTES) {
        throw new Error(`${label}の徒歩は0〜${MAX_TRAVEL_WALK_MINUTES}分で入力してください。`);
      }
      return value;
    };

    setBusy(true);
    setMessage(null);
    try {
      const walkHomeMinutes = importWalk(form.importWalkHome, "自宅側");
      const walkPlaceMinutes = importWalk(form.importWalkPlace, entry.isTrip ? "出張先側" : "勤務先側");
      // 入力の検証は書き込みの前に済ませる（途中で失敗して一部だけ保存されるのを避ける）。
      const legs = remote || !home
        ? []
        : (
            [
              { kind: "out" as Leg, label: "往路", origin: home, destination: entry.key, existing: outRoutes },
              { kind: "back" as Leg, label: "復路", origin: entry.key, destination: home, existing: backRoutes },
            ] as const
          ).map((leg) => {
            const texts = leg.kind === "out" ? form.outMinutes : form.backMinutes;
            const legTrains = trainsOf(leg.kind);
            const walkText = leg.kind === "out" ? form.outWalk : form.backWalk;
            const walk = walkText.trim() === "" ? 0 : Number(walkText);
            if (!Number.isInteger(walk) || walk < 0 || walk > 720) {
              throw new Error(`${leg.label}の徒歩は0〜720分で入力してください。`);
            }
            const enabledModes = leg.kind === "out" ? form.outModes : form.backModes;
            const wanted = TRAVEL_MODES.flatMap((mode) => {
              // チェックを外した方法は登録なし（入力値は画面に残すが保存しない。電車の登録は消さない）。
              if (!enabledModes[mode]) return [];
              // 電車が登録済みの区間の公共交通は、電車＋徒歩で決まる（所要時間の入力は要らない）。
              if (mode === "PUBLIC_TRANSIT" && legTrains.length > 0) {
                return [{ mode, minutes: transitMinutes(legTrains, walk) ?? 1, walk }];
              }
              const value = minutes(texts[mode], `${leg.label}（${TRAVEL_MODE_LABELS[mode]}）`);
              return value === null ? [] : [{ mode, minutes: value, walk: 0 }];
            });
            const chosen = leg.kind === "out" ? form.outDefault : form.backDefault;
            // 未登録の方法はデフォルトにできない。登録済みの先頭（固定順）へ落とす。
            const defaultMode = wanted.some((item) => item.mode === chosen)
              ? chosen
              : MODE_RANK_ORDER.find((mode) => wanted.some((item) => item.mode === mode));
            return { ...leg, wanted, defaultMode };
          });

      const response = await fetch("/api/settings/work-place-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: entry.key,
          isTrip: entry.isTrip,
          workEnabled: form.workEnabled,
          startMinutes: start,
          endMinutes: end,
          outboundEnabled: form.outEnabled,
          returnEnabled: form.backEnabled,
          ...(remote || extra ? {} : { walkHomeMinutes, walkPlaceMinutes }),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        defaults?: WorkPlaceDefaultRow[];
        message?: string;
      } | null;
      if (!response.ok || !body?.defaults) throw new Error(body?.message ?? "保存できませんでした。");
      onSavedDefaults(body.defaults);

      if (home && !remote) {
        const pairs: SavedRoutePair[] = [];
        for (const leg of legs) {
          let latest: WorkRouteRow[] = leg.existing;
          // 外す方法を先に消し、次に既定でない方法、最後に既定の方法を書く（既定の付け替えを最後に確定する）。
          for (const old of leg.existing) {
            if (leg.wanted.some((item) => item.mode === old.mode)) continue;
            const res = await fetch(`/api/settings/work-routes?id=${encodeURIComponent(old.id)}`, {
              method: "DELETE",
            });
            const deleted = (await res.json().catch(() => null)) as { routes?: WorkRouteRow[] } | null;
            if (!res.ok) throw new Error("移動時間を削除できませんでした。");
            latest = deleted?.routes ?? latest.filter((row) => row.id !== old.id);
          }
          const ordered = [...leg.wanted].sort(
            (a, b) => Number(a.mode === leg.defaultMode) - Number(b.mode === leg.defaultMode),
          );
          for (const item of ordered) {
            const res = await fetch("/api/settings/work-routes", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                origin: leg.origin,
                destination: leg.destination,
                mode: item.mode,
                minutes: item.minutes,
                walkMinutes: item.walk,
                isDefault: item.mode === leg.defaultMode,
              }),
            });
            const routeBody = (await res.json().catch(() => null)) as {
              routes?: WorkRouteRow[];
              message?: string;
            } | null;
            if (!res.ok || !routeBody?.routes) {
              throw new Error(routeBody?.message ?? "移動時間を保存できませんでした。");
            }
            latest = routeBody.routes;
          }
          pairs.push({ origin: leg.origin, destination: leg.destination, routes: latest });
        }
        onSavedRoutes(pairs);
      }
      setMessage({ text: "保存しました。", error: false });
    } catch (caught) {
      setMessage({
        text: caught instanceof Error ? caught.message : "保存できませんでした。",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const homeStation = nearestStationName(homePlace);
  const placeStation = nearestStationName(workPlace);

  /** 公共交通のYahoo!乗換案内を開くリンク（日時なし）。地点の決め方は移動の入力と同じ resolveYahooPlace。 */
  const yahooLink = (kind: Leg) => {
    const homeSide = home ? resolveYahooPlace(home, linkablePlaces) : null;
    const placeSide = resolveYahooPlace(workPlace?.name ?? entry.key, linkablePlaces);
    return yahooTransitLink({
      origin: kind === "out" ? homeSide : placeSide,
      destination: kind === "out" ? placeSide : homeSide,
      departAt: "",
      arriveAt: "",
    });
  };

  /** 方法ごとの所要時間（分）。電車を登録済みの公共交通は電車＋徒歩。 */
  const legMinutes = (kind: Leg, mode: TravelMode): number | null => {
    const legTrains = mode === "PUBLIC_TRANSIT" ? trainsOf(kind) : [];
    if (legTrains.length > 0) {
      return transitMinutes(legTrains, Number(kind === "out" ? form.outWalk : form.backWalk) || 0);
    }
    const text = (kind === "out" ? form.outMinutes : form.backMinutes)[mode].trim();
    return text === "" || !Number.isFinite(Number(text)) ? null : Number(text);
  };

  /** 見出しに添える要約（デフォルトの方法と所要時間）。 */
  const legSummary = (kind: Leg): string => {
    const enabled = kind === "out" ? form.outModes : form.backModes;
    const chosen = kind === "out" ? form.outDefault : form.backDefault;
    const mode = enabled[chosen] ? chosen : MODE_RANK_ORDER.find((candidate) => enabled[candidate]);
    if (!mode) return "未登録";
    const minutes = legMinutes(kind, mode);
    return `${TRAVEL_MODE_LABELS[mode]}${minutes !== null ? ` ${minutes}分` : ""}`;
  };

  const renderMode = (kind: Leg, mode: TravelMode) => {
    const modesKey = kind === "out" ? "outModes" : "backModes";
    const minutesKey = kind === "out" ? "outMinutes" : "backMinutes";
    const defaultKey = kind === "out" ? "outDefault" : "backDefault";
    const walkKey = kind === "out" ? "outWalk" : "backWalk";
    const label = kind === "out" ? "往路" : "復路";
    const on = form[modesKey][mode];
    const legTrains = mode === "PUBLIC_TRANSIT" ? trainsOf(kind) : [];
    const base = transitBaseTrain(legTrains);
    const walkText = form[walkKey];
    const modeName = TRAVEL_MODE_LABELS[mode];
    const isDefault = on && form[defaultKey] === mode;
    return (
      <div key={mode} className="border-t border-outline-variant">
        <div className="flex min-h-12 items-center gap-3">
          <Checkbox
            aria-label={`${label}で${modeName}を使う`}
            checked={on}
            disabled={!home}
            onCheckedChange={(checked) => patch({ [modesKey]: { ...form[modesKey], [mode]: checked === true } })}
          />
          <span className="type-label-large">{modeName}</span>
          {isDefault && (
            <span className="type-label-small rounded-md bg-secondary-container px-2 py-0.5 text-on-secondary-container">
              デフォルト
            </span>
          )}
        </div>
        {on && (
          <div className="flex flex-col gap-3 pb-3 pl-8">
            {mode === "PUBLIC_TRANSIT" && (
              <div className="flex flex-col gap-1">
                <a
                  href={yahooLink(kind)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="type-label-large inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-md bg-primary px-4 text-on-primary"
                >
                  <ExternalLink className="size-4" />
                  Yahoo!乗換案内で調べる
                </a>
                <p className="type-body-small text-on-surface-variant">
                  {(kind === "out" ? homeStation : placeStation) && (kind === "out" ? placeStation : homeStation)
                    ? `${kind === "out" ? homeStation : placeStation} → ${kind === "out" ? placeStation : homeStation}で検索します。`
                    : "最寄り駅が未登録の側は、住所・座標で検索します。"}
                  調べた経路は下の「よく使う電車」へ貼り付けて登録します。
                </p>
              </div>
            )}
            {base ? (
              <div className="flex min-w-0 flex-col gap-1">
                <p className="type-body-small text-on-surface-variant">
                  電車 {base.durationMinutes}分（{base.label || "名前なし"}）＋ 徒歩（前後の合計）
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    variant="flat"
                    aria-label={`${label}の徒歩（分）`}
                    inputMode="numeric"
                    placeholder="0"
                    disabled={!home}
                    value={walkText}
                    onChange={(event) => patch({ [walkKey]: event.target.value })}
                  />
                  <span className="type-body-medium shrink-0 tabular-nums">
                    ＝ {transitMinutes(legTrains, Number(walkText) || 0) ?? "—"}分
                  </span>
                </div>
                <p className="type-body-small text-on-surface-variant">
                  勤務の自動生成で使う前後の合計です。最寄り駅の徒歩分が登録済みなら初期値に入っています。
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${kind}-${mode}-${entry.key}`}>所要時間（分）</Label>
                <Input
                  id={`${kind}-${mode}-${entry.key}`}
                  variant="flat"
                  aria-label={`${label}の所要時間（${modeName}・分）`}
                  inputMode="numeric"
                  placeholder="分"
                  disabled={!home}
                  value={form[minutesKey][mode]}
                  onChange={(event) => patch({ [minutesKey]: { ...form[minutesKey], [mode]: event.target.value } })}
                />
              </div>
            )}
            <div>
              <ToggleCard pressed={isDefault} onToggle={() => patch({ [defaultKey]: mode })}>
                {`${label}のデフォルトにする`}
              </ToggleCard>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderLeg = (kind: Leg) => {
    const enabledKey = kind === "out" ? "outEnabled" : "backEnabled";
    const label = kind === "out" ? "往路" : "復路";
    const open = legOpen[kind];
    return (
      <div key={kind} className="border-t border-outline-variant">
        <div className="flex min-h-12 items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            className="type-label-large flex min-h-12 min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => setLegOpen((current) => ({ ...current, [kind]: !current[kind] }))}
          >
            <span>{label}</span>
            <span className="type-body-small truncate font-normal text-on-surface-variant">
              {kind === "out" ? "自宅 → " : ""}
              {entry.key}
              {kind === "back" ? " → 自宅" : ""}
            </span>
            <span className="type-label-small shrink-0 rounded-md bg-surface-container-high px-2 py-0.5 font-normal">
              {legSummary(kind)}
            </span>
          </button>
          <Switch
            aria-label={`${label}をカレンダーへ反映`}
            checked={form[enabledKey]}
            onCheckedChange={(checked) => patch({ [enabledKey]: checked })}
          />
          <button
            type="button"
            aria-label={open ? `${label}を閉じる` : `${label}を開く`}
            className="flex size-9 shrink-0 items-center justify-center"
            onClick={() => setLegOpen((current) => ({ ...current, [kind]: !current[kind] }))}
          >
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>
        {open && (
          <div className="flex flex-col pb-2 pl-3">
            <p className="type-body-small pb-1 text-on-surface-variant">
              右のスイッチがカレンダーへの反映です。使う移動方法にチェックを入れると詳細が開きます。
            </p>
            {TRAVEL_MODES.map((mode) => renderMode(kind, mode))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col">
      <FormRow icon={<Clock />} divider={false}>
        <div className="flex flex-col gap-2">
          <span className="type-label-medium text-on-surface-variant">勤務時間</span>
          <div>
            <ToggleCard pressed={form.workEnabled} onToggle={() => patch({ workEnabled: !form.workEnabled })}>
              カレンダーへ反映
            </ToggleCard>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`start-${entry.key}`}>開始（空＝共通 {toTime(commonStart)}）</Label>
              <Input
                id={`start-${entry.key}`}
                variant="flat"
                type="time"
                value={form.start}
                onChange={(event) => patch({ start: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`end-${entry.key}`}>終了（空＝共通 {toTime(commonEnd)}）</Label>
              <Input
                id={`end-${entry.key}`}
                variant="flat"
                type="time"
                value={form.end}
                onChange={(event) => patch({ end: event.target.value })}
              />
            </div>
          </div>
        </div>
      </FormRow>

      {!extra && (
        <WorkPlaceLinkFields
          workPlace={entry.key}
          places={linkablePlaces}
          link={link}
          onSaved={onSavedLinks}
        />
      )}

      {!remote && (
        <FormRow icon={<Route />}>
          <div className="flex flex-col">
            <span className="type-label-medium text-on-surface-variant">
              移動{home ? `（出発地: ${home}）` : ""}
            </span>
            {!home && (
              <p className="type-body-small text-on-surface-variant">
                移動を反映するには、先に
                <Link href="/settings/travel" className="underline">
                  設定の「移動」
                </Link>
                で既定の出発地を入れてください。
              </p>
            )}
            {(["out", "back"] as const).map(renderLeg)}
            <p className="type-body-small pt-2 text-on-surface-variant">
              勤務入力で最初に選ばれるのはデフォルトの方法です。チェックを外した方法は登録なしになります（入力した値は保存するまで画面に残ります）。公共交通は、下の「よく使う電車」を登録すると、デフォルトの電車（★、無ければ出発が最も早い電車）の所要時間に徒歩を足した時間になります。
            </p>
          </div>
        </FormRow>
      )}

      {!remote && !extra && (
        <FormRow icon={<Footprints />}>
          <div className="flex flex-col gap-2">
            <span className="type-label-medium text-on-surface-variant">Yahoo!取り込み時の徒歩</span>
            <p className="type-body-small text-on-surface-variant">
              Yahoo!乗換案内で調べた経路を移動に反映するとき、電車の発着の前後に足す徒歩です。往路・復路とも使います。最寄り駅の徒歩分が登録済みなら初期値に入っています。空欄は設定 ▸ 移動の共通値になります。
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["自宅側（自宅と駅のあいだ）", "importWalkHome"],
                  [entry.isTrip ? "出張先側（駅と出張先のあいだ）" : "勤務先側（駅と勤務場所のあいだ）", "importWalkPlace"],
                ] as const
              ).map(([label, key]) => (
                <div key={key} className="flex flex-col gap-1">
                  <Label htmlFor={`${key}-${entry.key}`}>{label}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`${key}-${entry.key}`}
                      variant="flat"
                      inputMode="numeric"
                      placeholder="共通値"
                      value={form[key]}
                      onChange={(event) => patch({ [key]: event.target.value })}
                    />
                    <span className="type-body-medium shrink-0">分</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </FormRow>
      )}

      {!remote && (
        <div className="border-t border-outline-variant pt-3">
          <WorkTrains trains={trains} home={home} place={entry.key} canAdd onChange={onTrainsChanged} />
        </div>
      )}

      <div className="flex items-center gap-3 pt-4">
        <Button type="button" size="sm" disabled={busy} onClick={save}>
          保存
        </Button>
        {message && (
          <span
            className={
              message.error
                ? "type-body-small text-error"
                : "type-body-small text-on-surface-variant"
            }
          >
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
