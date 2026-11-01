import XCTest
@testable import CaptureCore
final class CaptureProtocolTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1000)
    var state: CameraState { CameraState(contextID: "training-shooter-stage", captureAllowed: true) }
    func testCommandRoundTrip() {
        let command = CaptureCommand(contextID: state.contextID, createdAt: now)
        let parsed = CaptureCommand(dictionary: command.dictionary)
        XCTAssertEqual(parsed?.id, command.id)
        XCTAssertEqual(parsed?.createdAt, now)
    }
    func testDuplicateCannotTriggerAnotherExposure() throws {
        var gate = CaptureGate(); let command = CaptureCommand(contextID: state.contextID, createdAt: now)
        try gate.accept(command, state: state, active: true, now: now)
        XCTAssertThrowsError(try gate.accept(command, state: state, active: true, now: now)) { XCTAssertEqual($0 as? CaptureRejection, .duplicate) }
    }
    func testOldOrFutureCommandsRejected() {
        for age in [-20.0, 20] {
            var gate = CaptureGate()
            XCTAssertThrowsError(try gate.accept(CaptureCommand(contextID: state.contextID, createdAt: now.addingTimeInterval(age)), state: state, active: true, now: now))
        }
    }
    func testBackgroundReviewAndChangedShooterRejected() {
        var gate = CaptureGate(); let command = CaptureCommand(contextID: state.contextID, createdAt: now)
        XCTAssertThrowsError(try gate.accept(command, state: state, active: false, now: now))
        XCTAssertThrowsError(try gate.accept(command, state: CameraState(contextID: "other", captureAllowed: true), active: true, now: now))
        XCTAssertThrowsError(try gate.accept(command, state: CameraState(contextID: state.contextID, captureAllowed: false), active: true, now: now))
    }
    func testMalformedMessagesRejected() {
        XCTAssertNil(CaptureCommand(dictionary: ["type": "capture"]))
        XCTAssertNil(CameraState(dictionary: ["contextId": "test", "captureAllowed": true, "message": String(repeating: "x", count: 501)]))
        XCTAssertEqual(CameraState(dictionary: state.dictionary), state)
    }
}
