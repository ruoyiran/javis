import XCTest
@testable import JavisComputerUseCore

final class AgentAuthorizationTests: XCTestCase {
    func testPeerMustBeExplicitControllerWithSameUID() {
        XCTAssertTrue(isAuthorizedAgentPeer(peerPID: 42, peerUID: 501, controllerPID: 42, helperUID: 501))
        XCTAssertFalse(isAuthorizedAgentPeer(peerPID: 43, peerUID: 501, controllerPID: 42, helperUID: 501))
        XCTAssertFalse(isAuthorizedAgentPeer(peerPID: 42, peerUID: 502, controllerPID: 42, helperUID: 501))
        XCTAssertFalse(isAuthorizedAgentPeer(peerPID: nil, peerUID: 501, controllerPID: 42, helperUID: 501))
        XCTAssertFalse(isAuthorizedAgentPeer(peerPID: 42, peerUID: nil, controllerPID: 42, helperUID: 501))
        XCTAssertFalse(isAuthorizedAgentPeer(peerPID: 0, peerUID: 501, controllerPID: 0, helperUID: 501))
        XCTAssertFalse(isAuthorizedAgentPeer(peerPID: -1, peerUID: 501, controllerPID: -1, helperUID: 501))
        XCTAssertTrue(isAuthorizedAgentPeer(peerPID: 1, peerUID: 501, controllerPID: 1, helperUID: 501))
    }

    func testSessionRequiresTokenEvenForAuthorizedPeer() {
        XCTAssertFalse(isAuthenticatedAgentSession(expectedToken: nil, requestToken: nil, authorizedPeer: true))
        XCTAssertFalse(isAuthenticatedAgentSession(expectedToken: "", requestToken: "", authorizedPeer: true))
        XCTAssertFalse(isAuthenticatedAgentSession(expectedToken: "secret", requestToken: "wrong", authorizedPeer: true))
        XCTAssertFalse(isAuthenticatedAgentSession(expectedToken: "secret", requestToken: "secret", authorizedPeer: false))
        XCTAssertTrue(isAuthenticatedAgentSession(expectedToken: "secret", requestToken: "secret", authorizedPeer: true))
    }
}
