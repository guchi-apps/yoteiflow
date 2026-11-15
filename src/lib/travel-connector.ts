/**
 * 時間グリッドで、移動と紐づく予定の左の色帯を細い線でつなぐ（issue #1554・docs/spec.md §38）。
 *
 * 移動と、その移動が向かう（帰る）予定が同じ日に離れて置かれていると、どれとどれが1組なのか
 * 画面から読めない。間の空いた時間へ予定の色の線を引き、色帯が縦につながって見えるようにする。
 *
 * ここは描いた位置（px）と列（`layoutOverlaps` の column / columns）だけを受け取る純粋関数で、
 * 横位置のCSS（レーンぶんの左余白を含む `calc()`）は呼び出し側が組み立てる。
 *
 * 照合は既存の判定（`calendar-shell.tsx`）と同じ `linkedEventId === event.id` に揃える。
 * Googleの予定IDはカレンダーをまたぐと一意とは限らず、`TravelItem` は `linkedCalendarId` を
 * 持たないため、別カレンダーに同じIDの予定がある場合は誤ってつながりうる（実害は線1本で、
 * 移動の詳細の紐づけ表示と同じ割り切り）。
 */

export type ConnectorBox = {
  id: string;
  /** 描いた位置（px）。最小の高さへ伸ばしたあとの値を渡す。 */
  top: number;
  height: number;
  column: number;
  columns: number;
};

export type ConnectorTravel = ConnectorBox & { linkedEventId: string | null };

export type ConnectorColumn = { column: number; columns: number };

export type TravelConnector = {
  key: string;
  /** 紐づく予定のID。色・仮・中止の見た目を引くのに使う。 */
  eventId: string;
  /** 線の上端と下端（px）。 */
  top: number;
  bottom: number;
  /** 上にある項目の列（線はその色帯の位置から下りる）。 */
  upper: ConnectorColumn;
  /** 下にある項目の列（線はその色帯の位置へ届く）。 */
  lower: ConnectorColumn;
  /** 左端の位置がずれるとき、横へ折る高さ（px）。ずれないときは null。 */
  bendAt: number | null;
};

/** これより短い隙間には線を出さない（接している・1px程度の隙間は並びで分かる）。 */
export const MIN_CONNECTOR_GAP = 2;

const sameLeft = (a: ConnectorColumn, b: ConnectorColumn) =>
  a.column * b.columns === b.column * a.columns;

/**
 * 1つの日の列に描いた移動・予定から、引く線を求める。
 *
 * 渡すのはこの列に「日をまたがずに」描かれていて、掴んで動かしていない項目だけにする
 * （日をまたぐ項目・ドラッグ中の項目は呼び出し側で外す）。紐づく予定がこの列に無ければ
 * （別の日・活動記録のレーン・表示範囲の外）線は出さない。
 */
export function travelConnectors(
  travels: ConnectorTravel[],
  events: ConnectorBox[],
): TravelConnector[] {
  const byId = new Map(events.map((event) => [event.id, event]));

  return travels.flatMap((travel) => {
    if (!travel.linkedEventId) return [];
    const event = byId.get(travel.linkedEventId);
    if (!event) return [];

    const travelBottom = travel.top + travel.height;
    const eventBottom = event.top + event.height;

    // 移動が予定より上（行き）か下（帰り）か。重なっていれば線は要らない。
    let upper: ConnectorBox;
    let lower: ConnectorBox;
    if (travelBottom <= event.top) {
      upper = travel;
      lower = event;
    } else if (eventBottom <= travel.top) {
      upper = event;
      lower = travel;
    } else {
      return [];
    }

    const top = upper.top + upper.height;
    const bottom = lower.top;
    if (bottom - top < MIN_CONNECTOR_GAP) return [];

    const upperColumn = { column: upper.column, columns: upper.columns };
    const lowerColumn = { column: lower.column, columns: lower.columns };

    return [
      {
        key: `${travel.id}:${event.id}`,
        eventId: event.id,
        top,
        bottom,
        upper: upperColumn,
        lower: lowerColumn,
        bendAt: sameLeft(upperColumn, lowerColumn) ? null : Math.round((top + bottom) / 2),
      },
    ];
  });
}
