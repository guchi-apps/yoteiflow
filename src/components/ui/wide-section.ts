/**
 * 広い画面で、一覧の区分（タスクの期限・タグ、買い物のカテゴリ）を1枚のカードにするクラス（issue #636）。
 *
 * 付くのは本文の列（AppFrame の `@container/main`）が36rem以上のときだけで、狭い画面の描画は変えない。
 *
 * `overflow-hidden` ではなく `overflow-clip` にする。hidden だと区分そのものがスクロールの箱になり、
 * 中の見出しの `sticky` が本文のスクロールに対して効かなくなる。clip は角丸で切るだけで箱を作らない。
 */
export const WIDE_SECTION_CARD_CLASS =
  "@xl/main:overflow-clip @xl/main:rounded-xl @xl/main:border @xl/main:border-outline-variant @xl/main:bg-surface-container-lowest";

/**
 * カードの中の見出し。本文の地と同じ色のままだとカードの面と区別が付かないため一段だけ塗る。
 * 畳んだ区分（完了）では見出しが最後の子になり、下の罫線がカードの枠と二重になるため外す。
 */
export const WIDE_SECTION_HEADING_CLASS =
  "@xl/main:bg-surface-container-low @xl/main:last:border-b-0";

/** カードの中の一覧。最後の行の罫線はカードの枠と重なるため外す。 */
export const WIDE_SECTION_LIST_CLASS = "@xl/main:[&>li:last-child]:border-b-0";

/**
 * 1枚のカードの中に行を並べる一覧（場所・設定トップ）を、1024px以上で2列にしたときの1行のクラス。
 * カードを `@3xl/main:grid @3xl/main:grid-cols-2` にして、行へこれを足す（行は `not-last:border-b` を持つ前提）。
 *
 * 左の列の行に縦の区切りを引く。件数が偶数だと左の列の最下行が最後の子ではないため下の罫線が残り、
 * カードの枠と二重になるので外す。
 */
export const WIDE_TWO_COLUMN_ROW_CLASS =
  "@3xl/main:odd:border-r @3xl/main:odd:border-outline-variant @3xl/main:[&:nth-last-child(2):nth-child(odd)]:border-b-0";
