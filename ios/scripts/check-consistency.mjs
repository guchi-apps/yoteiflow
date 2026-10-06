#!/usr/bin/env node
// サーバー（TypeScript）とiOSアプリ（Swift）で揃えておく値・判定が食い違っていないかを照合する。
// Xcodeの無い環境（subpc・CI）でも動く。`pnpm test:unit` の `src/lib/native-auth/ios-consistency.test.mts`
// が同じ関数を使う。単独でも `node ios/scripts/check-consistency.mjs` で実行できる。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(root, path), "utf-8");

/** 問題の一覧を返す（空なら整合している）。 */
export function checkConsistency() {
  const problems = [];
  const appConfig = read("ios/YoteiFlow/AppConfig.swift");
  const nativeApp = read("src/lib/native-auth/native-app.ts");
  const webViewModel = read("ios/YoteiFlow/WebViewModel.swift");
  const nativeAuth = read("ios/YoteiFlow/NativeAuth.swift");
  const pbxproj = read("ios/YoteiFlow.xcodeproj/project.pbxproj");

  const swiftScheme = appConfig.match(/authCallbackScheme = "([^"]+)"/)?.[1];
  const tsScheme = nativeApp.match(/NATIVE_SCHEME = "([^"]+)"/)?.[1];
  if (!swiftScheme || swiftScheme !== tsScheme) {
    problems.push(`戻り先スキームが一致しません: Swift=${swiftScheme} / TS=${tsScheme}`);
  }

  // 通知の設定画面とのブリッジ名（#968）
  const swiftBridge = webViewModel.match(/pushBridgeName = "([^"]+)"/)?.[1];
  const tsBridge = nativeApp.match(/NATIVE_PUSH_BRIDGE = "([^"]+)"/)?.[1];
  if (!swiftBridge || swiftBridge !== tsBridge) {
    problems.push(`通知ブリッジ名が一致しません: Swift=${swiftBridge} / TS=${tsBridge}`);
  }

  // 睡眠をHealthKitへ書くブリッジ名（#976）
  const swiftHealthBridge = webViewModel.match(/healthBridgeName = "([^"]+)"/)?.[1];
  const tsHealthBridge = nativeApp.match(/NATIVE_HEALTH_BRIDGE = "([^"]+)"/)?.[1];
  if (!swiftHealthBridge || swiftHealthBridge !== tsHealthBridge) {
    problems.push(`ヘルスブリッジ名が一致しません: Swift=${swiftHealthBridge} / TS=${tsHealthBridge}`);
  }

  // 認証シートから戻る失敗の種類（#1113）。Swiftが知らない値は auth_failed に丸められ、案内が変わる
  const parseList = (text) => (text ?? "").match(/"([^"]+)"/g)?.map((v) => v.slice(1, -1)).sort().join(",") ?? "";
  const swiftErrors = parseList(webViewModel.match(/loginErrors: Set<String> = \[([^\]]*)\]/)?.[1]);
  const tsErrors = parseList(nativeApp.match(/NATIVE_LOGIN_ERRORS = \[([^\]]*)\]/)?.[1]);
  if (!swiftErrors || swiftErrors !== tsErrors) {
    problems.push(`ログイン失敗の種類が一致しません: Swift=${swiftErrors} / TS=${tsErrors}`);
  }

  // 戻り先のホスト（auth-callback / google-connected）
  for (const host of ["auth-callback", "google-connected"]) {
    if (!nativeApp.includes(`://${host}`)) problems.push(`native-app.ts に ${host} がありません`);
    if (!webViewModel.includes(`"${host}"`)) problems.push(`WebViewModel.swift に ${host} がありません`);
  }

  // 横取りするパスは、Web側の入口と同じ
  for (const path of ["/auth/signin", "/api/google/connect"]) {
    if (!appConfig.includes(`"${path}"`)) problems.push(`AppConfig.swift が ${path} を横取りしていません`);
  }
  // 引き継ぎ・intentの経路
  for (const path of ["auth/native/start", "/auth/native/consume", "/api/google/connect/intent"]) {
    if (!webViewModel.includes(path)) problems.push(`WebViewModel.swift が ${path} を使っていません`);
  }

  // 同一オリジン判定は、スキーム・ホスト・ポートまで見る（YoteiFlow外はWebViewへ読み込まない）
  if (!/url\.scheme == baseURL\.scheme && url\.host == baseURL\.host && url\.port == baseURL\.port/.test(appConfig)) {
    problems.push("AppConfig.isAppURL がスキーム・ホスト・ポートの一致を見ていません");
  }
  if (!/openExternally\(url\)\s*\n\s*return \.cancel/.test(webViewModel)) {
    problems.push("WebViewModel.swift が外部URLをSafariで開いて .cancel していません");
  }

  // 認証シートは毎回エフェメラル（Safariの既存セッションに触れない）
  if (!nativeAuth.includes("prefersEphemeralWebBrowserSession = true")) {
    problems.push("認証シートがエフェメラルではありません");
  }

  // 共有拡張 → 本体の引き継ぎクエリのキー（#1083）。Web側の許可キーと同じ並びにする
  const sharedConfig = read("ios/Shared/SharedConfig.swift");
  const handoffTs = read("src/lib/share-import/handoff.ts");
  const swiftKeys = sharedConfig.match(/handoffQueryKeys: \[String\] = \[([^\]]+)\]/)?.[1].match(/"([^"]+)"/g)?.map((key) => key.slice(1, -1)).sort();
  const tsKeys = handoffTs.match(/HANDOFF_QUERY_KEYS = \[([^\]]+)\]/)?.[1].match(/"([^"]+)"/g)?.map((key) => key.slice(1, -1)).sort();
  if (!swiftKeys || !tsKeys || swiftKeys.join(",") !== tsKeys.join(",")) {
    problems.push(`引き継ぎクエリのキーが一致しません: Swift=${swiftKeys} / TS=${tsKeys}`);
  }

  // Bundle ID・表示名
  if (!pbxproj.includes("PRODUCT_BUNDLE_IDENTIFIER = com.gucchii.yoteiflow;")) problems.push("Bundle ID が com.gucchii.yoteiflow ではありません");
  if (!pbxproj.includes("INFOPLIST_KEY_CFBundleDisplayName = YoteiFlow;")) problems.push("表示名が YoteiFlow ではありません");

  // iPad で iPhone 互換表示へ戻さない。Web の幅別レイアウトはネイティブの端末指定が前提（#1060）。
  const ipadOrientations = [
    "UIInterfaceOrientationPortrait",
    "UIInterfaceOrientationPortraitUpsideDown",
    "UIInterfaceOrientationLandscapeLeft",
    "UIInterfaceOrientationLandscapeRight",
  ];
  for (const target of ["YoteiFlow", "YoteiFlowWidget", "YoteiFlowShare"]) {
    for (const configuration of ["Debug", "Release"]) {
      const settings = pbxproj.match(new RegExp(`/\\* ${configuration} configuration for PBXNativeTarget "${target}" \\*/ = \\{([\\s\\S]*?)\\n\\t\\t\\};`))?.[1];
      if (!settings?.includes('TARGETED_DEVICE_FAMILY = "1,2";')) {
        problems.push(`${target} ${configuration} が iPhone・iPad の両方に対応していません`);
      }
      if (target === "YoteiFlow") {
        const actualOrientations = settings?.match(/INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = "([^"]+)";/)?.[1].split(/\s+/) ?? [];
        if (new Set(actualOrientations).size !== ipadOrientations.length || actualOrientations.some((orientation) => !ipadOrientations.includes(orientation))) {
          problems.push(`${target} ${configuration} が iPad の4方向に対応していません`);
        }
        if (!settings?.includes("INFOPLIST_KEY_UISupportedInterfaceOrientations = UIInterfaceOrientationPortrait;")) {
          problems.push(`${target} ${configuration} の既定の縦向き指定がありません`);
        }
        if (!settings?.includes("INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = UIInterfaceOrientationPortrait;")) {
          problems.push(`${target} ${configuration} の iPhone 縦向き指定がありません`);
        }
      }
    }
  }
  if (pbxproj.includes("INFOPLIST_KEY_UIRequiresFullScreen") || read("ios/AppInfo.plist").includes("<key>UIRequiresFullScreen</key>")) {
    problems.push("iPad のウィンドウサイズ変更を妨げる UIRequiresFullScreen が有効です");
  }

  // 開発用のURLをコミットしていない（アプリもウィジェットも Shared/SharedConfig.swift の値を読む）
  if (!/baseURL = URL\(string: "https:\/\/dayspan\.gucchii\.com\/"\)!/.test(sharedConfig)) {
    problems.push("SharedConfig.baseURL が本番URLではありません（開発用のまま？）");
  }
  if (!appConfig.includes("baseURL = SharedConfig.baseURL")) {
    problems.push("AppConfig.baseURL が SharedConfig.baseURL を読んでいません");
  }

  // ウィジェット（#926）: App Group・ディープリンクのスキーム・埋め込みが揃っている
  const appGroup = sharedConfig.match(/appGroup = "([^"]+)"/)?.[1];
  for (const entitlements of ["ios/Config/YoteiFlow.entitlements", "ios/Config/YoteiFlowWidget.entitlements"]) {
    if (!appGroup || !read(entitlements).includes(`<string>${appGroup}</string>`)) {
      problems.push(`${entitlements} の App Group が SharedConfig.appGroup（${appGroup}）と一致しません`);
    }
  }
  const deepLinkScheme = sharedConfig.match(/deepLinkScheme = "([^"]+)"/)?.[1];
  if (!deepLinkScheme || !read("ios/AppInfo.plist").includes(`<string>${deepLinkScheme}</string>`)) {
    problems.push("AppInfo.plist の URL スキームが SharedConfig.deepLinkScheme と一致しません");
  }
  if (deepLinkScheme !== swiftScheme) {
    problems.push("ウィジェットのディープリンクのスキームが認証シートの戻り先スキームと違います（Info.plist の登録を共用している）");
  }
  if (!pbxproj.includes("PRODUCT_BUNDLE_IDENTIFIER = com.gucchii.yoteiflow.widget;")) {
    problems.push("ウィジェット拡張の Bundle ID が com.gucchii.yoteiflow.widget ではありません");
  }
  if (!pbxproj.includes("YoteiFlowWidget.appex in Embed Foundation Extensions")) {
    problems.push("ウィジェット拡張がアプリへ埋め込まれていません");
  }
  // 共有拡張（#1026）: 埋め込み・App Group・呼び先のAPIが揃っている
  if (!read("ios/Config/YoteiFlowShare.entitlements").includes(`<string>${appGroup}</string>`)) {
    problems.push("ios/Config/YoteiFlowShare.entitlements の App Group が SharedConfig.appGroup と一致しません");
  }
  if (!pbxproj.includes("PRODUCT_BUNDLE_IDENTIFIER = com.gucchii.yoteiflow.share;")) {
    problems.push("共有拡張の Bundle ID が com.gucchii.yoteiflow.share ではありません");
  }
  if (!pbxproj.includes("YoteiFlowShare.appex in Embed Foundation Extensions")) {
    problems.push("共有拡張がアプリへ埋め込まれていません");
  }
  if (!read("ios/YoteiFlowShare/ShareViewController.swift").includes('"api/shortcuts/travel/import"')) {
    problems.push("ShareViewController.swift が /api/shortcuts/travel/import を呼んでいません");
  }
  // 取得はトークン付きの既存ウィジェットAPIだけ。新しいAPIは増やさない
  const widgetApi = read("ios/YoteiFlowWidget/WidgetAPI.swift");
  if (!widgetApi.includes('"api/widget/\\(surface)"')) problems.push("WidgetAPI.swift が /api/widget/* を読んでいません");
  if (!webViewModel.includes("/api/settings/widget/native")) problems.push("WebViewModel.swift がウィジェット用トークンを受け取っていません");

  // ライブアクティビティ（#971）。停止ボタンの Intent は両ターゲットに入る Shared/ に置く
  let liveActivityClient = "";
  try {
    liveActivityClient = read("ios/Shared/LiveActivityClient.swift");
  } catch {
    // 無ければ下で指摘する
  }
  if (!liveActivityClient.includes("struct StopRecordingIntent: LiveActivityIntent")) {
    problems.push("StopRecordingIntent が ios/Shared/ にありません（アプリ本体のターゲットに型が入らず停止が動かない）");
  }
  if (!read("ios/AppInfo.plist").includes("<key>NSSupportsLiveActivities</key>")) {
    problems.push("AppInfo.plist に NSSupportsLiveActivities がありません");
  }
  if (!read("ios/YoteiFlowWidget/YoteiFlowWidgetBundle.swift").includes("RecordingLiveActivity()")) {
    problems.push("ウィジェットバンドルに RecordingLiveActivity がありません");
  }

  // App-Bound Domains（Service Worker）。宣言のホストが baseURL と一致し、WebView側で有効にしている
  const plist = read("ios/AppInfo.plist");
  const baseHost = sharedConfig.match(/baseURL = URL\(string: "https:\/\/([^\/"]+)/)?.[1];
  const bound = plist.match(/<key>WKAppBoundDomains<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? "";
  const boundHosts = [...bound.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
  if (!baseHost || !boundHosts.includes(baseHost)) {
    problems.push(`WKAppBoundDomains に baseURL のホスト(${baseHost})がありません: ${boundHosts.join(", ")}`);
  }
  if (!pbxproj.includes("INFOPLIST_FILE = AppInfo.plist;")) problems.push("INFOPLIST_FILE が AppInfo.plist ではありません");
  if (!webViewModel.includes("limitsNavigationsToAppBoundDomains = true")) {
    problems.push("WebViewModel.swift が limitsNavigationsToAppBoundDomains を有効にしていません");
  }

  // APNs（#925）。entitlement・登録API・サーバー側のBundle IDの既定が、アプリと揃っている
  const entitlements = read("ios/Config/YoteiFlow.entitlements");
  if (!/<key>aps-environment<\/key>/.test(entitlements)) problems.push("Config/YoteiFlow.entitlements に aps-environment がありません");
  if (!pbxproj.includes("CODE_SIGN_ENTITLEMENTS = Config/YoteiFlow.entitlements;")) {
    problems.push("CODE_SIGN_ENTITLEMENTS が Config/YoteiFlow.entitlements ではありません");
  }
  if (!webViewModel.includes("/api/notifications/apns")) problems.push("WebViewModel.swift が /api/notifications/apns を使っていません");
  const apnsConfig = read("src/lib/apns/config.ts");
  const apnsTopic = apnsConfig.match(/DEFAULT_APNS_TOPIC = "([^"]+)"/)?.[1];
  const bundleId = pbxproj.match(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/)?.[1];
  if (!apnsTopic || apnsTopic !== bundleId) {
    problems.push(`APNsのtopic（DEFAULT_APNS_TOPIC）が Bundle ID と一致しません: TS=${apnsTopic} / Xcode=${bundleId}`);
  }

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkConsistency();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✖ ${problem}`);
    process.exit(1);
  }
  console.log("iOSアプリとサーバーの整合: OK");
}
