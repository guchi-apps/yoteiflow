"use client";

import { useMemo, useState } from "react";
import { useOffline } from "next/offline";
import { ArrowRight, ArrowUpDown, Eye, EyeOff, Heart, Plus, RefreshCw, ShoppingCart } from "lucide-react";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { readErrorMessage } from "@/components/calendar/response-error";
import { AppBadgeSync } from "@/components/notifications/app-badge-sync";
import { AppMenuButton } from "@/components/nav/app-drawer";
import { AppFrame } from "@/components/nav/app-frame";
import {
  WIDE_SECTION_CARD_CLASS,
  WIDE_SECTION_HEADING_CLASS,
  WIDE_SECTION_LIST_CLASS,
} from "@/components/ui/wide-section";
import { BottomNav } from "@/components/nav/main-nav";
import { fabBottomOffsetClass, RunningActivityBar } from "@/components/nav/running-activity-bar";
import { OFFLINE_WRITE_MESSAGE, OfflineNotice } from "@/components/offline/offline-notice";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { SlowNetworkNotice } from "@/components/offline/slow-network-notice";
import { useApiResource } from "@/components/offline/use-api-resource";
import { countDueShopping } from "@/services/notifications/badge-count";
import { ShoppingItemDialog, type ShoppingDraft } from "@/components/shopping/shopping-item-dialog";
import { ShoppingItemDetailDialog } from "@/components/shopping/shopping-item-detail-dialog";
import { useShoppingViewPrefs } from "@/components/shopping/use-shopping-view-prefs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LinearProgress } from "@/components/ui/linear-progress";
import { shouldQueueWrite, submitWrite } from "@/lib/offline-queue/flush";
import { applyBoughtOps } from "@/lib/offline-queue/ops";
import { usePendingWrites } from "@/lib/offline-queue/store";
import { useWriteSynced } from "@/lib/offline-queue/use-write-synced";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/services/notion/tag-options";
import {
  buildShoppingSections,
  categoryLabelOf,
  SHOPPING_SORTS,
  SHOPPING_SORT_LABELS,
  shoppingCategoryKeys,
  shoppingDateLabel,
  shoppingDateTone,
  unboughtCounts,
  type ShoppingItem,
} from "@/types/shopping";
import type { RunningActivitySummary } from "@/types/activity";

/**
 * 買い物リストの画面（docs/spec.md §36）。
 *
 * 一次情報源はNotionの買い物リストDBで、DaySpanのDBには何も保存しない。別アプリ
 * （shopping-list）と同じDBを指せるため、どちらから足したものも両方に出る。
 */
type ShoppingData = { items: ShoppingItem[]; categoryOptions: TagOption[]; wishlistReady: boolean };
type ShoppingView = "shopping" | "wishlist";

const EMPTY_ITEMS: ShoppingItem[] = [];
const EMPTY_OPTIONS: TagOption[] = [];

export function ShoppingScreen({
  timeZone,
  runningActivity = null,
}: {
  /** ナビの「カレンダー」が今日へ移るのに使う（端末の時計任せにしない）。 */
  timeZone: string;
  /**
   * 記録中の項目（issue #629）。ナビの記録の項目へ印を出し、下部ナビの直上に記録中バーを
   * 出すために使う（docs/spec.md §27）。
   */
  runningActivity?: RunningActivitySummary | null;
}) {
  // 一覧はページが待たずに、ここで背景取得する（issue #724）。追加ボタン・ナビは取得を待たない。
  const resource = useApiResource<ShoppingData>(
    "/api/shopping",
    "買い物リストを取得できませんでした。",
  );
  const { data, reload } = resource;
  useWriteSynced(reload);
  const items = data?.items ?? EMPTY_ITEMS;
  const fetchedOptions = data?.categoryOptions ?? EMPTY_OPTIONS;
  const wishlistReady = data?.wishlistReady ?? false;
  const loadError = resource.error;
  const pending = resource.loading;
  const { sort, showBought, setSort, setShowBought } = useShoppingViewPrefs();
  const [view, setView] = useState<ShoppingView>("shopping");
  const [filterKey, setFilterKey] = useState("all");
  const [dialog, setDialog] = useState<ShoppingDraft | null>(null);
  // 行を押した直後は編集ではなく表示画面を開く。編集は詳細画面の明示操作からだけ開く。
  const [viewingItem, setViewingItem] = useState<ShoppingItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 購入済みの切り替えは押した瞬間に画面へ反映する。買い物中はいちばん押す操作で、
  // Notionへの往復（1秒前後）を待たせると、次の棚へ移りながら押すことができない。
  const [pendingBought, setPendingBought] = useState<Record<string, boolean>>({});

  // オフライン中は書き込みを止める（docs/spec.md §21）。
  const offline = useOffline();

  // オフラインでこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  // ナビからの移動はソフトナビゲーションで、Service Worker が保存できないため。
  useWarmOfflinePage("/shopping");

  const categoryOptions = fetchedOptions;
  const categoryNames = useMemo(
    () => categoryOptions.map((option) => option.name),
    [categoryOptions],
  );

  // 「今日」「明日」の判定は設定タイムゾーンで行う。端末の時計に任せると、サーバー（UTC）と
  // ブラウザ（JST）で日付が食い違い、最初の描画がハイドレーションと一致しない。
  const todayKey = useMemo(() => createCalendarDateUtils(timeZone).todayKey(), [timeZone]);
  // アイコン・下部ナビのバッジに出す件数。取得した一覧から数え、別に取り直さない（docs/spec.md §32）。
  const dueCount = useMemo(() => countDueShopping(items, todayKey), [items, todayKey]);

  // 楽観更新ぶんを重ねた一覧。以降の集計・区分はすべてこれを見る。
  const listedItems = useMemo(
    () => items.filter((item) => item.wishlisted === (view === "wishlist")),
    [items, view],
  );
  const queuedWrites = usePendingWrites();
  const shown = useMemo(
    () =>
      applyBoughtOps(
        listedItems.map((item) =>
          item.id in pendingBought ? { ...item, bought: pendingBought[item.id] } : item,
        ),
        queuedWrites,
      ),
    [listedItems, pendingBought, queuedWrites],
  );

  const tabKeys = useMemo(
    () => shoppingCategoryKeys(shown, categoryNames),
    [shown, categoryNames],
  );
  const counts = useMemo(() => unboughtCounts(shown), [shown]);

  // 選んでいたカテゴリが（Notion側での削除・改名で）無くなったら「すべて」へ戻す。
  // 残したままだと、どのタブも押していないのに一覧が空の画面になる。
  const activeKey = filterKey === "all" || tabKeys.includes(filterKey) ? filterKey : "all";

  const sections = useMemo(
    () => buildShoppingSections(shown, categoryNames, { filterKey: activeKey, sort, showBought }),
    [shown, categoryNames, activeKey, sort, showBought],
  );

  const hasBought = view === "shopping" && shown.some((item) => item.bought);

  /**
   * 購入済みの切り替え。
   *
   * 先に画面を変え、Notionへの書き込みが失敗したら押す前へ戻す。戻したことが分かるよう
   * 失敗の理由も出す（黙って戻ると、押したはずのチェックが外れた理由が読めない）。
   */
  const toggleBought = async (item: ShoppingItem, bought: boolean) => {
    // オフライン中・先にためた操作があるときは、端末にためて通信が戻ったときに送る（issue #1135）。
    if (shouldQueueWrite(offline)) {
      setError(null);
      submitWrite({ kind: "shoppingBought", itemId: item.id, bought });
      return;
    }

    setPendingBought((prev) => ({ ...prev, [item.id]: bought }));
    setBusyId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/shopping/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bought }),
      });
      if (!response.ok) {
        setPendingBought((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        setError(await readErrorMessage(response, "購入済みを変更できませんでした。"));
        return;
      }
      reload();
    } catch {
      setPendingBought((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setError("購入済みを変更できませんでした。");
    } finally {
      setBusyId(null);
    }
  };

  const openAdd = () => {
    // 追加の既定は開いているタブのカテゴリ。「すべて」を見ているときだけ未設定から始める
    // （そこには「いま何のカテゴリを足そうとしているか」の手掛かりが無い）。
    setDialog({ mode: "create", category: activeKey === "all" ? null : activeKey, wishlisted: view === "wishlist" });
  };

  const changeClassification = async (item: ShoppingItem, wishlisted: boolean) => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }
    setBusyId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/shopping/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // 欲しいものへ移すときは、買うものだけが持つ購入予定日・購入済みも外す。
        // そのまま残すと、あとで買うものへ戻したときに意図しない予定日や購入済みが復活する。
        body: JSON.stringify(
          wishlisted
            ? { wishlisted: true, plannedDate: null, bought: false }
            : { wishlisted: false },
        ),
      });
      if (!response.ok) {
        setError(
          await readErrorMessage(
            response,
            wishlisted ? "欲しいものへ変更できませんでした。" : "買うものへ変更できませんでした。",
          ),
        );
        return;
      }
      reload();
    } catch {
      setError(wishlisted ? "欲しいものへ変更できませんでした。" : "買うものへ変更できませんでした。");
    } finally {
      setBusyId(null);
    }
  };

  const nextSort = () => setSort(SHOPPING_SORTS[(SHOPPING_SORTS.indexOf(sort) + 1) % SHOPPING_SORTS.length]);

  return (
    <AppFrame
      current="shopping"
      activityRunning={runningActivity !== null}
      running={runningActivity}
    >
      <header className="flex items-center gap-1 bg-surface-container-low px-2 py-2">
        {/* 768px未満は左上をメニューにする（issue #328・#463）。768px以上は左端のサイドバーから
            画面を移る（issue #636）。 */}
        <AppMenuButton current="shopping" activityRunning={runningActivity !== null} />
        {/* いまどの画面にいるかは、ヘッダーのナビが無くなったぶんここで示す（issue #463）。
            狭い画面では下部ナビが同じことを示すため、PCだけに出す。 */}
        <div className="hidden shrink-0 items-center gap-1.5 font-semibold md:flex">
          <ShoppingCart className="size-5" />
          <span>買い物</span>
        </div>

        <span className="flex-1" />

        {hasBought && (
          <Button
            variant="outline"
            size="sm"
            aria-label={showBought ? "購入したものを隠す" : "購入したものを表示する"}
            onClick={() => setShowBought(!showBought)}
          >
            {showBought ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            <span className="hidden sm:inline">購入済み</span>
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          aria-label={`並び替え（いまは${SHOPPING_SORT_LABELS[sort]}）`}
          onClick={nextSort}
        >
          <ArrowUpDown className="size-4" />
          {SHOPPING_SORT_LABELS[sort]}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="再取得"
          // オフライン中に押しても、再接続まで終わらない読み込みが始まるだけになる。
          disabled={pending || offline}
          onClick={reload}
        >
          <RefreshCw className="size-4" />
        </Button>
      </header>

      <LinearProgress active={pending || busyId !== null} />

      <OfflineNotice />
      {!offline && resource.stale && <SlowNetworkNotice />}

      {(loadError || error) && (
        <div className="bg-error-container/70 px-3 py-2 text-xs text-on-error-container">
          {loadError ?? error}
        </div>
      )}

      <div role="tablist" aria-label="リスト" className="flex gap-2 border-b border-rule bg-surface-container-low px-3 pt-2 pb-1">
        <CategoryTab active={view === "shopping"} count={items.filter((item) => !item.wishlisted && !item.bought).length} onClick={() => setView("shopping")}>
          買うもの
        </CategoryTab>
        {wishlistReady && (
          <CategoryTab active={view === "wishlist"} count={items.filter((item) => item.wishlisted).length} onClick={() => setView("wishlist")}>
            <Heart className="size-3.5" aria-hidden /> 欲しいもの
          </CategoryTab>
        )}
      </div>

      {/* カテゴリのタブ。数字は未購入の件数で、押す前に残りの多い売り場が分かる。
          並び順はNotionのプロパティ定義そのもの（そこが一次情報源）。 */}
      {tabKeys.length > 0 && (
        <div
          role="tablist"
          aria-label="カテゴリ"
          className="flex shrink-0 gap-2 overflow-x-auto border-b border-rule bg-surface-container-low px-3 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <CategoryTab
            active={activeKey === "all"}
            count={counts.all ?? 0}
            onClick={() => setFilterKey("all")}
          >
            すべて
          </CategoryTab>
          {tabKeys.map((key) => (
            <CategoryTab
              key={key}
              active={activeKey === key}
              count={counts[key] ?? 0}
              onClick={() => setFilterKey(key)}
            >
              {categoryLabelOf(key)}
            </CategoryTab>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24">
        {/*
          広い画面の「すべて」では、カテゴリの束をカードにして段組みに流す（issue #636）。1列のままだと
          3つ目より下の売り場はスクロールしないと見えない。高さの違う束を段組みで詰めるため隙間が
          空かず、読み順（左の段の上から下、次の段）でNotionの定義順も保たれる。段組みの中では
          見出しの sticky が効かないため、広い画面では張り付かせない。
          カテゴリを選んでいるときは束が1つだけなので、その項目を2段に並べる。
        */}
        <div
          className={cn(
            activeKey === "all" &&
              "@xl/main:columns-2 @xl/main:gap-3 @xl/main:p-3 @5xl/main:columns-3",
          )}
        >
          {sections.map((section) => (
            <section
              key={section.key}
              className={cn(
                activeKey === "all" &&
                  cn(WIDE_SECTION_CARD_CLASS, "@xl/main:mb-3 @xl/main:break-inside-avoid"),
              )}
            >
              {/* カテゴリを選んでいるときは見出しを出さない。何のカテゴリかはタブが示している。 */}
              {activeKey === "all" && (
                <h2
                  className={cn(
                    "sticky top-0 z-10 flex items-center gap-2 border-b border-rule bg-background/95 px-3 py-1 text-[11px] tracking-widest text-muted-foreground backdrop-blur",
                    WIDE_SECTION_HEADING_CLASS,
                    "@xl/main:static",
                  )}
                >
                  {section.label}
                  <span className="text-[10px] opacity-70">{section.items.length}</span>
                </h2>
              )}

              <ul
                className={
                  activeKey === "all"
                    ? WIDE_SECTION_LIST_CLASS
                    : "@xl/main:grid @xl/main:grid-cols-2 @xl/main:gap-x-3 @xl/main:px-3"
                }
              >
                {section.items.map((item) => (
                  <ShoppingRow
                    key={item.id}
                    item={item}
                    todayKey={todayKey}
                    disabled={busyId === item.id || offline}
                    onToggleBought={(bought) => toggleBought(item, bought)}
                    wishlist={view === "wishlist"}
                    onChangeClassification={(nextWishlisted) => changeClassification(item, nextWishlisted)}
                    onOpen={() => setViewingItem(item)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>

        {data === null && !loadError && <ShoppingListSkeleton />}

        {data !== null && sections.length === 0 && !loadError && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {shown.length === 0
              ? view === "wishlist" ? "欲しいものはありません。" : "買うものがありません。"
              : showBought
                ? "このカテゴリに項目がありません。"
                : "買うものはありません。購入したものは隠しています。"}
          </p>
        )}
      </div>

      <Button
        size="icon"
        className={cn(
          "elevation-3 fixed right-4 z-20 size-16 rounded-[20px] bg-primary-container text-on-primary-container hover:brightness-95 active:rounded-[14px]",
          fabBottomOffsetClass(runningActivity !== null),
        )}
        aria-label={view === "wishlist" ? "欲しいものを追加" : "買うものを追加"}
        disabled={offline}
        onClick={openAdd}
      >
        <Plus className="size-6" />
      </Button>

      {data && <AppBadgeSync shopping={dueCount} />}

      <RunningActivityBar running={runningActivity} />
      <BottomNav current="shopping" activityRunning={runningActivity !== null} timeZone={timeZone} />

      {dialog && (
        <ShoppingItemDialog
          draft={dialog}
          categoryOptions={categoryOptions}
          timeZone={timeZone}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            // 楽観更新ぶんは取り直した値で置き換わる。残しておくと、削除した項目の
            // 購入済みだけが手元に残り続ける。
            setPendingBought({});
            reload();
          }}
        />
      )}

      {viewingItem && (
        <ShoppingItemDetailDialog
          item={viewingItem}
          readOnly={offline}
          onClose={() => setViewingItem(null)}
          onEdit={(item) => {
            setViewingItem(null);
            setDialog({ mode: "edit", item });
          }}
          onChanged={reload}
          onDeleted={() => {
            setViewingItem(null);
            setPendingBought({});
            reload();
          }}
        />
      )}
    </AppFrame>
  );
}

/** 一覧の取得が済むまでの行の骨組み。追加ボタンとナビは待たずに使える（issue #724）。 */
function ShoppingListSkeleton() {
  return (
    <div role="status" aria-label="買い物リストを読み込み中" className="animate-pulse">
      {Array.from({ length: 6 }, (_, row) => (
        <div key={row} className="flex items-center gap-2 py-3 pr-3 pl-3">
          <div className="size-4 rounded-xs bg-on-surface/10" />
          <div className={cn("h-4 rounded bg-on-surface/10", row % 2 ? "w-1/3" : "w-1/2")} />
        </div>
      ))}
    </div>
  );
}

function CategoryTab({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "type-label-large flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 transition-colors",
        // 選択中は塗り・輪郭・太さの3つで示す（入力ダイアログのチップと同じ規則・issue #570）。
        // 塗りだけだと、横に送れるタブの列の中でどれを選んでいるのかが読み取りにくい。
        active
          ? "border-current bg-secondary-container font-medium text-on-secondary-container"
          : "border-outline-variant text-on-surface-variant hover:bg-on-surface/8",
      )}
    >
      {children}
      <span className="type-label-small tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function ShoppingRow({
  item,
  todayKey,
  disabled,
  onToggleBought,
  wishlist,
  onChangeClassification,
  onOpen,
}: {
  item: ShoppingItem;
  /** 「今日」「明日」を判定する基準日。設定タイムゾーンでの今日（画面側で1度だけ求める）。 */
  todayKey: string;
  disabled: boolean;
  onToggleBought: (bought: boolean) => void;
  wishlist: boolean;
  onChangeClassification: (wishlisted: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <li className="flex items-start gap-2 border-b border-rule/50 py-1.5 pr-3 pl-2">
      <PriorityBar priority={item.priority} />

      {wishlist ? (
        <Heart className="mt-[3px] size-5 shrink-0 text-primary" aria-label="欲しいもの" />
      ) : (
        <Checkbox
          className="mt-[3px]"
          checked={item.bought}
          disabled={disabled}
          aria-label={`${item.name} を購入済みにする`}
          onCheckedChange={(value) => onToggleBought(value === true)}
        />
      )}

      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="flex min-w-0 items-center gap-1.5">
          {/* min-w-0 が要る。flexの子は既定で min-width:auto のため、付けないと長い名前が
              縮まず、右の予定日が枠の外へ押し出される。 */}
          <span
            className={cn(
              "type-body-medium clip-nowrap min-w-0",
              item.bought && "text-on-surface-variant line-through",
            )}
          >
            {item.name}
          </span>
          {/* 購入予定日は名前の後ろへ流す。先に読みたいのは何を買うかで、日付はその次
              （docs/spec.md §36）。未設定のときは何も出さない。 */}
          {!wishlist && item.plannedDate && !item.bought && (
            <PlannedDateChip dateKey={item.plannedDate} todayKey={todayKey} />
          )}
        </div>
        {item.memo && (
          <div className="type-label-small clip-nowrap font-normal text-on-surface-variant">
            {item.memo}
          </div>
        )}
      </button>
      <Button
        variant="outline"
        size="sm"
        className="mt-1 shrink-0"
        disabled={disabled}
        aria-label={`${item.name}を${wishlist ? "買うもの" : "欲しいもの"}へ変更`}
        onClick={() => onChangeClassification(!wishlist)}
      >
        {wishlist ? <ArrowRight className="size-4" /> : <Heart className="size-4" />}
        <span className="hidden sm:inline">{wishlist ? "買うものへ" : "欲しいものへ"}</span>
      </Button>
    </li>
  );
}

/**
 * 行に添える購入予定日。
 *
 * 過ぎた予定日は色を分ける。買うつもりだった日を過ぎても日付はそのまま残すため（今日へ
 * 繰り上げると、いつ買うつもりだったかが消える）、まだ買っていないことがひと目で分かる
 * 必要がある。色だけに意味を持たせないよう、読み上げ用の文字を添える。
 */
function PlannedDateChip({ dateKey, todayKey }: { dateKey: string; todayKey: string }) {
  const tone = shoppingDateTone(dateKey, todayKey);

  return (
    <span
      className={cn(
        "type-label-small shrink-0 rounded px-1 tabular-nums",
        // `text-on-primary` は @theme に出ていないロール名で、書いてもTailwindが黙って捨てる
        // （CLAUDE.md「M3のカラーロール」）。同じ色は `--color-primary-foreground` にある。
        tone === "today" && "bg-primary text-primary-foreground",
        tone === "past" && "bg-error-container text-on-error-container",
        tone === "future" && "bg-secondary-container text-on-secondary-container",
      )}
    >
      <span className="sr-only">購入予定日{tone === "past" ? "（過ぎています）" : ""} </span>
      {shoppingDateLabel(dateKey, todayKey)}
    </span>
  );
}

/**
 * 行の左端に出す優先度の印。高＝3本・中＝2本・低＝1本の短い横線を縦に積む（issue #741）。
 *
 * 色だけだと「高」と「中」の差が読み取りにくいため、本数でも分ける。幅は6pxに収め、
 * 従来の縦帯（3px）に近い細さを保つ。色は従来のまま（高=error・中=tertiary）で、低だけ
 * 控えめな outline にする。読み上げ用の文字も添える。
 * タスク画面の帯とは形が分かれるが、対象はIssueの範囲どおり買い物リストのみ。
 */
const PRIORITY_LINES = { 高: 3, 中: 2, 低: 1 } as const;

function PriorityBar({ priority }: { priority: ShoppingItem["priority"] }) {
  if (!priority) return <span className="w-1.5 shrink-0" aria-hidden />;

  const tone = priority === "高" ? "bg-destructive" : priority === "中" ? "bg-tertiary" : "bg-outline";

  return (
    <>
      <span className="mt-[5px] flex w-1.5 shrink-0 flex-col gap-[2px]" aria-hidden>
        {Array.from({ length: PRIORITY_LINES[priority] }, (_, i) => (
          <span key={i} className={cn("h-[2px] w-full rounded-full", tone)} />
        ))}
      </span>
      <span className="sr-only">優先度 {priority}</span>
    </>
  );
}
