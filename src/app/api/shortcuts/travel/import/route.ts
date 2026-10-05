import { resolveActivityStopUserId, shortcutError, shortcutJson } from "@/app/api/shortcuts/shared";
import { externalApiMessage } from "@/lib/api-error";
import { parseSharedTravelBody, type SharedTravelBody } from "@/lib/share-import/travel-body";
import { buildYahooTravelImport, type YahooTravelImport } from "@/lib/yahoo-transit-import";
import { getTimeZone, importSharedTravel } from "@/services/travel/plans";

/**
 * Yahoo!乗換案内の共有（iOS共有拡張）から、予定に紐づかない移動を作る（issue #1026・docs/spec.md §29）。
 * 本文は `{ text }`。読み取りの規則は移動の入力欄への貼り付けと同じ（`buildYahooTravelImport`）。
 */
export async function POST(request: Request) {
  const auth = await resolveActivityStopUserId(request);
  if (!auth.ok) return auth.response;

  let text = "";
  let shared: unknown;
  try {
    const body = (await request.json()) as { text?: unknown; travel?: unknown };
    if (typeof body.text === "string") text = body.text;
    shared = body.travel;
  } catch {
    return shortcutError(400, "invalid_request", "共有された内容を読み取れませんでした。");
  }

  // Googleマップの経路は preview で解析済みの結果が `travel` で届く（AIを再実行しない・issue #1083）
  let travel: SharedTravelBody | YahooTravelImport;
  if (shared !== undefined) {
    const parsed = parseSharedTravelBody(shared);
    if (!parsed) return shortcutError(400, "invalid_request", "経路の内容が正しくないため登録しませんでした。");
    travel = parsed;
  } else {
    const built = buildYahooTravelImport(text, await getTimeZone(auth.userId));
    if (!built.ok) {
      return shortcutError(built.error === "unreadable" ? 422 : 400, built.error, built.message);
    }
    travel = built.travel;
  }
  const label = `${travel.origin} → ${travel.destination}`;
  try {
    const { duplicate, result } = await importSharedTravel(auth.userId, travel);
    if (duplicate) {
      return shortcutJson({ ok: true, duplicate: true, message: `${label} は登録済みです。` });
    }

    const exported = result?.exports[0];
    const message =
      exported && exported.status === "failed"
        ? `${label} を登録しました（Googleカレンダーへの書き出しは失敗しました。アプリで保存し直してください）。`
        : `${label} を登録しました。`;
    return shortcutJson({ ok: true, duplicate: false, message });
  } catch (error) {
    const reason = error instanceof Error ? error.message : externalApiMessage("google", "travel import", error);
    console.error("[dayspan] travel import failed:", reason);
    return shortcutError(400, "travel_create_failed", reason);
  }
}
