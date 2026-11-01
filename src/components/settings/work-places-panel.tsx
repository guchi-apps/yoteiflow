"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, ExternalLink, Plus, Trash2, X } from "lucide-react";

import { TagChip } from "@/components/tags/tag-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/settings/tag-section";
import {
  PlaceDefaultFields,
  type Entry,
  type WorkPlaceDefaultRow,
  type WorkRouteRow,
} from "@/components/settings/work-place-defaults";
import type { LinkablePlace } from "@/components/settings/work-place-link-fields";
import type { WorkPlaceLinkRow } from "@/lib/work-place-link";
import type { WorkTrainItem } from "@/lib/work-sync/plan";
import { pickDefaultRoute } from "@/lib/work-sync/route-modes";
import { summarizePlace } from "@/lib/work-place-summary";
import { isSingleCharacter } from "@/lib/work-short-label";
import type { TagColor, TagOption } from "@/services/notion/tag-options";

/** 一覧で選んでいる場所。`extra` は勤務場所の選択肢に無い出張先（同名の勤務場所と区別する）。 */
export type PlaceSelection = { key: string; extra: boolean };

type PanelEntry = Entry & { extra: boolean; option: TagOption | null };

/**
 * 入力してから✓で確定する欄（issue #1426）。名前と月表示の1文字を同じ動線にそろえる。
 *
 * 入力中は何文字でも打てる（変換中の文字数を縛らない）。✓が押せるのは、値が変わっていて
 * `validate` が通るときだけ。Enterで確定・Esc／✕で取り消し。確定して親の値が変わると、
 * 呼び出し側の `key` で作り直される（下書きを親の値に合わせ直すためにeffectを使わない）。
 */
function ConfirmField({
  value,
  ariaLabel,
  placeholder,
  inputClassName,
  disabled,
  validate,
  onConfirm,
}: {
  value: string;
  ariaLabel: string;
  placeholder?: string;
  inputClassName?: string;
  disabled?: boolean;
  validate: (draft: string) => string | null;
  onConfirm: (draft: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const trimmed = draft.trim();
  const dirty = trimmed !== value;
  const problem = dirty ? validate(trimmed) : null;
  const canConfirm = dirty && !problem && !disabled;
  const confirm = () => {
    if (canConfirm) void onConfirm(trimmed);
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <Input
          className={`h-10 min-w-0 ${inputClassName ?? "flex-1"}`}
          aria-label={ariaLabel}
          aria-invalid={problem ? true : undefined}
          placeholder={placeholder}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              confirm();
            }
            if (event.key === "Escape") setDraft(value);
          }}
        />
        <Button size="icon-sm" aria-label={`${ariaLabel}を確定`} disabled={!canConfirm} onClick={confirm}>
          <Check className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${ariaLabel}の変更を取り消す`}
          disabled={!dirty}
          onClick={() => setDraft(value)}
        >
          <X className="size-4" />
        </Button>
      </div>
      {problem && <p className="type-body-small text-error">{problem}</p>}
    </div>
  );
}

const placeUrl = (selection: PlaceSelection | null) =>
  selection
    ? `/settings/work?place=${encodeURIComponent(selection.key)}${selection.extra ? "&extra=1" : ""}`
    : "/settings/work";

/**
 * 設定 ▸ 勤務の「勤務場所」（issue #1405）。
 *
 * 場所ごとの設定（月表示の1文字・出張扱い・在宅扱い・勤務時間・往路復路・電車・正式名称）を
 * 1つの詳細画面にまとめ、一覧のカードから開く。一覧の要約と詳細は同じ値を読み書きするため、
 * 状態はこの1か所が持つ。詳細は選んでいないものも描いたまま隠し、入力途中の値と電車の一覧を
 * 場所を行き来しても失わない。URLは `history` で合わせ、サーバーの再取得（Notion）は走らせない。
 */
export function WorkPlacesPanel({
  initialSelection,
  options: initialOptions,
  missingMessage,
  databaseUrl,
  tripAvailable,
  tripPlaces: initialTripPlaces,
  shortLabels: initialShortLabels,
  remotePlaces: initialRemotePlaces,
  home,
  commonStart,
  commonEnd,
  defaults: initialDefaults,
  routes: initialRoutes,
  trains: initialTrains,
  links: initialLinks,
  linkablePlaces,
}: {
  initialSelection: PlaceSelection | null;
  options: TagOption[] | null;
  missingMessage: string;
  databaseUrl: string | null;
  tripAvailable: boolean;
  tripPlaces: string[];
  shortLabels: Record<string, string>;
  remotePlaces: string[];
  home: string | null;
  commonStart: number;
  commonEnd: number;
  defaults: WorkPlaceDefaultRow[];
  routes: WorkRouteRow[];
  trains: WorkTrainItem[];
  links: WorkPlaceLinkRow[];
  linkablePlaces: LinkablePlace[];
}) {
  const [options, setOptions] = useState(initialOptions);
  const [tripPlaces, setTripPlaces] = useState(initialTripPlaces);
  const [shortLabels, setShortLabels] = useState(initialShortLabels);
  const [remotePlaces, setRemotePlaces] = useState(initialRemotePlaces);
  const [defaults, setDefaults] = useState(initialDefaults);
  const [routes, setRoutes] = useState(initialRoutes);
  const [trains, setTrains] = useState(initialTrains);
  const [links, setLinks] = useState(initialLinks);
  const [extra, setExtra] = useState<string[]>([]);
  const [selected, setSelected] = useState(initialSelection);

  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("default");
  const [newTrip, setNewTrip] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 戻る・進むで一覧と詳細を行き来する。
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const key = params.get("place");
      setSelected(key ? { key, extra: params.get("extra") === "1" } : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const select = (next: PlaceSelection | null, mode: "push" | "replace" = "push") => {
    setSelected(next);
    setError(null);
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", placeUrl(next));
    if (mode === "push") window.scrollTo(0, 0);
  };

  // ── 一覧の組み立て ──────────────────────────────────────────────
  const optionNames = (options ?? []).map((option) => option.name);
  const entries: PanelEntry[] = (options ?? []).map((option) => ({
    key: option.name,
    isTrip: tripPlaces.includes(option.name),
    extra: false,
    option,
  }));
  const extraEntries: PanelEntry[] = [];
  const addExtra = (key: string, isTrip: boolean) => {
    if (!key || optionNames.includes(key) || extraEntries.some((entry) => entry.key === key)) return;
    extraEntries.push({ key, isTrip, extra: true, option: null });
  };
  defaults.forEach((row) => addExtra(row.key, row.isTrip));
  routes.forEach((route) => {
    if (route.origin === home) addExtra(route.destination, true);
  });
  trains.forEach((train) => {
    if (train.origin === home) addExtra(train.destination, true);
    else if (train.destination === home) addExtra(train.origin, true);
  });
  extra.forEach((key) => addExtra(key, true));
  const allEntries = [...entries, ...extraEntries];

  const isSelected = (entry: PanelEntry) =>
    selected !== null && selected.key === entry.key && selected.extra === entry.extra;
  const current = allEntries.find(isSelected) ?? null;

  // ── Notionの選択肢（追加・改名・削除・並び替え）──────────────────────
  const send = async (request: Promise<Response>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await request;
      const body = (await response.json().catch(() => null)) as {
        options?: TagOption[];
        message?: string;
      } | null;
      if (!response.ok) {
        setError(body?.message ?? "Notionへ反映できませんでした。");
        return false;
      }
      setOptions(body?.options ?? []);
      return true;
    } catch {
      setError("Notionへ反映できませんでした。");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const tagsRequest = (method: string, body: unknown) =>
    fetch("/api/notion/tags", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (optionNames.includes(trimmed)) {
      setError(`「${trimmed}」はすでにあります。`);
      return;
    }
    if (await send(tagsRequest("POST", { kind: "work", name: trimmed, color }))) setName("");
  };

  const remove = async (target: string) => {
    const confirmed = window.confirm(
      `「${target}」を削除します。\nこれが付いているNotionのページからも外れます。よろしいですか？`,
    );
    if (!confirmed) return;
    const removed = await send(
      fetch(`/api/notion/tags?kind=work&name=${encodeURIComponent(target)}`, { method: "DELETE" }),
    );
    if (!removed) return;
    // サーバーは出張扱いと1文字を落とす。ここの一覧も合わせる。
    setTripPlaces((places) => places.filter((place) => place !== target));
    setShortLabels((labels) => {
      const rest = { ...labels };
      delete rest[target];
      return rest;
    });
    select(null, "replace");
  };

  const rename = async (option: TagOption, trimmed: string) => {
    if (!trimmed || trimmed === option.name) return;
    if (!(await send(tagsRequest("PATCH", { kind: "work", optionId: option.id, name: trimmed })))) return;
    setTripPlaces((places) => places.map((place) => (place === option.name ? trimmed : place)));
    setShortLabels((labels) => {
      const { [option.name]: label, ...rest } = labels;
      return label === undefined ? rest : { ...rest, [trimmed]: label };
    });
    // URLのキーを新しい名前へ置き換える。
    select({ key: trimmed, extra: false }, "replace");
  };

  const move = async (index: number, delta: number) => {
    if (!options) return;
    const target = index + delta;
    if (target < 0 || target >= options.length) return;
    const reordered = [...options];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    await send(tagsRequest("PATCH", { kind: "work", order: reordered.map((item) => item.id) }));
  };

  // ── 場所ごとの設定（出張扱い・在宅扱い・1文字）──────────────────────
  const toggleTrip = async (place: string, trip: boolean) => {
    const before = tripPlaces;
    const next = trip ? [...before, place] : before.filter((item) => item !== place);
    setTripPlaces(next);
    setError(null);
    try {
      const response = await fetch("/api/work/trip-places", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ places: next }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setTripPlaces(before);
        setError(body?.message ?? "出張扱いを保存できませんでした。");
      }
    } catch {
      setTripPlaces(before);
      setError("出張扱いを保存できませんでした。");
    }
  };

  const toggleRemote = async (place: string, remote: boolean) => {
    const before = remotePlaces;
    const next = remote ? [...before, place] : before.filter((item) => item !== place);
    setRemotePlaces(next);
    setError(null);
    try {
      const response = await fetch("/api/settings/work-auto", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remotePlaces: next }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setRemotePlaces(before);
        setError(body?.message ?? "在宅扱いを保存できませんでした。");
      }
    } catch {
      setRemotePlaces(before);
      setError("在宅扱いを保存できませんでした。");
    }
  };

  /** 1文字は✓で確定したときに保存する（空欄は先頭の1文字に戻す）。 */
  const saveShortLabel = async (place: string, trimmed: string) => {
    if ((shortLabels[place] ?? "") === trimmed) return;
    const before = shortLabels;
    const next = { ...before };
    if (trimmed) next[place] = trimmed;
    else delete next[place];
    setShortLabels(next);
    setError(null);
    try {
      const response = await fetch("/api/work/place-short-labels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels: next }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setShortLabels(before);
        setError(body?.message ?? "月表示の1文字を保存できませんでした。");
      }
    } catch {
      setShortLabels(before);
      setError("月表示の1文字を保存できませんでした。");
    }
  };

  const rowOf = (entry: Entry) =>
    defaults.find((row) => row.key === entry.key && row.isTrip === entry.isTrip) ?? null;
  const outRoutesOf = (entry: Entry) =>
    home ? routes.filter((route) => route.origin === home && route.destination === entry.key) : [];
  const backRoutesOf = (entry: Entry) =>
    home ? routes.filter((route) => route.origin === entry.key && route.destination === home) : [];
  const outOf = (entry: Entry) => pickDefaultRoute(outRoutesOf(entry));
  const backOf = (entry: Entry) => pickDefaultRoute(backRoutesOf(entry));

  const renderCard = (entry: PanelEntry) => {
    const row = rowOf(entry);
    const remote = !entry.isTrip && remotePlaces.includes(entry.key);
    const summary = summarizePlace({
      isTrip: entry.isTrip,
      remote,
      workEnabled: row?.workEnabled ?? true,
      startMinutes: row?.startMinutes ?? null,
      endMinutes: row?.endMinutes ?? null,
      outMinutes: outOf(entry)?.minutes ?? null,
      backMinutes: backOf(entry)?.minutes ?? null,
    });
    return (
      <li key={`${entry.extra}:${entry.key}`}>
        <button
          type="button"
          onClick={() => select({ key: entry.key, extra: entry.extra })}
          aria-current={isSelected(entry) ? "true" : undefined}
          className={`flex w-full min-w-0 flex-col gap-2 rounded-xl border p-3 text-left transition-colors hover:bg-surface-container ${
            isSelected(entry) ? "border-primary bg-surface-container" : "border-outline-variant"
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            {entry.option ? (
              <TagChip name={entry.key} color={entry.option.color} />
            ) : (
              <span className="type-label-medium truncate rounded-md bg-surface-container-high px-1.5 py-0.5">
                {entry.key}
              </span>
            )}
            {!entry.option && <span className="type-label-small text-on-surface-variant">出張先</span>}
            <span className="flex-1" />
            <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
          </span>
          <span className="flex flex-wrap gap-1.5">
            {summary.badges.map((badge) => (
              <span
                key={badge}
                className="type-label-small rounded-md bg-secondary-container px-2 py-0.5 text-on-secondary-container"
              >
                {badge}
              </span>
            ))}
            {summary.details.map((detail) => (
              <span
                key={detail}
                className="type-label-small rounded-md border border-outline-variant px-2 py-0.5 text-on-surface-variant"
              >
                {detail}
              </span>
            ))}
          </span>
        </button>
      </li>
    );
  };

  const renderDetail = (entry: PanelEntry) => {
    const remote = !entry.isTrip && remotePlaces.includes(entry.key);
    const index = entry.option && options ? options.findIndex((item) => item.id === entry.option?.id) : -1;
    return (
      <Card>
        <CardContent className="flex flex-col gap-5">
          <Button variant="ghost" size="sm" className="-ml-2 self-start @3xl/main:hidden" onClick={() => select(null)}>
            <ArrowLeft className="size-4" />
            勤務場所
          </Button>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {entry.option ? (
              <TagChip name={entry.key} color={entry.option.color} className="type-title-small" />
            ) : (
              <h2 className="type-title-medium">{entry.key}</h2>
            )}
            <span className="type-body-small text-on-surface-variant">
              {entry.option ? "勤務場所" : "出張先"}
            </span>
            <span className="flex-1" />
            {entry.option && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${entry.key} を上へ`}
                  disabled={busy || index <= 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${entry.key} を下へ`}
                  disabled={busy || index < 0 || index === (options?.length ?? 0) - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  variant="destructive"
                  size="icon-sm"
                  aria-label={`${entry.key} を削除`}
                  disabled={busy}
                  onClick={() => remove(entry.key)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </>
            )}
          </div>

          {entry.option && (
            <div className="flex flex-col gap-3">
              <h3 className="type-title-small">表示と扱い</h3>
              <div className="flex flex-col gap-1">
                  <span className="type-label-medium text-on-surface-variant">名前</span>
                  <ConfirmField
                    key={`name:${entry.key}`}
                    value={entry.key}
                    ariaLabel={`${entry.key} の名前`}
                    disabled={busy}
                    validate={(draft) =>
                      !draft
                        ? "名前を入力してください。"
                        : optionNames.includes(draft)
                          ? `「${draft}」はすでにあります。`
                          : null
                    }
                    onConfirm={async (draft) => {
                      if (entry.option) await rename(entry.option, draft);
                    }}
                  />
                  <p className="type-body-small text-on-surface-variant">
                    名前を変えても移るのは、Notionの記録・出張扱い・月表示の1文字までです。在宅扱い・勤務時間などの
                    既定値・正式名称は、変更後の名前で入れ直してください。
                  </p>
                </div>
              <div className="flex flex-col gap-1">
                <span className="type-label-medium text-on-surface-variant">
                  スマホの月表示に出す1文字（空欄は先頭の1文字）
                </span>
                <ConfirmField
                  key={`short:${entry.key}:${shortLabels[entry.key] ?? ""}`}
                  value={shortLabels[entry.key] ?? ""}
                  ariaLabel={`${entry.key} の月表示の1文字`}
                  placeholder={Array.from(entry.key)[0] ?? ""}
                  inputClassName="w-24 text-center"
                  validate={(draft) =>
                    !draft || isSingleCharacter(draft)
                      ? null
                      : `1文字にしてください（現在${[...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(draft)].length}文字）`
                  }
                  onConfirm={(draft) => saveShortLabel(entry.key, draft)}
                />
              </div>
              {tripAvailable ? (
                <label className="flex items-center gap-3">
                  <Switch
                    checked={entry.isTrip}
                    onCheckedChange={(next) => toggleTrip(entry.key, next)}
                  />
                  <span className="type-body-medium">出張扱いにする（行き先はこの場所の名前）</span>
                </label>
              ) : (
                <p className="type-body-small text-on-surface-variant">
                  勤務記録DBに出張（チェックボックス）のプロパティがないため、出張扱いは決められません。
                </p>
              )}
              {!entry.isTrip && (
                <label className="flex items-center gap-3">
                  <Switch checked={remote} onCheckedChange={(next) => toggleRemote(entry.key, next)} />
                  <span className="type-body-medium">在宅として扱う（通勤の移動を作らない）</span>
                </label>
              )}
            </div>
          )}

          <PlaceDefaultFields
            key={`${entry.isTrip}:${entry.key}`}
            entry={entry}
            extra={entry.extra}
            remote={remote}
            home={home}
            linkablePlaces={linkablePlaces}
            link={links.find((item) => item.workPlace === entry.key) ?? null}
            onSavedLinks={setLinks}
            row={rowOf(entry)}
            outRoutes={outRoutesOf(entry)}
            backRoutes={backRoutesOf(entry)}
            trains={trains}
            onTrainsChanged={(next) => {
              setTrains(next);
              // 電車の変更でサーバーが公共交通の所要時間を求め直すため、行を取り直す（issue #1458）。
              void fetch("/api/settings/work-routes")
                .then((res) => (res.ok ? res.json() : null))
                .then((body: { routes?: WorkRouteRow[] } | null) => {
                  if (body?.routes) setRoutes(body.routes);
                })
                .catch(() => undefined);
            }}
            commonStart={commonStart}
            commonEnd={commonEnd}
            onSavedDefaults={setDefaults}
            onSavedRoutes={(pairs) =>
              setRoutes((existing) => [
                ...existing.filter(
                  (route) =>
                    !pairs.some((pair) => pair.origin === route.origin && pair.destination === route.destination),
                ),
                ...pairs.flatMap((pair) => pair.routes),
              ])
            }
          />
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-4 @3xl/main:grid @3xl/main:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @3xl/main:items-start">
      <Card className={current ? "hidden @3xl/main:block" : undefined}>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="type-title-medium">勤務場所</h2>
            <p className="type-body-small text-on-surface-variant">
              勤務の記録に付けられる場所です。1件につき1つだけ選べます。押すと、その場所の設定が開きます。
            </p>
          </div>

          {error && (
            <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
              {error}
            </p>
          )}

          {options === null ? (
            <p className="type-body-medium text-on-surface-variant">{missingMessage}</p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {entries.map(renderCard)}
                {entries.length === 0 && (
                  <li className="type-body-medium text-on-surface-variant">まだ登録されていません。</li>
                )}
              </ul>

              {extraEntries.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="type-title-small">出張先</h3>
                  <ul className="flex flex-col gap-2">{extraEntries.map(renderCard)}</ul>
                </div>
              )}

              <div className="flex flex-col gap-2 border-t border-rule pt-4">
                <Label htmlFor="work-place-new">新しく追加</Label>
                <div className="flex min-w-0 items-center gap-2">
                  <Input
                    id="work-place-new"
                    className="h-10 min-w-0 flex-1"
                    placeholder="名前"
                    value={name}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void add();
                      }
                    }}
                  />
                  <Button size="sm" disabled={busy || !name.trim()} onClick={add}>
                    <Plus className="size-4" />
                    追加
                  </Button>
                </div>
                <ColorPicker value={color} onChange={setColor} disabled={busy} />
                <p className="type-body-small text-on-surface-variant">
                  色を選べるのは追加のときだけです（Notionが既存の選択肢の色の変更を受け付けないため）。
                </p>

                <div className="flex min-w-0 items-center gap-2">
                  <Input
                    className="h-10 min-w-0 flex-1"
                    aria-label="出張先を追加"
                    placeholder="出張先を追加（例: 門真）"
                    value={newTrip}
                    onChange={(event) => setNewTrip(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!newTrip.trim()}
                    onClick={() => {
                      const key = newTrip.trim();
                      setExtra((existing) => [...existing, key]);
                      setNewTrip("");
                      select({ key, extra: true });
                    }}
                  >
                    追加
                  </Button>
                </div>

                {databaseUrl && (
                  <a
                    href={databaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="type-body-small flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="size-3.5" />
                    Notionで開く
                  </a>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className={current ? "min-w-0" : "hidden min-w-0 @3xl/main:block"}>
        {allEntries.map((entry) => (
          <div key={`${entry.extra}:${entry.key}`} hidden={!isSelected(entry)}>
            {renderDetail(entry)}
          </div>
        ))}
        {!current && (
          <Card>
            <CardContent>
              <p className="type-body-medium text-on-surface-variant">
                左の一覧から勤務場所を選ぶと、1文字・出張扱い・勤務時間・往路復路・電車・正式名称がここに開きます。
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
