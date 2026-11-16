import Darwin
import Foundation
import JavisComputerUseCore
import Security

struct TrustedJavisController {
    private let bundlePath: String
    private let teamIdentifier: String

    static func currentBundle() -> TrustedJavisController? {
        guard Bundle.main.bundleIdentifier == "com.royran.javis" else { return nil }
        let bundlePath = canonicalPath(Bundle.main.bundleURL.path)
        let helperPath = bundlePath + "/Contents/MacOS/javis-helper"
        guard processExecutablePath(getpid()) == helperPath,
              let bundleCode = staticCode(at: bundlePath),
              SecStaticCodeCheckValidity(bundleCode, SecCSFlags(rawValue: kSecCSStrictValidate), nil) == errSecSuccess,
              let bundleIdentity = signingIdentity(bundleCode),
              bundleIdentity.identifier == "com.royran.javis",
              let selfCode = ownCode(),
              SecCodeCheckValidity(selfCode, SecCSFlags(), nil) == errSecSuccess,
              let staticSelfCode = staticCode(from: selfCode),
              let selfIdentity = signingIdentity(staticSelfCode),
              selfIdentity.identifier == bundleIdentity.identifier,
              selfIdentity.teamIdentifier == bundleIdentity.teamIdentifier
        else {
            return nil
        }
        return TrustedJavisController(bundlePath: bundlePath, teamIdentifier: bundleIdentity.teamIdentifier)
    }

    func contains(_ pid: pid_t) -> Bool {
        guard pid > 0,
              let executablePath = processExecutablePath(pid),
              let arguments = processArguments(pid),
              arguments.count == 3,
              arguments[0].hasPrefix("/"),
              arguments[1].hasPrefix("/"),
              TrustedJavisControllerCommand.matches(
                  bundlePath: bundlePath,
                  executablePath: executablePath,
                  arguments: [canonicalPath(arguments[0]), canonicalPath(arguments[1]), arguments[2]]
              ),
              let code = processCode(pid),
              SecCodeCheckValidity(code, SecCSFlags(), nil) == errSecSuccess,
              let staticProcessCode = staticCode(from: code),
              let identity = signingIdentity(staticProcessCode),
              identity.identifier == "com.royran.javis.node",
              identity.teamIdentifier == teamIdentifier,
              let signedPath = codePath(staticProcessCode),
              signedPath == executablePath
        else {
            return false
        }
        return true
    }
}

private func canonicalPath(_ path: String) -> String {
    URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath().path
}

private func processExecutablePath(_ pid: pid_t) -> String? {
    var path = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    let capacity = UInt32(path.count)
    guard proc_pidpath(pid, &path, capacity) > 0,
          let end = path.firstIndex(of: 0),
          let decoded = String(bytes: path[..<end].map { UInt8(bitPattern: $0) }, encoding: .utf8)
    else { return nil }
    return canonicalPath(decoded)
}

private func processArguments(_ pid: pid_t) -> [String]? {
    var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
    let mibCount = u_int(mib.count)
    var size = 0
    guard sysctl(&mib, mibCount, nil, &size, nil, 0) == 0,
          size >= MemoryLayout<Int32>.size,
          size <= 1_048_576
    else { return nil }
    var bytes = [UInt8](repeating: 0, count: size)
    let readStatus = bytes.withUnsafeMutableBytes { buffer in
        sysctl(&mib, mibCount, buffer.baseAddress, &size, nil, 0)
    }
    guard readStatus == 0, size >= MemoryLayout<Int32>.size else { return nil }
    let argumentCount = bytes.withUnsafeBytes { $0.loadUnaligned(as: Int32.self) }
    guard argumentCount == 3 else { return nil }

    var cursor = MemoryLayout<Int32>.size
    guard let executableEnd = bytes[cursor..<size].firstIndex(of: 0) else { return nil }
    cursor = executableEnd + 1
    while cursor < size && bytes[cursor] == 0 { cursor += 1 }

    var arguments: [String] = []
    for _ in 0..<argumentCount {
        guard cursor < size,
              let end = bytes[cursor..<size].firstIndex(of: 0),
              let value = String(bytes: bytes[cursor..<end], encoding: .utf8)
        else { return nil }
        arguments.append(value)
        cursor = end + 1
    }
    return arguments
}

private func staticCode(at path: String) -> SecStaticCode? {
    var code: SecStaticCode?
    let status = SecStaticCodeCreateWithPath(URL(fileURLWithPath: path) as CFURL, SecCSFlags(), &code)
    return status == errSecSuccess ? code : nil
}

private func ownCode() -> SecCode? {
    var code: SecCode?
    return SecCodeCopySelf(SecCSFlags(), &code) == errSecSuccess ? code : nil
}

private func processCode(_ pid: pid_t) -> SecCode? {
    var code: SecCode?
    let attributes = [kSecGuestAttributePid as String: NSNumber(value: pid)] as CFDictionary
    return SecCodeCopyGuestWithAttributes(nil, attributes, SecCSFlags(), &code) == errSecSuccess ? code : nil
}

private func staticCode(from code: SecCode) -> SecStaticCode? {
    var staticCode: SecStaticCode?
    return SecCodeCopyStaticCode(code, SecCSFlags(), &staticCode) == errSecSuccess ? staticCode : nil
}

private func codePath(_ code: SecStaticCode) -> String? {
    var path: CFURL?
    return SecCodeCopyPath(code, SecCSFlags(), &path) == errSecSuccess
        ? path.map { canonicalPath(($0 as URL).path) }
        : nil
}

private func signingIdentity(_ code: SecStaticCode) -> (identifier: String, teamIdentifier: String)? {
    var information: CFDictionary?
    guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
          let details = information as? [String: Any],
          let identifier = details[kSecCodeInfoIdentifier as String] as? String,
          let teamIdentifier = details[kSecCodeInfoTeamIdentifier as String] as? String,
          !teamIdentifier.isEmpty
    else { return nil }
    return (identifier, teamIdentifier)
}
