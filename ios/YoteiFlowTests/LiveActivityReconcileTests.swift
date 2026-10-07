import XCTest

final class LiveActivityReconcileTests: XCTestCase {
    private let running = LiveActivityReconcile.Running(title: "仕事", startedAtEpoch: 1_000)
    private let other = LiveActivityReconcile.Running(title: "睡眠", startedAtEpoch: 500)

    func testNoRunningEndsAllExisting() {
        XCTAssertEqual(
            LiveActivityReconcile.decide(running: nil, existing: [running, other]),
            [.end(index: 0), .end(index: 1)])
    }

    func testNoRunningAndNoExistingDoesNothing() {
        XCTAssertEqual(LiveActivityReconcile.decide(running: nil, existing: []), [])
    }

    func testRunningWithoutExistingRequests() {
        XCTAssertEqual(LiveActivityReconcile.decide(running: running, existing: []), [.request(running)])
    }

    func testMatchingExistingNeedsNoAction() {
        XCTAssertEqual(LiveActivityReconcile.decide(running: running, existing: [running]), [])
    }

    func testDifferingExistingIsUpdated() {
        XCTAssertEqual(
            LiveActivityReconcile.decide(running: running, existing: [other]),
            [.update(index: 0, running)])
    }

    func testDuplicatesAreEndedKeepingFirst() {
        XCTAssertEqual(
            LiveActivityReconcile.decide(running: running, existing: [running, running]),
            [.end(index: 1)])
    }
}
