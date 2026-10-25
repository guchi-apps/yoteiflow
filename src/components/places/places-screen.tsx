"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { ChevronRight, MapPin, Plus, Search } from "lucide-react";

import { PlaceMapDialog } from "@/components/calendar/place-map-dialog";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { PlaceDialog, type PlaceCapabilities } from "@/components/places/place-dialog";
import { SettingsShell } from "@/components/settings/settings-shell";
import { TagChip } from "@/components/tags/tag-chip";
import { tagColorOf } from "@/components/tags/tag-color";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WIDE_TWO_COLUMN_ROW_CLASS } from "@/components/ui/wide-section";
import { formatCoordinates } from "@/lib/coordinates";
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return places;
    return places.filter((place) =>
      [place.name, place.address ?? "", place.station ?? "", ...place.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [places, query]);

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

        {places.length === 0 ? (
          <p className="type-body-medium text-on-surface-variant">
            {loadError
              ? "取得できた場所はありません。"
              : "まだ場所が登録されていません。右上の「＋」から地図で登録できます。予定の場所欄からも登録できます。"}
          </p>
        ) : filtered.length === 0 ? (
          <p className="type-body-medium text-on-surface-variant">
            「{query.trim()}」に当たる場所はありません。
          </p>
        ) : (
          // 広い画面では行を2列に並べる（issue #636）。1行が画面幅いっぱいに伸びても名前と住所の
          // 間が空くだけで、読める件数は増えない。
          <Card className="gap-0 py-0 lg:grid lg:grid-cols-2">
            {filtered.map((place) => (
              <button
                key={place.id}
                type="button"
                onClick={() => setEditing(place)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 text-left transition-colors not-last:border-b not-last:border-outline-variant hover:bg-on-surface/8",
                  WIDE_TWO_COLUMN_ROW_CLASS,
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
        )}

        <p className="type-body-small text-on-surface-variant">
          場所の一次情報源はNotionの場所DBです。ここでの変更はNotionへそのまま書き込まれ、
          削除はNotionのゴミ箱へ移します。タグの色・並び順・名前は右上の「タグ」から変えられます。
        </p>
      </SettingsShell>
    </>
  );
}
