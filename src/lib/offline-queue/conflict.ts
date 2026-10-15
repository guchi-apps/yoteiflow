/**
 * オフライン中にためたタスク編集の競合判定（issue #1242）。「最終更新が新しい方」を採る。
 * サーバー・クライアントの両方から読むため、依存を持たない純粋関数だけを置く。
 */

const MINUTE_MS = 60_000;

/**
 * ためた編集を適用してよいか。
 * - サーバーの最終更新が無い、または編集を始めた時点（`baseEditedAt`）から進んでいない
 *   ＝他の端末は変えていないので適用する。
 * - 進んでいるときは端末で操作した時刻（`editedAt`）と比べ、端末のほうが新しければ適用する。
 *   Notionの `last_edited_time` は分単位に丸められるため、端末の時刻は分の切り上げで比べ、
 *   同じ分の中の前後は端末を優先する。
 */
export function shouldApplyEdit(input: {
  baseEditedAt: string | null;
  editedAt: string;
  serverLastEditedTime: string | null | undefined;
}): boolean {
  const server = parse(input.serverLastEditedTime);
  if (server === null) return true;

  const base = parse(input.baseEditedAt);
  if (base !== null && server <= base) return true;

  const edited = parse(input.editedAt);
  if (edited === null) return false;
  return Math.ceil(edited / MINUTE_MS) * MINUTE_MS >= server;
}

function parse(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
