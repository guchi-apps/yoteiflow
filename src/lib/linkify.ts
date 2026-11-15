/**
 * 自由入力の複数行テキスト（予定の説明・タスク/移動/日付リマインド/買い物のメモ等）に混じった
 * URLを検出し、地の文とURLのセグメント列へ分ける（issue #833）。
 *
 * 検出パターンは `map-link.ts` の「場所欄が `http(s)://` で始まるときはそのURLを開く」と同じ
 * `https?://` のみにする。bare domain・メールアドレスは対象外（判定基準を1つに揃える）。
 *
 * 日本語は語の区切りに空白を挟まないため（「詳細はこちらhttps://example.com以上です」のように
 * URLの直後へ地の文が続く）、空白以外の文字を無条件に拾う `[^\s]+` では地の文まで一緒に飲み込む。
 * 実際のURLはASCIIの範囲（英数字・予約/非予約文字・%エンコード）でしか書けないため、文字集合を
 * それに絞る。これにより全角文字（漢字・かな・全角記号）は最初から一致対象に入らず、地の文との
 * 境目がそこで決まる。
 */

/** `label` は表示用の文字列（省略時は `url` をそのまま見せる）。 */
export type TextSegment = { type: "text"; value: string } | { type: "link"; url: string; label?: string };

/**
 * Morrow（メール連携）がタスク・予定のメモへ書く「Morrowで開く: /mail/<メールID>」は、サイトのパスだけで
 * ホストを持たないためそのままではリンクにならない（issue #1524）。直前の「Morrowで開く:」を手掛かりに
 * このパスだけをMorrowの本番URLへ補ってリンクにする（任意の相対パスはリンク化しない）。
 */
export const MORROW_BASE_URL = "https://aide-bot.gucchii.com";

const URL_PATTERN =
  /(?<=Morrowで開く[:：][ \t]*)\/mail\/[\w\-.~%]+|(?<![\w])https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi;

/**
 * URLの直後に地続きで来たASCIIの句読点・括弧類のうち、URL本体ではないものだけを切り離す。
 *
 * 閉じ括弧は対応関係を見る。開きがURLの外（文の側）にあれば余分な閉じ括弧として切り離し、
 * URL自身が持つ対応の取れた括弧（`https://en.wikipedia.org/wiki/Foo_(bar)` 等）は残す。
 */
function trimTrailingPunctuation(url: string): string {
  const bracketPairs: Record<string, string> = {
    ")": "(",
    "]": "[",
    "}": "{",
  };
  const simpleTrailingChars = new Set([".", ",", ";", ":", "!", "?", "'"]);

  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    const openChar = bracketPairs[ch];
    if (openChar) {
      const substr = url.slice(0, end);
      const opens = countOccurrences(substr, openChar);
      const closes = countOccurrences(substr, ch);
      if (opens >= closes) break; // 対応が取れている（か開きが余っている）＝URL自身の括弧
      end -= 1;
      continue;
    }
    if (simpleTrailingChars.has(ch)) {
      end -= 1;
      continue;
    }
    break;
  }
  return url.slice(0, end);
}

function countOccurrences(text: string, char: string): number {
  let count = 0;
  for (const c of text) if (c === char) count += 1;
  return count;
}

/** テキストを地の文とURLのセグメント列へ分ける。改行は `text` セグメントの中身にそのまま残る。 */
export function splitTextWithLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const raw = match[0];
    if (raw.startsWith("/")) {
      if (start > lastIndex) segments.push({ type: "text", value: text.slice(lastIndex, start) });
      segments.push({ type: "link", url: `${MORROW_BASE_URL}${raw}`, label: raw });
      lastIndex = start + raw.length;
      continue;
    }
    const url = trimTrailingPunctuation(raw);
    // 記号だけの断片（プロトコルの後に実質何も残らない）はURL扱いにしない。
    if (!url || !/^https?:\/\/./i.test(url)) continue;

    if (start > lastIndex) segments.push({ type: "text", value: text.slice(lastIndex, start) });
    segments.push({ type: "link", url });
    lastIndex = start + url.length;
  }

  if (lastIndex < text.length) segments.push({ type: "text", value: text.slice(lastIndex) });

  return segments;
}
