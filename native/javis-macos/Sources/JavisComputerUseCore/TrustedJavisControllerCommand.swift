public enum TrustedJavisControllerCommand {
    public static func matches(bundlePath: String, executablePath: String, arguments: [String]) -> Bool {
        let nodePath = bundlePath + "/Contents/Resources/node"
        let cliPath = bundlePath + "/Contents/Resources/cli.cjs"
        return executablePath == nodePath &&
            arguments == [nodePath, cliPath, "--internal-daemon"]
    }
}
