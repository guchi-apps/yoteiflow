import { buildYahooTravelImport } from "@/lib/yahoo-transit-import";
import { SHARE_IMPORT_HEADINGS, type ShareImportResult } from "@/lib/share-import/types";

/** メモの生テキストから運賃（円）を拾う。「運賃」を含む行を優先し、読めなければ null。 */
export function yahooFare(note: string): number | null {
  const line = note.split(/\r?\n/).find((value) => /運賃|IC|円/.test(value) && /\d[\d,]*\s*円/.test(value));
  const match = line ? /(\d[\d,]*)\s*円/.exec(line) : null;
  if (!match) return null;
  const fare = Number(match[1].replace(/,/g, ""));
  return Number.isSafeInteger(fare) && fare > 0 ? fare : null;
}

/** Yahoo!乗換案内の共有テキストを共通モデルへ変換する。解析の規則は `buildYahooTravelImport` のまま。 */
export function resolveYahooShare(text: string, timeZone: string): ShareImportResult {
  const built = buildYahooTravelImport(text, timeZone);
  if (!built.ok) {
    return { ok: false, status: built.error === "unreadable" ? 422 : 400, error: built.error, message: built.message };
  }
  const { travel } = built;
  const minutes = Math.round((new Date(travel.arriveAt).getTime() - new Date(travel.departAt).getTime()) / 60_000);
  return {
    ok: true,
    item: {
      source: "yahoo_transit",
      type: "route",
      heading: SHARE_IMPORT_HEADINGS.yahooRoute,
      title: `${travel.origin} → ${travel.destination}`,
      origin: travel.origin,
      destination: travel.destination,
      address: null,
      coordinates: null,
      startAt: travel.departAt,
      endAt: travel.arriveAt,
      durationMinutes: minutes > 0 ? minutes : null,
      fare: yahooFare(travel.note),
      mode: travel.mode,
      sourceUrl: null,
      detail: travel.note || null,
      estimated: false,
      registrable: true,
    },
  };
}
