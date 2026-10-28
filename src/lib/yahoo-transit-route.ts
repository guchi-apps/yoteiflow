/**
 * Yahoo!乗換案内の「共有 ▸ コピー」で得られる経路のテキストを読む（docs/spec.md §29）。
 *
 * **ここから外部へは問い合わせない。** Yahoo!路線情報は「情報や画面の二次利用については
 * 原則としてご遠慮いただいております」としており、結果ページをDaySpanが取得して読むことは
 * できない。駅すぱあとの結果ページの読み取りを見送ったのと同じ判断（§29「取得元の選定」）。
 * 読むのは、利用者が自分で選び自分でコピーした文字列だけにする。
 *
 * 受け取る文字列の形（アプリの共有 ▸ コピー）:
 *
 * ```
 * 草津(滋賀県) ⇒ 高槻
 * 2026年8月28日(金)
 * 20:58 ⇒ 21:46
 * ------------------------------
 * 所要時間 48分
 * 運賃[IC優先] 750円
 * 乗換 0回
 * 距離 43.8 km
 * ------------------------------
 *
 * ■草津(滋賀県)
 * ↓ 20:58〜21:21
 * ↓ ＪＲ琵琶湖線 姫路行
 * ↓ 4・5番線着
 * ▼[乗換不要] 京都
 * ↓ 21:24〜21:46
 * ↓ ＪＲ京都線 姫路行
 * ■高槻
 *
 * [Yahoo!乗換案内]
 * ↓ アプリのダウンロードはこちらから
 * https://transit.yahoo.co.jp/smartphone/app/
 *
 * ※定期代やチケット設定が含まれた検索結果は個人の設定に依存するため、上記の文面やリンク先の
 * 経路・料金が、送信元と受取先で一致しない場合がございますのでご注意ください。
 * ```
 *
 * メモへ入れるのは、この `[Yahoo!乗換案内]` より前の部分をそのまま（`noteText`）。
 * 要約への作り替えはしない（issue #498）。
 */

export type YahooTransitRoute = {
  /** 出発・到着時刻（`HH:MM`）。この2つが読めなければ、そもそも取り込まない。 */
  departTime: string;
  arriveTime: string;
  /**
   * 検索した日。**入力欄の日付を差し替えるためには使わない。**
   * 移動の日と食い違っているときに、そう知らせるためだけに持つ。
   */
  searchedDate: { year: number; month: number; day: number } | null;
  /** 「所要時間 48分」の値。時刻から計算した分数と食い違うときは時刻を優先する。 */
  minutes: number | null;
  transitCount: number | null;
  fromStation: string | null;
  toStation: string | null;
  /**
   * メモへそのまま入れる経路の生テキスト。貼り付けた文字列からアプリの案内文・注意書き
   * （`[Yahoo!乗換案内]` 以降）だけを取り除き、それ以外は要約せずそのまま使う（issue #498）。
   * 所要時間・運賃・距離・号車/番線・運賃内訳・共有URL・乗換駅名などを、要約への作り替えで
   * 落とさないため。
   */
  noteText: string;
  /**
   * 始点側・終点側の最初／最後の区間がすでに徒歩か（座標・住所で検索したドアtoドアの経路。issue #1463）。
   * 駅から駅の経路なら false。区間を読めない経路は判別できないため true にして、徒歩を足さない側へ倒す。
   */
  walkAtStart: boolean;
  walkAtEnd: boolean;
};

/**
 * 経路全体の発着時刻の行（`20:58 ⇒ 21:46`）。
 *
 * **波ダッシュ（`〜`）は受けない。** 区間ごとの行（`↓ 20:58〜21:21`）が同じ形になり、
 * 最初の乗車区間の終わりを到着時刻として拾ってしまう。矢印だけに絞れば、
 * 当たった行は経路全体の要約に限られる。
 */
const RANGE = /(\d{1,2}):(\d{2})\s*(?:⇒|=>|→|➡|▶)\s*(\d{1,2}):(\d{2})/;

/** 単独の時刻。上の形に当たらないとき（Webからのなぞりコピー）の受け皿に使う。 */
const TIME = /(\d{1,2}):(\d{2})/g;

const DATE = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/;
const MINUTES = /所要時間\s*(?:(\d+)\s*時間)?\s*(?:(\d+)\s*分)?/;
const TRANSFERS = /乗換\s*(\d+)\s*回/;

/**
 * 経路のテキストを読む。読めなければ null（呼び出し元は何も書き換えない）。
 *
 * **必須なのは発着時刻だけ。** 日付・所要時間・乗換回数・駅名は、読めれば取り込み結果の
 * 表示・出発地目的地欄に使うだけで、欠けても取り込みそのものは成り立つ。Yahoo!側の文面が
 * 変わったときに、1項目の欠けで時刻まで失わないようにするため（trainrouteの応答の
 * 読み方と同じ扱い）。`noteText` はこれらと違い、案内文を切り落とすだけで他の項目の
 * 読み取り結果に依存しないため、発着時刻さえ読めれば常に入る。
 */
export function parseYahooTransitRoute(text: string): YahooTransitRoute | null {
  if (!text.trim()) return null;

  // アプリの案内文・注意書きは経路ではない。ここから下は拾わない。
  // 行頭が「※」の行（運賃欄の注記など）だけでは区切らない。経路詳細の途中にも現れうるため、
  // そこで区切ると乗換回数・駅名・路線名まで消えてしまう（issue #491）。
  const body = text.split(/\[Yahoo!乗換案内\]/)[0];
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const times = readTimes(lines);
  if (!times) return null;

  const stations = readStations(lines);

  return {
    departTime: times.departTime,
    arriveTime: times.arriveTime,
    searchedDate: readDate(body),
    minutes: readMinutes(body),
    transitCount: readTransfers(body),
    fromStation: stations.at(0) ?? null,
    toStation: stations.length > 1 ? (stations.at(-1) ?? null) : null,
    noteText: body.trim(),
    ...readEdgeWalks(lines),
  };
}

/**
 * 始点（先頭の `■`／`▼`）から次の印まで、終点（最後の印）の直前の印から終点までに「徒歩」の行があるか。
 * 印が2つ未満で区間を取り出せないときは両側とも true（足さない）にする。
 */
function readEdgeWalks(lines: string[]): { walkAtStart: boolean; walkAtEnd: boolean } {
  const marks = lines.flatMap((line, index) => (line.startsWith("■") || line.startsWith("▼") ? [index] : []));
  if (marks.length < 2) return { walkAtStart: true, walkAtEnd: true };
  const hasWalk = (from: number, to: number) => lines.slice(from + 1, to).some((line) => line.includes("徒歩"));
  return {
    walkAtStart: hasWalk(marks[0], marks[1]),
    walkAtEnd: hasWalk(marks[marks.length - 2], marks[marks.length - 1]),
  };
}

/**
 * 出発・到着時刻を決める。
 *
 * まず `20:58 ⇒ 21:46` の行を探す。この形は経路の要約そのもので、区間ごとの時刻
 * （`↓ 20:58〜21:21`）と取り違えようがない。**先頭の1つだけを採る**のは、
 * 区間の行も同じ形を持つため（`〜` を許すぶん、2つ目以降は乗車区間になる）。
 *
 * 当たらなければ、文字列中の時刻を出現順に拾って最初と最後を採る。Webの結果ページを
 * なぞってコピーした場合はこちらに落ちる。
 */
function readTimes(lines: string[]): { departTime: string; arriveTime: string } | null {
  for (const line of lines) {
    const matched = RANGE.exec(line);
    if (matched) {
      return {
        departTime: toTime(matched[1], matched[2]),
        arriveTime: toTime(matched[3], matched[4]),
      };
    }
  }

  const found = [...lines.join("\n").matchAll(TIME)];
  if (found.length < 2) return null;

  const first = found[0];
  const last = found[found.length - 1];
  return { departTime: toTime(first[1], first[2]), arriveTime: toTime(last[1], last[2]) };
}

function toTime(hour: string, minute: string): string {
  return `${hour.padStart(2, "0")}:${minute}`;
}

function readDate(text: string): YahooTransitRoute["searchedDate"] {
  const matched = DATE.exec(text);
  if (!matched) return null;
  return { year: Number(matched[1]), month: Number(matched[2]), day: Number(matched[3]) };
}

/** 「所要時間 1時間48分」「所要時間 48分」の両方を受ける。 */
function readMinutes(text: string): number | null {
  const matched = MINUTES.exec(text);
  if (!matched) return null;
  const hours = matched[1] ? Number(matched[1]) : 0;
  const minutes = matched[2] ? Number(matched[2]) : 0;
  const total = hours * 60 + minutes;
  return total > 0 ? total : null;
}

function readTransfers(text: string): number | null {
  const matched = TRANSFERS.exec(text);
  return matched ? Number(matched[1]) : null;
}

/**
 * 乗降駅・乗換駅。`■` が始点と終点、`▼` が乗換駅。
 *
 * `▼[乗換不要] 京都` のように角括弧の注記が付くため、先頭の記号ごと落とす。
 */
function readStations(lines: string[]): string[] {
  return lines
    .filter((line) => line.startsWith("■") || line.startsWith("▼"))
    .map((line) => line.replace(/^[■▼]\s*/, "").replace(/^\[[^\]]*\]\s*/, "").trim())
    .filter((name) => name !== "");
}

/**
 * 読み取った経路を入力欄の値（`YYYY-MM-DDTHH:mm`）にする。
 *
 * **日付は動かさない。** 基準は入力欄の出発日で、Yahoo!側が検索した日は使わない。
 * 「今から」検索した結果をそのまま入れると、来週の予定の移動が今日へ飛び、
 * ダイアログを閉じたあとでは気付けない（検索日が違うことは呼び出し元が報せに添える）。
 *
 * 到着が出発より前になる経路（終電など）は、日をまたいだものとして到着を翌日にする。
 */
export function yahooRouteFields(
  route: YahooTransitRoute,
  baseDate: string,
): { departAt: string; arriveAt: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) return null;

  const arriveDate = route.arriveTime <= route.departTime ? nextDay(baseDate) : baseDate;
  return {
    departAt: `${baseDate}T${route.departTime}`,
    arriveAt: `${arriveDate}T${route.arriveTime}`,
  };
}

/** 翌日の日付キー。 */
function nextDay(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * 検索した日を入力欄の日付キー（`YYYY-MM-DD`）にする。読めていなければ null。
 *
 * **予定に紐づかない新規の移動でだけ使う（呼び出し元の判断）。** 紐づく移動では
 * 「日付は動かさない」原則（`yahooRouteFields()`）のまま、入力欄の日付を基準にし続ける。
 */
export function yahooSearchedDateKey(route: YahooTransitRoute): string | null {
  const searched = route.searchedDate;
  if (!searched) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${searched.year}-${pad(searched.month)}-${pad(searched.day)}`;
}

/**
 * 出発地・目的地欄へそのまま入れるための駅名。
 *
 * `readStations()` が返す駅名には、同名駅を区別する `(都道府県)` の注記が付くことがある
 * （例: `草津(滋賀県)`）。メモ（`noteText`）にはこの注記ごと残したいが、出発地・目的地欄に
 * 入れると `splitNameAndAddress()`（`place-text.ts`）が丸括弧の中の都道府県名を住所の一部と
 * 誤認し、次にYahoo!乗換案内を開くときの地点解決が崩れる。欄に入れる用途だけ、末尾の注記を落とす。
 */
export function yahooStationName(station: string): string {
  return station.replace(/[（(][^（）()]*[）)]\s*$/, "").trim();
}
