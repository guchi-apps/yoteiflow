import { Briefcase, Plus } from "lucide-react";
import { createContext, useContext } from "react";

import { tagChipClass, tagColorOf } from "@/components/tags/tag-color";
import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";
import { cn } from "@/lib/utils";
import { workShortLabel } from "@/lib/work-short-label";
import type { TagOption } from "@/services/notion/tag-options";
import {
  HOLIDAY_TITLE,
  isDefaultHolidayTitle,
  isPartialLeave,
  type WorkRecordItem,
} from "@/types/work";

/**
 * カレンダーに出す勤務場所（docs/spec.md §34）。
 *
 * 勤務場所は1日1件で、時刻も長さも持たない「その日そのものの属性」。予定・タスク・移動が並ぶ面へ
 * 混ぜると、毎日必ず1件あるぶんだけ月表示の段と終日エリアが埋まる。Google Calendarへ書き出さないと
 * 決めた理由（§34）がそのままDaySpanの中で起きるため、項目としてではなく日付の見出しへ添える。
 *
 * **チップ自体は押下を受けない**（`pointer-events-none`）。月表示ではセルの押下が「その日の1日表示へ
 * 移動」に決まっており、そこへ別の行き先を重ねると、日を開くつもりの操作が入力画面になる。
 * 時間グリッドでは日付ヘッダーが何の押下も受けていないため、チップを包む**スロットの側**を押せる
 * ようにして勤務の入力を開く（issue #532）。押下を受け持つのはそのスロットで、ここではない。
 *
 * 名前は残った幅ぶんだけ出すが、**文字の途中では切らない**（issue #406）。1文字ずつ折り返させ、
 * 1行ぶんの高さ（`leading-[15px]`）で隠すことで、入る文字だけが丸ごと残る。pxで切ると、
 * スマートフォンの月表示（チップに残るのは約21px）で2文字目が数pxだけ顔を出した形で切れ、
 * 色も形も壊れて見えた。置き場所の側は `@container` にしておく必要がある。
 *
 * **狭い列では、印より名前を先に残す**（issue #433）。出張だけは印を名前より優先していたため、
 * スマートフォンの月表示ではカバンの絵しか出ず、行き先が読めなかった。出張のチップに入るのは
 * 行き先（「大阪」）で、それこそがその日について読みたいもの。片方しか置けない幅では名前を残し、
 * 印は両方入る幅（31px以上）でだけ添える。引き換えに、その幅では出張と通常の勤務を分けるものが
 * 色だけになる（種別は読み上げと勤務の画面・1日表示に残る）。
 *
 * 加えて**狭い列（31px未満）では文字を8px・左右の余白を2pxへ詰める**。10pxのままだと
 * 幅390pxの端末の月表示（チップに残るのは約21px）で1文字しか入らず、「大」だけでは行き先も
 * 勤務場所も読めないため。8px＋余白4pxなら2文字（16px）が入る。高さ（`leading-[15px]`）は
 * 変えないので、日付の見出しの高さは動かない。
 *
 * 8pxにするのは幅で決めており、出張かどうかでは分けない。同じ月表示の中で出張の日だけ文字の
 * 大きさが違うと、幅で決まっているはずの見え方が種別で変わって見える。狭い列では通常の勤務・
 * 年休・会社休業日も8pxになるが、そこは10pxでも1文字しか入らない幅で、名前が読めるほうを採る。
 *
 * **出張の色は勤務場所ではなく travel の1色に固定する**（issue #549）。チップの色は勤務場所の
 * 選択肢が持つNotionのタグ色から引いているが、出張が持つのは自由記述の行き先で、色を持たない。
 * 入力ダイアログから出張へ勤務場所を書き込まなくしたため、`place` から引くと同じ出張でも
 * 「今日の勤務場所の1押しで作った出張（場所の色）」と「ダイアログで作った出張（既定の灰）」で
 * 見た目が分かれる。作り方で色が変わらないよう、出張は1色に決める。travel を充てるのは、
 * 勤務の画面が出張の行き先を `text-travel` で出しており、アプリの中で出張に使っている色だから。
 * 印（ブリーフケース）が落ちる狭い列（31px未満）でも、色だけで出張だと分かる。
 */

/**
 * 狭い列（31px未満＝スマホ幅の月表示）で名前の代わりに出す1文字（issue #1381）。
 * 設定 ▸ 勤務で勤務場所ごとに決めた文字を、画面ごとに配らず文脈で渡す。
 */
export const WorkShortLabelsContext = createContext<Record<string, string>>({});

/** 出張のチップの色。行き先ごとには変えられないため1色に決める（issue #549）。 */
const TRIP_CHIP_CLASS = "bg-travel/18 text-travel";
export function WorkPlaceChip({
  record,
  options,
  className,
}: {
  record: WorkRecordItem;
  /** 勤務場所の選択肢。色はNotionのselectのプロパティ定義が一次情報源（docs/spec.md §34）。 */
  options: TagOption[];
  className?: string;
}) {
  const label = workPlaceLabel(record);
  const shortLabels = useContext(WorkShortLabelsContext);
  if (!label) return null;
  const shortLabel = workShortLabel(record, shortLabels);
  return (
    <span
      // 押下は通す。月表示では日のセル全体を覆う「1日表示へ移動」のボタンへ、時間グリッドでは
      // このチップを包む勤務スロットのボタンへ届く（issue #532）。
      className={cn(
        // 狭い列では文字と余白を詰める（8px・左右2px）。高さは据え置き。
        "pointer-events-none inline-flex min-w-0 items-center gap-[3px] overflow-hidden rounded-xs px-1 text-[10px] leading-[15px] font-medium whitespace-nowrap",
        // 1文字へ切り替わる幅では、チップの方が文字より広いので中央へ置く（issue #1410）。
        "@max-[31px]:justify-center @max-[31px]:px-0.5",
        record.businessTrip
          ? TRIP_CHIP_CLASS
          : tagChipClass(tagColorOf(options, record.place ?? "")),
        className,
      )}
    >
      {/*
        出張の印。名前と両方入る幅（余白8px＋印10px＋間隔3px＋文字10px＝31px）でだけ添え、
        それより狭い列では落とす（issue #433）。印は縮まないため、名前と取り合う幅で残すと
        名前の側だけが消える。行き先のほうが読む価値が高い。
      */}
      {record.businessTrip && <Briefcase aria-hidden className="size-2.5 shrink-0 @max-[31px]:hidden" />}
      {/*
        色だけに意味を持たせない（1文字も入らない幅では名前を出さず色だけが残る）。
        読み上げには何の値なのかと名前の全体まで残す。見えている名前のほうは目のための
        ものとして読み上げから外す（幅で消えるのは見えている側だけにする）。
      */}
      <span className="sr-only">
        {record.companyHoliday
          ? HOLIDAY_TITLE
          : record.annualLeave
            ? "年休"
            : record.businessTrip
              ? "出張"
              : "勤務場所"}{" "}
        {label}
      </span>
      <>
          <span
        aria-hidden
        // 31px以上は名前、31px未満は1文字へ切り替える（issue #1381）。1文字（10px）も入らない
        // 幅（余白4px＋10px）では色だけを残す。
        className="h-[15px] min-w-0 overflow-hidden break-all whitespace-normal @max-[31px]:hidden"
      >
        {label}
          </span>
          <span
        aria-hidden
        className="hidden h-[15px] min-w-0 overflow-hidden whitespace-nowrap @max-[31px]:inline @max-[14px]:hidden"
      >
        {shortLabel}
          </span>
      </>
    </span>
  );
}

/**
 * 幅ごとの見え方（狭い列は文字8px・余白4px、31px以上は文字10px・余白8px から決まる）。
 *
 * | チップに残る幅 | 通常の勤務・年休・休み | 出張 |
 * |---|---|---|
 * | 31px以上 | 10px・入る文字だけ | 10px・印＋入る文字だけ |
 * | 12〜31px | 8px・入る文字だけ | 8px・入る文字だけ |
 * | 12px未満 | 色だけ | 色だけ |
 *
 * 幅390pxの端末の月表示でチップに残るのは約21px で、8pxの文字が2つ入る（幅375pxで約19px、
 * 1文字）。判定は画面幅ではなく**チップに残っている幅**で行う（列の幅は表示形式と画面幅の
 * 掛け算で決まるため、ブレークポイントで切るとPCの月表示のような幅のある列でも文字が縮む・
 * docs/spec.md §34）。
 *
 * 12pxを割るのは幅320px前後より狭い端末の月表示だけ（列45.7px − 罫線1px − セルの余白4px −
 * 数字28px ≒ 12px）。月の変わり目の日（数字が `9/1` のように広がる）は `px-1` へ詰めてあり
 * `min-w-7`（28px）に収まるため、他の日と残り幅は変わらない。
 */

/**
 * チップに出す文字列。
 *
 * 通常の勤務は勤務場所そのもの（勤務の画面はタイトルにも同じ値を入れる）。出張はタイトルに
 * 行き先が入っており、そちらのほうが「どこへ行っているか」を示す。
 *
 * 年休はタイトル（「年休（午前半休）」）をそのまま出すと、狭い列では末尾から切れて
 * 括弧の途中で終わる。全休は「年休」まで、半休・時間休は区分と残りの勤務場所を出す
 * （勤務場所だけにすると年休だと分からず、区分だけにするとその日出社したことが消える）。
 * 時間休は区分そのものが `3時間休` なので、そのまま `3時間休・在宅` になる。
 *
 * 会社休業日は名称（「夏季休業」）があればそれを出す。名称を入れずに登録した記録は
 * タイトルの既定値そのものが「休み」（`HOLIDAY_TITLE`）で、ダイアログの見出し・日別一覧・
 * 月間集計とも表記が揃っている（issue #536）。以前の既定タイトル「会社休業日」で保存済みの
 * 記録も同じく名称なし扱いにして「休み」と出す（`isDefaultHolidayTitle()`）。
 */
export function workPlaceLabel(record: WorkRecordItem): string {
  if (record.companyHoliday) {
    return record.title && !isDefaultHolidayTitle(record.title) ? record.title.trim() : "休み";
  }
  if (record.annualLeave) {
    if (!isPartialLeave(record.annualLeave)) return "年休";
    return record.place ? `${record.annualLeave}・${record.place}` : record.annualLeave;
  }
  const label = record.businessTrip ? record.title : (record.place ?? record.title);
  return label.trim();
}

/**
 * 日付キーから勤務記録を引ける形にする。
 *
 * 出張は期間の全ての日にかかるため、かかる日すべてへ同じ記録を置く。1日1件（重なりは
 * 保存時に断っている・docs/spec.md §34）なので、同じ日に2件入ることはない。
 * 取得側で期間の下限を切っているため（services/notion/work-logs.ts）、展開する日数も有限。
 */
export function workRecordsByDate(records: WorkRecordItem[]): Map<string, WorkRecordItem> {
  const byDate = new Map<string, WorkRecordItem>();

  for (const record of records) {
    if (record.endDate < record.startDate) continue;

    let cursor = parseDateKey(record.startDate);
    let dateKey = record.startDate;

    // 壊れた日付で伸び続けないよう上限を置く（月表示の窓は前後1ヶ月ぶんしか持たない）。
    for (let index = 0; index < 400 && dateKey <= record.endDate; index += 1) {
      byDate.set(dateKey, record);
      cursor = addDays(cursor, 1);
      dateKey = toDateKey(cursor);
    }
  }

  return byDate;
}

/**
 * 勤務の記録が無い日に出す、押せる場所の印（issue #532）。
 *
 * 日付ヘッダーの勤務スロットは記録の有無によらず常に置く。無い日を空欄のままにすると、
 * そこから勤務を入れられること自体が画面に出ない。一方でこの印は毎日出るもので、週表示では
 * 7つ並ぶため、10px・輪郭色・不透明度0.7に留めて予定の面より前へ出さない。
 *
 * `＋` の意味（この日の勤務を登録する）は押下側の `aria-label` が持つ。ここでは絵だけを描く。
 */
export function WorkSlotAddMark() {
  return (
    <span aria-hidden className="grid size-[15px] place-items-center text-outline opacity-70">
      <Plus className="size-2.5" strokeWidth={2.5} />
    </span>
  );
}
