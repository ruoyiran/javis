import Foundation

public func actionObservationFailure(action: [String: Any], code: String, message: String) -> [String: Any] {
    var action = action
    if action["verification"] == nil {
        let reason = code == "window_not_found" || code == "window_stale" ? "window_changed" : "provider_unavailable"
        action["verification"] = ["state": "unverified", "reason": reason]
    }
    return [
        "action": action,
        "observationError": ["code": code, "message": message],
        "snapshot": NSNull(),
        "screenshot": NSNull()
    ]
}
