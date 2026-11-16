import XCTest
@testable import JavisComputerUseCore

final class TrustedJavisControllerCommandTests: XCTestCase {
    private let bundlePath = "/Users/alice/Applications/Javis.app"
    private let nodePath = "/Users/alice/Applications/Javis.app/Contents/Resources/node"
    private let cliPath = "/Users/alice/Applications/Javis.app/Contents/Resources/cli.cjs"

    func testAcceptsOnlyBundledNodeRunningBundledDaemonEntry() {
        XCTAssertTrue(TrustedJavisControllerCommand.matches(
            bundlePath: bundlePath,
            executablePath: nodePath,
            arguments: [nodePath, cliPath, "--internal-daemon"]
        ))
    }

    func testRejectsControllerOutsideHelperBundle() {
        XCTAssertFalse(TrustedJavisControllerCommand.matches(
            bundlePath: bundlePath,
            executablePath: "/opt/homebrew/bin/node",
            arguments: ["/opt/homebrew/bin/node", cliPath, "--internal-daemon"]
        ))
        XCTAssertFalse(TrustedJavisControllerCommand.matches(
            bundlePath: bundlePath,
            executablePath: "/Users/alice/Applications/Javis.app.fake/Contents/Resources/node",
            arguments: ["/Users/alice/Applications/Javis.app.fake/Contents/Resources/node", cliPath, "--internal-daemon"]
        ))
    }

    func testRejectsDifferentScriptOrNodeOptions() {
        XCTAssertFalse(TrustedJavisControllerCommand.matches(
            bundlePath: bundlePath,
            executablePath: nodePath,
            arguments: [nodePath, "/Users/alice/evil/cli.cjs", "--internal-daemon"]
        ))
        XCTAssertFalse(TrustedJavisControllerCommand.matches(
            bundlePath: bundlePath,
            executablePath: nodePath,
            arguments: [nodePath, "--require", "/Users/alice/evil/loader.cjs", cliPath, "--internal-daemon"]
        ))
        XCTAssertFalse(TrustedJavisControllerCommand.matches(
            bundlePath: bundlePath,
            executablePath: nodePath,
            arguments: [nodePath, cliPath, "--internal-daemon", "--inspect"]
        ))
    }

    func testRejectsMissingDaemonModeAndSpoofedArgvZero() {
        XCTAssertFalse(TrustedJavisControllerCommand.matches(
            bundlePath: bundlePath,
            executablePath: nodePath,
            arguments: [nodePath, cliPath]
        ))
        XCTAssertFalse(TrustedJavisControllerCommand.matches(
            bundlePath: bundlePath,
            executablePath: nodePath,
            arguments: ["node", cliPath, "--internal-daemon"]
        ))
    }
}
