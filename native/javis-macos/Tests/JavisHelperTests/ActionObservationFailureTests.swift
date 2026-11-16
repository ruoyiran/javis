import Foundation
import XCTest
@testable import JavisComputerUseCore

final class ActionObservationFailureTests: XCTestCase {
    func testDeliveredActionSurvivesMissingWindow() throws {
        let result = actionObservationFailure(action: ["path": "accessibility", "delivery": "background"], code: "window_not_found", message: "Window closed")
        let expected = "{\"action\":{\"path\":\"accessibility\",\"delivery\":\"background\",\"verification\":{\"state\":\"unverified\",\"reason\":\"window_changed\"}},\"observationError\":{\"code\":\"window_not_found\",\"message\":\"Window closed\"},\"snapshot\":null,\"screenshot\":null}"
        let actual = try JSONSerialization.data(withJSONObject: result, options: .sortedKeys)
        let canonical = try JSONSerialization.data(withJSONObject: JSONSerialization.jsonObject(with: Data(expected.utf8)), options: .sortedKeys)
        XCTAssertEqual(actual, canonical)
    }
    func testExistingVerificationIsPreserved() {
        let result = actionObservationFailure(action: ["delivery": "background", "verification": ["state": "verified"]], code: "app_not_found", message: "App quit")
        let action = result["action"] as? [String: Any]
        XCTAssertEqual(action?["verification"] as? [String: String], ["state": "verified"])
    }
    func testUnavailableProviderGetsUnverifiedReason() {
        let result = actionObservationFailure(action: ["delivery": "foreground"], code: "accessibility_error", message: "Read failed")
        let action = result["action"] as? [String: Any]
        XCTAssertEqual(action?["verification"] as? [String: String], ["state": "unverified", "reason": "provider_unavailable"])
    }
}
