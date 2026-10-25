/**
 * iOSアプリのUniversal Link（issue #1366）。Discordなどに出る `https://…/calendar?date=…` を
 * iPhoneで押したとき、入っているアプリで開かせる。
 *
 * appID（Team ID + Bundle ID）は `ios/YoteiFlow.xcodeproj` の `DEVELOPMENT_TEAM`・
 * `PRODUCT_BUNDLE_IDENTIFIER` と、対象のパスはアプリ側の `SharedConfig.path(fromUniversalLink:)` と
 * 揃えること（`ios/scripts/check-consistency.mjs` が照合する）。
 */
export const APPLE_APP_ID = "6AA3WFTR94.com.gucchii.yoteiflow";

/** アプリで開くパス。ほかの画面は従来どおりSafari（ブラウザ）で開く。 */
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
