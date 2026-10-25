import XCTest

final class SharedConfigTests: XCTestCase {
    func testDeepLinkRoundTrip() {
        for path in SharedConfig.deepLinkPaths where path != SharedConfig.handoffPath {
            XCTAssertEqual(SharedConfig.path(fromDeepLink: SharedConfig.deepLink(path: path)), path)
        }
    }

    func testCalendarDeepLinkWithoutQuery() {
        XCTAssertEqual(SharedConfig.path(fromDeepLink: SharedConfig.deepLink(path: "/calendar")), "/calendar")
    }

    func testRejectsPathOutsideAllowList() {
        XCTAssertNil(SharedConfig.path(fromDeepLink: SharedConfig.deepLink(path: "/settings")))
        XCTAssertNil(SharedConfig.path(fromDeepLink: SharedConfig.deepLink(path: "//evil.com")))
    }

    func testRejectsOtherSchemeOrHost() {
        XCTAssertNil(SharedConfig.path(fromDeepLink: URL(string: "https://open?path=/tasks")!))
        XCTAssertNil(SharedConfig.path(fromDeepLink: URL(string: "yoteiflow://other?path=/tasks")!))
        XCTAssertNil(SharedConfig.path(fromDeepLink: URL(string: "yoteiflow://open")!))
    }

    func testHandoffKeepsOnlyAllowedKeys() {
        let url = SharedConfig.handoffURL(query: ["title": "会議", "evil": "x", "empty": ""])
        let path = SharedConfig.path(fromDeepLink: url)
        XCTAssertNotNil(path)
        XCTAssertTrue(path!.hasPrefix("/calendar?"))
        XCTAssertTrue(path!.contains("title="))
        XCTAssertFalse(path!.contains("evil"))
    }

    func testHandoffTruncatesLongValuesButNotNote() {
        let long = String(repeating: "a", count: 3_000)
        let url = SharedConfig.handoffURL(query: ["title": long, "note": long])
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertEqual(items.first { $0.name == "title" }?.value?.count, 2_048)
        XCTAssertEqual(items.first { $0.name == "note" }?.value?.count, 3_000)
    }

    func testDeepLinkDropsOverlongHandoffValue() {
        let long = String(repeating: "a", count: 2_049)
        var c = URLComponents()
        c.scheme = SharedConfig.deepLinkScheme
        c.host = SharedConfig.deepLinkHost
        c.queryItems = [URLQueryItem(name: "path", value: "/calendar"), URLQueryItem(name: "title", value: long)]
        XCTAssertEqual(SharedConfig.path(fromDeepLink: c.url!), "/calendar")
    }

    // Universal Link（issue #1366）
    func testUniversalLinkOpensCalendarDate() {
        let url = URL(string: "https://dayspan.gucchii.com/calendar?date=2026-11-09")!
        XCTAssertEqual(SharedConfig.path(fromUniversalLink: url), "/calendar?date=2026-11-09")
        XCTAssertEqual(SharedConfig.path(fromUniversalLink: URL(string: "https://dayspan.gucchii.com/calendar")!), "/calendar")
    }

    func testUniversalLinkDropsOtherQuery() {
        let url = URL(string: "https://dayspan.gucchii.com/calendar?date=2026-11-09&next=//evil.com")!
        XCTAssertEqual(SharedConfig.path(fromUniversalLink: url), "/calendar?date=2026-11-09")
    }

    func testUniversalLinkRejectsOthers() {
        for text in [
            "http://dayspan.gucchii.com/calendar?date=2026-11-09",
            "https://evil.com/calendar?date=2026-11-09",
            "https://dayspan.gucchii.com:8443/calendar?date=2026-11-09",
            "https://dayspan.gucchii.com/tasks",
            "https://dayspan.gucchii.com/calendar/x",
            "https://dayspan.gucchii.com/calendar?date=2026-11-9",
            "https://dayspan.gucchii.com/calendar?date=tomorrow",
            "https://dayspan.gucchii.com/calendar?date=2026-11-09&date=2026-11-10",
            "yoteiflow://open?path=/calendar",
        ] {
            XCTAssertNil(SharedConfig.path(fromUniversalLink: URL(string: text)!), text)
        }
    }

    func testWidgetDeepLinkIsNotUniversalLink() {
        // 既存のウィジェットの経路は従来どおり path(fromDeepLink:) だけが受ける
        let deepLink = SharedConfig.deepLink(path: "/tasks")
        XCTAssertEqual(SharedConfig.path(fromDeepLink: deepLink), "/tasks")
        XCTAssertNil(SharedConfig.path(fromDeepLink: URL(string: "https://dayspan.gucchii.com/calendar?date=2026-11-09")!))
    }
}
