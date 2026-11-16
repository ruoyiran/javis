// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "JavisHelper",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "JavisComputerUseCore",
            targets: ["JavisComputerUseCore"]
        ),
        .executable(
            name: "javis-helper",
            targets: ["JavisHelper"]
        )
    ],
    targets: [
        .target(
            name: "JavisComputerUseCore",
            path: "Sources/JavisComputerUseCore"
        ),
        .executableTarget(
            name: "JavisHelper",
            dependencies: ["JavisComputerUseCore"],
            path: "Sources/JavisHelper"
        ),
        .testTarget(
            name: "JavisHelperTests",
            dependencies: ["JavisComputerUseCore"],
            path: "Tests/JavisHelperTests"
        )
    ]
)
