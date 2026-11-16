public struct AgentSessionConnectionID: Hashable, Sendable {
    public let rawValue: UInt64

    public init(rawValue: UInt64) {
        self.rawValue = rawValue
    }
}

public enum AgentSessionRegistration: Sendable {
    case rejected
    case claimed
    case retained
}

public struct AgentSessionOwnership: Sendable {
    private var authenticatedConnections: Set<AgentSessionConnectionID> = []
    private var wasClaimed = false
    private var sessionClosed = false

    public init() {}

    public mutating func registerConnection(
        _ connection: AgentSessionConnectionID,
        authenticated: Bool
    ) -> AgentSessionRegistration {
        guard authenticated, !sessionClosed else { return .rejected }
        let inserted = authenticatedConnections.insert(connection).inserted
        guard inserted else { return .rejected }
        guard !wasClaimed else { return .retained }
        wasClaimed = true
        return .claimed
    }

    public mutating func disconnect(_ connection: AgentSessionConnectionID) -> Bool {
        guard authenticatedConnections.remove(connection) != nil else { return false }
        guard wasClaimed, authenticatedConnections.isEmpty else { return false }
        sessionClosed = true
        return true
    }
}

public func isAuthenticatedAgentSession(
    expectedToken: String?,
    requestToken: String?,
    authorizedPeer: Bool
) -> Bool {
    guard authorizedPeer else { return false }
    guard let expectedToken, !expectedToken.isEmpty else { return false }
    return requestToken == expectedToken
}

public func isAuthorizedAgentPeer(peerPID: Int32?, peerUID: UInt32?, controllerPID: Int32, helperUID: UInt32) -> Bool {
    guard controllerPID > 0, let peerPID, let peerUID else { return false }
    return peerPID == controllerPID && peerUID == helperUID
}
