import Foundation
let now = Date(timeIntervalSince1970: 1000)
let state = CameraState(contextID: "training-shooter-stage", captureAllowed: true)
let command = CaptureCommand(contextID: state.contextID, createdAt: now)
var checks = 0
func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    precondition(condition(), message); checks += 1; print("PASS " + message)
}
func rejects(_ expected: CaptureRejection, _ operation: () throws -> Void) {
    do { try operation(); preconditionFailure("Expected rejection") }
    catch { check(error as? CaptureRejection == expected, "reject \(expected)") }
}
check(CaptureCommand(dictionary: command.dictionary)?.id == command.id, "capture message round trip")
check(CameraState(dictionary: state.dictionary) == state, "camera status round trip")
check(CaptureCommand(dictionary: ["type": "capture"]) == nil, "malformed request")
var gate = CaptureGate()
try gate.accept(command, state: state, active: true, now: now)
rejects(.duplicate) { try gate.accept(command, state: state, active: true, now: now) }
rejects(.inactive) { try gate.accept(CaptureCommand(contextID: state.contextID, createdAt: now), state: state, active: false, now: now) }
rejects(.wrongContext) { try gate.accept(CaptureCommand(contextID: "another-shooter", createdAt: now), state: state, active: true, now: now) }
rejects(.notReady) { try gate.accept(command, state: CameraState(contextID: state.contextID), active: true, now: now) }
rejects(.stale) { try gate.accept(CaptureCommand(contextID: state.contextID, createdAt: now.addingTimeInterval(-20)), state: state, active: true, now: now) }
rejects(.stale) { try gate.accept(CaptureCommand(contextID: state.contextID, createdAt: now.addingTimeInterval(20)), state: state, active: true, now: now) }
check(CameraState(dictionary: ["contextId": "x", "captureAllowed": true, "message": String(repeating: "x", count: 501)]) == nil, "oversized state rejected")
print("\(checks) compiled Swift protocol checks passed")
