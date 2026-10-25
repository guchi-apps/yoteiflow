"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { Check, ChevronRight, List, Map as MapIcon, MapPin, Plus, Search } from "lucide-react";

import { PlaceMapDialog } from "@/components/calendar/place-map-dialog";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { PlaceDialog, type PlaceCapabilities } from "@/components/places/place-dialog";
import { PlacesMap } from "@/components/places/places-map";
import { SettingsShell } from "@/components/settings/settings-shell";
import { TagChip } from "@/components/tags/tag-chip";
import { tagColorOf, tagSwatchClass } from "@/components/tags/tag-color";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCoordinates } from "@/lib/coordinates";
import { filterPlaces } from "@/lib/place-filter";
import { cn } from "@/lib/utils";
import type { PlaceItem } from "@/services/notion/places";
import type { TagOption } from "@/services/notion/tag-options";

/**
 * 登録した場所の一覧（docs/spec.md §9）。
 *
 * 並びはNotionの場所DBのままにする。そこが一次情報源で、DaySpanが別の順を持つと
 * Notionで並べ替えても画面が追従しない（買い物のカテゴリのタブと同じ判断）。
 * 目当ての場所を探す手段は絞り込みが受け持つ。
 */
export function PlacesScreen({
  places,
  loadError = null,
  capabilities,
  tagOptions = [],
}: {
  places: PlaceItem[];
  /** Notionから読めなかったときの理由。画面は開いたまま、何が起きたかだけを伝える。 */
  loadError?: string | null;
  capabilities: PlaceCapabilities;
  /** 場所DBのタグの選択肢。編集ダイアログの候補と、一覧のチップの色に使う。 */
  tagOptions?: TagOption[];
}) {
  const router = useRouter();

  // 追加・変更・削除はすべて書き込み。オフライン中は押せないようにする（docs/spec.md §21）。
  const offline = useOffline();
  useReconnectRefresh();

  // オフラインでもこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  useWarmOfflinePage("/places");

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PlaceItem | null>(null);
  const [adding, setAdding] = useState(false);
  // 一覧と地図の切り替え（1024px未満だけ）。端末には覚えさせず、開くたびに一覧から始める。
  const [mode, setMode] = useState<"list" | "map">("list");
  // 地図で選んでいる場所と、一覧の行から地図を寄せる合図（issue #1364）。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null);

  // 1024px以上では一覧の行を押すと地図をその場所へ寄せる（編集は吹き出しから）。
  // 地点の無い場所は地図に出ないため、従来どおり編集を開く。それより狭い幅では
  // 一覧に地図が並ばないので、従来どおり行から編集を開く。
  const openRow = (place: PlaceItem) => {
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    if (wide && place.coordinates) {
      setSelectedId(place.id);
      setFocus((current) => ({ id: place.id, seq: (current?.seq ?? 0) + 1 }));
      return;
    }
    setEditing(place);
  };

  // 絞り込みに使うタグ。Notionの選択肢の並びを先に、選択肢に無いが場所に付いているものを後に並べる。
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const filterTags = useMemo(() => {
    const names = tagOptions.map((option) => option.name);
    const extra = new Set<string>();
    for (const place of places) {
      for (const tag of place.tags) if (!names.includes(tag)) extra.add(tag);
    }
    return [...names, ...extra];
  }, [places, tagOptions]);

  const filtered = useMemo(
    () => filterPlaces(places, query, selectedTags),
    [places, query, selectedTags],
  );

  const toggleTag = (tag: string) =>
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    );

  const refresh = () => {
    setEditing(null);
    setAdding(false);
    router.refresh();
  };

  return (
    <>
      {editing && (
        <PlaceDialog
          place={editing}
          capabilities={capabilities}
          tagOptions={tagOptions}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}

      {/* 追加はいまの地図ダイアログをそのまま開く。一覧を見て「これが無い」と気付いたとき、
          予定の入力画面まで戻らずにその場で足せるようにする。 */}
      {adding && (
        <PlaceMapDialog
          query=""
          places={places}
          onCancel={() => setAdding(false)}
          onRegistered={refresh}
        />
      )}

      <SettingsShell
        title="場所"
        backHref="/activity"
        backLabel="記録"
        wide
        actions={
          <>
            {/* タグは固定の4種で、管理画面は持たない（issue #1361）。 */}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="場所を追加"
              disabled={offline}
              onClick={() => setAdding(true)}
            >
              <Plus />
            </Button>
          </>
        }
      >
        {loadError && (
          <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
            {loadError}
          </p>
        )}

        {places.length > 0 && (
          <label className="flex items-center gap-2 rounded-full border border-outline-variant px-4 py-2.5 text-on-surface-variant focus-within:border-primary">
            <Search className="size-4 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名前・住所・タグで絞り込み"
              className="type-body-medium min-w-0 flex-1 bg-transparent text-on-surface outline-none placeholder:text-on-surface-variant"
            />
          </label>
        )}

        {places.length > 0 && filterTags.length > 0 && (
          // 複数選ぶと「いずれかのタグが付いた場所」を残す。狭い画面は横に送り、広い画面は折り返す。
          // 選択はチェック・枠・塗りの3つで示す（色だけに意味を持たせない）。
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5 md:flex-wrap md:overflow-visible">
              {filterTags.map((tag) => {
                const on = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      "type-label-large inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 transition-colors",
                      on
                        ? "border-primary bg-secondary-container font-semibold text-on-secondary-container"
                        : "border-outline-variant text-on-surface hover:bg-on-surface/8",
                    )}
                  >
                    {on ? (
                      <Check className="size-3.5 text-primary" />
                    ) : (
                      <span
                        className={cn("size-2 rounded-full", tagSwatchClass(tagColorOf(tagOptions, tag)))}
                      />
                    )}
                    {tag}
                  </button>
                );
              })}
            </div>
            {selectedTags.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTags([])}
                className="type-label-large shrink-0 px-1 text-primary"
              >
                解除
              </button>
            )}
          </div>
        )}

        {places.length > 0 && selectedTags.length > 0 && (
          <p className="type-body-small text-on-surface-variant">
            {selectedTags.length}つのタグで絞り込み中 ・ 該当{filtered.length}件 / 全{places.length}件
          </p>
        )}

        {places.length > 0 && (
          <div
            role="group"
            aria-label="表示の切り替え"
            className="flex self-start overflow-hidden rounded-full border border-outline-variant lg:hidden"
          >
            {(
              [
                ["list", "一覧", List],
                ["map", "地図", MapIcon],
              ] as const
            ).map(([value, label, Icon], index) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "type-label-large flex items-center gap-1.5 px-4 py-1.5 transition-colors",
                  index > 0 && "border-l border-outline-variant",
                  mode === value
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface-variant hover:bg-on-surface/8",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        )}

        {places.length === 0 ? (
          <p className="type-body-medium text-on-surface-variant">
            {loadError
              ? "取得できた場所はありません。"
              : "まだ場所が登録されていません。右上の「＋」から地図で登録できます。予定の場所欄からも登録できます。"}
          </p>
        ) : filtered.length === 0 ? (
          <p className="type-body-medium text-on-surface-variant">
            {query.trim() ? `「${query.trim()}」` : "選んだタグ"}に当たる場所はありません。
          </p>
        ) : (
          // 1024px以上は一覧の右に地図を並べる（issue #1364）。地図に幅を譲るため、一覧は
          // 以前の2列（issue #636）から1列に戻す。地図は本文のスクロールに付いてこさせる。
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
            <Card className={cn("gap-0 py-0", mode === "map" && "hidden lg:flex")}>
              {filtered.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  onClick={() => openRow(place)}
                  aria-current={place.id === selectedId ? "true" : undefined}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 text-left transition-colors not-last:border-b not-last:border-outline-variant hover:bg-on-surface/8",
                    place.id === selectedId && "lg:bg-primary/12",
                  )}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="type-body-large truncate">{place.name}</span>
                    {/* 最寄り駅は電車の移動でそのまま発着地になる。住所と同じ行へ添えて、
                        どの駅から探されるのかを一覧から読めるようにする。 */}
                    <span className="type-body-small truncate text-on-surface-variant">
                      {place.station
                        ? `${place.address ?? "住所なし"} ・ ${place.station}`
                        : (place.address ?? "住所なし")}
                    </span>
                  </div>

                  {place.tags.length > 0 && (
                    <div className="flex max-w-[40%] shrink-0 gap-1">
                      {place.tags.slice(0, 2).map((tag) => (
                        <TagChip key={tag} name={tag} color={tagColorOf(tagOptions, tag)} />
                      ))}
                    </div>
                  )}

                  {/* 地点があるかどうかで、この場所を開いたときの行き先が変わる
                      （座標があれば座標、無ければ住所の検索）。一覧から読めるようにしておく。 */}
                  {place.coordinates && (
                    <MapPin
                      className="size-4 shrink-0 text-travel"
                      aria-label={`地点あり（${formatCoordinates(place.coordinates)}）`}
                    />
                  )}

                  <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
                </button>
              ))}
            </Card>

            <PlacesMap
              places={filtered}
              selectedId={selectedId}
              onSelect={setSelectedId}
              focus={focus}
              onEdit={setEditing}
              className={cn(
                "h-[62dvh] lg:sticky lg:top-24 lg:flex lg:h-[calc(100dvh-8rem)]",
                mode === "list" && "hidden",
              )}
            />
          </div>
        )}

        <p className="type-body-small text-on-surface-variant">
          場所の一次情報源はNotionの場所DBです。ここでの変更はNotionへそのまま書き込まれ、
          削除はNotionのゴミ箱へ移します。タグの色・並び順・名前は右上の「タグ」から変えられます。
        </p>
      </SettingsShell>
    </>
  );
}
