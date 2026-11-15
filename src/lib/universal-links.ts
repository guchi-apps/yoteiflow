/**
 * iOSアプリのUniversal Link（issue #1366）。Discordなどに出る `https://…/calendar?date=…` を
 * iPhoneで押したとき、入っているアプリで開かせる。
 *
 * appID（Team ID + Bundle ID）は `ios/YoteiFlow.xcodeproj` の `DEVELOPMENT_TEAM`・
 * `PRODUCT_BUNDLE_IDENTIFIER` と、対象のパスはアプリ側の `SharedConfig.path(fromUniversalLink:)` と
 * 揃えること（`ios/scripts/check-consistency.mjs` が照合する）。
 */
export const APPLE_APP_ID = "6AA3WFTR94.com.gucchii.yoteiflow";

/**
 * AASAで広告する（＝アプリで開く）パス。ほかの画面は従来どおりSafari（ブラウザ）で開く。
 *
 * ここへ足すのは、そのパスを処理できるiOSビルドがTestFlightで配布済みになってから（issue #1529）。
 * Webは先にデプロイされ、iOSの配布は後追いのため、旧アプリが処理できないパスを広告すると、
 * アプリへ渡ったあと何も開かずSafariで開けていた経路まで壊れる。アプリ側（`SharedConfig.universalLinkPaths`）が
 * 先に対応しているのは `/tasks`（#1525）で、新ビルドの配布後に別のPRでここへ足す。
 */
export const UNIVERSAL_LINK_PATHS = ["/calendar"];

/** `/.well-known/apple-app-site-association` の中身。 */
export function appleAppSiteAssociation() {
  return {
    applinks: {
      details: [
        {
          appIDs: [APPLE_APP_ID],
          components: UNIVERSAL_LINK_PATHS.map((path) => ({ "/": path })),
        },
      ],
    },
  };
}
