import { resolveActivityStopUserId, shortcutError, shortcutJson } from "@/app/api/shortcuts/shared";
import { buildYahooTravelImport } from "@/lib/yahoo-transit-import";
import { getTimeZone } from "@/services/travel/plans";
import { getTravelWalk } from "@/services/travel/settings";

/** Yahoo!乗換案内の共有内容を、登録せず確認画面向けに読み取る（issue #1054）。 */
export async function POST(request: Request) {
  const auth = await resolveActivityStopUserId(request);
  if (!auth.ok) return auth.response;

  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    if (typeof body.text === "string") text = body.text;
  } catch {
    return shortcutError(400, "invalid_request", "共有された内容を読み取れませんでした。");
  }

  const timeZone = await getTimeZone(auth.userId);
  const built = buildYahooTravelImport(text, timeZone, await getTravelWalk(auth.userId));
  if (!built.ok) {
    return shortcutError(built.error === "unreadable" ? 422 : 400, built.error, built.message);
  }

  const { travel } = built;
  return shortcutJson({
    ok: true,
    travel,
    timeZone,
    message: `${travel.origin} → ${travel.destination} の経路を読み取りました。`,
  });
}
