/**
 * 移動の経由地（`TravelPlan.via`）の読み書き（issue #1197）。
 *
 * DBには経由地の名前の配列をJSON文字列で持つ。noteへ混ぜると利用者の編集や追記で壊れるため、専用の列にする。
 * 読めない値（壊れたJSON・文字列以外）は経由なしとして扱い、移動そのものは壊さない。
 */

const MAX_VIA = 5;
const MAX_VIA_TEXT = 500;

/** 画面・APIから受けた値を経由地の配列へ整える。空白は落とし、上限を超える分は捨てる。 */
export function normalizeVia(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text && text.length <= MAX_VIA_TEXT) result.push(text);
    if (result.length >= MAX_VIA) break;
  }
  return result;
}

/** DBの値（JSON文字列）を配列へ。壊れた値は空配列。 */
export function parseVia(stored: string | null | undefined): string[] {
  if (!stored) return [];
  try {
    return normalizeVia(JSON.parse(stored));
  } catch {
    return [];
  }
}

/** DBへ書く値。経由地が無ければ null。 */
export function serializeVia(via: unknown): string | null {
  const normalized = normalizeVia(via);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}
