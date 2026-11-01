import Foundation

public struct CameraState: Equatable {
    public var contextID: String
    public var captureAllowed: Bool
    public var message: String
    public var score: Int
    public var pendingScore: Int
    public init(contextID: String = "", captureAllowed: Bool = false, message: String = "Open Camera per serie op de iPhone.", score: Int = 0, pendingScore: Int = 0) {
        self.contextID = contextID; self.captureAllowed = captureAllowed; self.message = message; self.score = score; self.pendingScore = pendingScore
    }
    public init?(dictionary: [String: Any]) {
        guard let context = dictionary["contextId"] as? String, context.count <= 200,
              let allowed = dictionary["captureAllowed"] as? Bool,
              let message = dictionary["message"] as? String, message.count <= 500 else { return nil }
        self.init(contextID: context, captureAllowed: allowed, message: message, score: (dictionary["score"] as? Int ?? 0), pendingScore: (dictionary["pendingScore"] as? Int ?? 0))
    }
    public var dictionary: [String: Any] {
        ["contextId": contextID, "captureAllowed": captureAllowed, "message": message, "score": score, "pendingScore": pendingScore]
    }
}

public struct CaptureCommand {
    public let id: UUID
    public let contextID: String
    public let createdAt: Date
    public init(id: UUID = UUID(), contextID: String, createdAt: Date = Date()) {
        self.id = id; self.contextID = contextID; self.createdAt = createdAt
    }
    public init?(dictionary: [String: Any]) {
        guard dictionary["type"] as? String == "capture",
              let rawID = dictionary["id"] as? String, let id = UUID(uuidString: rawID),
              let context = dictionary["contextId"] as? String, !context.isEmpty, context.count <= 200,
              let milliseconds = dictionary["createdAt"] as? Double, milliseconds.isFinite else { return nil }
        self.init(id: id, contextID: context, createdAt: Date(timeIntervalSince1970: milliseconds / 1000))
    }
    public var dictionary: [String: Any] {
        ["type": "capture", "id": id.uuidString, "contextId": contextID, "createdAt": createdAt.timeIntervalSince1970 * 1000]
    }
}

public enum CaptureRejection: Error, Equatable {
    case inactive, notReady, wrongContext, stale, duplicate
}

// Do not queue shutter commands: a delayed command could photograph another series.
public struct CaptureGate {
    private var seen: [UUID] = []
    public init() {}
    public mutating func accept(_ command: CaptureCommand, state: CameraState, active: Bool, now: Date = Date()) throws {
        guard active else { throw CaptureRejection.inactive }
        guard command.contextID == state.contextID else { throw CaptureRejection.wrongContext }
        guard state.captureAllowed else { throw CaptureRejection.notReady }
        let age = now.timeIntervalSince(command.createdAt)
        guard age >= -3 && age <= 12 else { throw CaptureRejection.stale }
        guard !seen.contains(command.id) else { throw CaptureRejection.duplicate }
        seen.append(command.id)
        if seen.count > 100 { seen.removeFirst(seen.count - 100) }
    }
}
