"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

import { ItemDialog, type ItemDrafts } from "@/components/calendar/item-dialog";
import {
  createCalendarDateUtils,
  daysUntilLabel,
  elapsedDaysLabel,
  formatDateKeyJa,
  reminderAnnualOriginLabel,
} from "@/components/calendar/item-layout";
import { toReminderDraft } from "@/components/calendar/reminder-form";
import { ReminderDetailDialog } from "@/components/calendar/reminder-detail-dialog";
import { SettingsMenuButton } from "@/components/nav/settings-menu-button";
import { SettingsFrame } from "@/components/nav/settings-frame";
import { SettingsBottomNav } from "@/components/nav/settings-bottom-nav";
import { TagChip } from "@/components/tags/tag-chip";
import { tagColorOf } from "@/components/tags/tag-color";
import { OfflineNotice } from "@/components/offline/offline-notice";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/refresh-button";
import {
  buildReminderSections,
  type ReminderOccurrence,
} from "@/services/notion/reminder-order";
import type { TagCatalog, TagOption } from "@/services/notion/tag-options";
import type { PlaceCatalog } from "@/services/notion/places";
import type { ReminderItem, WritableCalendar } from "@/types/calendar";

export function ReminderList({
  reminders,
  tagCatalog,
  timeZone,
  loadError,
  calendars = [],
  placeCatalog = { ready: false, places: [] },
  weekStartsOn = 0,
}: {
  reminders: ReminderItem[];
  /** 登録済みのタグ・種類。色の表示と入力の候補に使う。 */
  tagCatalog: TagCatalog;
  timeZone: string;
  loadError: string | null;
  calendars?: WritableCalendar[];
  placeCatalog?: PlaceCatalog;
  weekStartsOn?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [itemDialog, setItemDialog] = useState<ItemDrafts | null>(null);
  // タップした直後は表示専用画面を開く。編集アイコンを押したときだけ draft へ切り替える。
  // 次に来る日も一緒に持つ。表示画面へ渡して「次は◯年◯月◯日（◯年目）」を出すため。
  const [viewing, setViewing] = useState<ReminderOccurrence | null>(null);
  // 過ぎた日付は既定で畳む。件数が増え続けるうえ、一覧を開く理由は次に来る日を見ることのため。
  // まだ押されていない間は null にして、DBの構成から決めた既定に従う（下の pastExpanded）。
  const [pastOpen, setPastOpen] = useState<boolean | null>(null);

  // オフライン中は書き込みを止める（docs/spec.md §21）。
  const offline = useOffline();
  useReconnectRefresh();

  // オフラインでこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  // ナビからの移動はソフトナビゲーションで、Service Worker が保存できないため。
  useWarmOfflinePage("/reminders");

  // 追加の初期値は今日から。実行環境のローカル時刻ではなく設定タイムゾーンで求める。
  const utils = useMemo(() => createCalendarDateUtils(timeZone), [timeZone]);
  // 「今日」の基準。設定タイムゾーンで求めるため、サーバーとブラウザで同じ値になる。
  const todayKey = useMemo(() => utils.todayKey(), [utils]);

  // 次に来る日の早い順に月ごとの区分へ束ねる（issue #288）。
  const { sections, past } = useMemo(
    () => buildReminderSections(reminders, todayKey, utils.itemDateKey),
    [reminders, todayKey, utils],
  );

  // 「毎年」は任意のプロパティで、未設定のDBでは全項目が annual === null になる。その場合は
  // 誕生日・記念日まで単発として扱われ、過去の日付がまとめて折りたたみへ入るため、
  // 開いた直後の一覧がほとんど空に見える。毎年かどうかが分かるDBでのみ既定で畳む。
  const annualKnown = useMemo(
    () => reminders.some((reminder) => reminder.annual !== null),
    [reminders],
  );
  const pastExpanded = pastOpen ?? !annualKnown;

  // 年の区切りを出す位置。見出しは月だけにして、年が変わったときにだけ添える。
  // 最初の区分は今日の年と比べる（年内に来る項目が1件も無いと、先頭から翌年になるため）。
  const monthSections = useMemo(
    () =>
      sections.map((section, index) => ({
        ...section,
        showYear:
          section.year !==
          (index === 0 ? Number(todayKey.slice(0, 4)) : sections[index - 1].year),
      })),
    [sections, todayKey],
  );

  const edit = (reminder: ReminderItem) => {
    if (offline) return;
    setViewing(null);
    setItemDialog({ reminder: toReminderDraft(reminder, timeZone) });
  };

  /**
   * 右下の「＋」からの追加。日付リマインドを新しく作れるのはこの画面だけ（docs/spec.md §9・§15）。
   *
   * タスクは併設しない（issue #729）。入力は種類の切り替えを持たず、ここが開くのは
   * この画面の主題である日付リマインドだけ。タスクはタスク画面から作る。
   */
  const openAdd = () => {
    setItemDialog({ reminder: { dateMode: "date", date: utils.todayKey() } });
  };

  return (
    <SettingsFrame>
    <div className="flex h-app flex-col">
      {/* 日付リマインドは下部ナビの5枠から外れ、ドロワーの「そのほか」に移った（issue #508）。
          一度登録すれば数年触らないため、勤務・場所・設定と同じ「戻るボタン付き」の骨格にする。 */}
      <header className="flex items-center gap-1 bg-surface-container-low px-1 py-1.5 md:gap-2 md:px-2 md:py-2">
        <SettingsMenuButton />
        <h1 className="type-title-large min-w-0 flex-1 truncate px-1">日付</h1>
        {/* 取得中はこのアイコンが回る（issue #1271）。 */}
        <RefreshButton spinning={pending} disabled={offline} onClick={() => startTransition(() => router.refresh())} />
      </header>
      <OfflineNotice />
      {loadError && <div className="bg-error-container/70 px-3 py-2 text-xs text-on-error-container">{loadError}</div>}
      {/* 広い画面では一覧を48remの幅に収めて中央へ置く（issue #636）。行が画面の端から端まで伸びると、
          日付と「あと5日」が両端へ離れて1行として読みにくい。スクロールの箱そのものは狭めず
          （狭めるとスクロールバーが一覧の横に来て、余白の上でホイールが効かない）、左右の余白で寄せる。 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6 md:px-[max(0px,calc((100%_-_48rem)/2))]">
        {monthSections.map((section) => (
          <section key={section.key}>
            {section.showYear && (
              <div className="flex items-center gap-3 px-4 pt-4 pb-1 type-label-small text-on-surface-variant">
                <span className="h-px flex-1 bg-rule" />
                {section.year}年
                <span className="h-px flex-1 bg-rule" />
              </div>
            )}
            <h2 className="sticky top-0 z-10 flex items-center gap-2 bg-surface-container-low px-4 py-1.5 type-label-large text-on-surface-variant">
              {section.month}月
              <span className="type-label-small opacity-70">{section.items.length}</span>
            </h2>
            <ul className="divide-y divide-rule">
              {section.items.map((occurrence) => (
                <ReminderRow
                  key={occurrence.item.id}
                  occurrence={occurrence}
                  todayKey={todayKey}
                  itemDateKey={utils.itemDateKey}
                  categoryOptions={tagCatalog.reminder ?? []}
                  onOpen={() => setViewing(occurrence)}
                />
              ))}
            </ul>
          </section>
        ))}

        {/* 過ぎた単発の項目には次に来る日が無い。時系列の先頭へ置くと直近の項目がその下に沈むため、
            末尾へ分けて畳んでおく（タスク画面の完了の区分と同じ考え方）。 */}
        {past.length > 0 && (
          <section>
            <h2 className="sticky top-0 z-10 bg-surface-container-low">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 px-4 py-1.5 text-left type-label-large text-on-surface-variant"
                aria-expanded={pastExpanded}
                onClick={() => setPastOpen(!pastExpanded)}
              >
                {pastExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                過ぎた日付
                <span className="type-label-small opacity-70">{past.length}</span>
              </button>
            </h2>
            {pastExpanded && (
              <ul className="divide-y divide-rule">
                {past.map((occurrence) => (
                  <ReminderRow
                    key={occurrence.item.id}
                    occurrence={occurrence}
                    todayKey={todayKey}
                    itemDateKey={utils.itemDateKey}
                    categoryOptions={tagCatalog.reminder ?? []}
                    onOpen={() => setViewing(occurrence)}
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {reminders.length === 0 && !loadError && <p className="p-6 text-center text-sm text-muted-foreground">日付リマインドがありません。</p>}
      </div>

      <Button
        size="icon"
        className="elevation-3 fixed right-4 bottom-[calc(7.5rem_+_env(safe-area-inset-bottom))] z-20 md:bottom-[calc(1.5rem_+_env(safe-area-inset-bottom))] size-16 rounded-xl bg-primary-container text-on-primary-container hover:brightness-95 active:rounded-md"
        aria-label="日付リマインドを追加"
        disabled={offline}
        onClick={openAdd}
      >
        <Plus className="size-6" />
      </Button>

      {/* スマホ幅では下部ナビを下端に固定する（issue #1348）。追加ボタンはそのぶん上げている。 */}
      <SettingsBottomNav />

      {itemDialog && (
        <ItemDialog
          initialKind={
            itemDialog.event ? "event" : itemDialog.reminder ? "reminder" : "task"
          }
          drafts={itemDialog}
          calendars={calendars}
          tagCatalog={tagCatalog}
          placeCatalog={placeCatalog}
          timeZone={timeZone}
          weekStartsOn={weekStartsOn}
          onClose={() => setItemDialog(null)}
          onSaved={() => {
            setItemDialog(null);
            startTransition(() => router.refresh());
          }}
        />
      )}

      {viewing && (
        <ReminderDetailDialog
          reminder={viewing.item}
          categoryOptions={tagCatalog.reminder ?? []}
          timeZone={timeZone}
          nextDateKey={viewing.nextKey}
          readOnly={offline}
          onClose={() => setViewing(null)}
          onEdit={() => edit(viewing.item)}
          onDeleted={() => {
            setViewing(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
    </SettingsFrame>
  );
}

/**
 * 一覧の1行。次に来る日の月日をバッジに出し、メタ行で「あと何日か」と起点を示す。
 *
 * 毎年の項目には経過日数を出さない（issue #288）。同じ行の「あと5日」と役割が重なるうえ、
 * 「24,102日経過」は行の中でいちばん長い文字列になり、項目名を押し出すため。
 * 正確な日数は表示ダイアログで読める。
 */
function ReminderRow({
  occurrence,
  todayKey,
  itemDateKey,
  categoryOptions,
  onOpen,
}: {
  occurrence: ReminderOccurrence;
  todayKey: string;
  itemDateKey: (value: string) => string;
  categoryOptions: TagOption[];
  onOpen: () => void;
}) {
  const { item, nextKey } = occurrence;
  const until = daysUntilLabel(nextKey, todayKey);
  const elapsed = item.annual ? null : elapsedDaysLabel(nextKey, todayKey);
  // 毎年の項目は起点の年を出す（issue #288 の「年表示は発生した初回の年にする」）。
  // 単発は次に来る日がその項目の日付そのものなので、そのまま出す。
  const origin = reminderAnnualOriginLabel(item, nextKey, itemDateKey);

  return (
    <li>
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
        onClick={onOpen}
      >
        <div className="min-w-14 rounded-lg bg-tertiary-container px-2 py-1 text-center text-on-tertiary-container">
          <div className="text-xs">{Number(nextKey.slice(5, 7))}月</div>
          <div className="text-xl font-semibold leading-5">{Number(nextKey.slice(8, 10))}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="type-body-large">{item.title}</div>
          <div className="type-body-small flex flex-wrap items-center gap-1.5 text-on-surface-variant">
            {until && <span className="font-medium text-primary">{until}</span>}
            {elapsed && <span className="text-tertiary">{elapsed}</span>}
            <span>{origin ?? formatDateKeyJa(nextKey)}</span>
            {item.annual !== null && <Badge variant="outline">{item.annual ? "毎年" : "単発"}</Badge>}
            {item.category && (
              <TagChip name={item.category} color={tagColorOf(categoryOptions, item.category)} />
            )}
            {item.memo && <span className="clip-nowrap">{item.memo}</span>}
          </div>
        </div>
      </button>
    </li>
  );
}
