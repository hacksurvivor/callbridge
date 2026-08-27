// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "CallBridgeMacHost",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "CallBridgeMacHost", targets: ["CallBridgeMacHost"]),
    ],
    targets: [
        .executableTarget(
            name: "CallBridgeMacHost",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("Security"),
            ]
        ),
        .testTarget(
            name: "CallBridgeMacHostTests",
            dependencies: ["CallBridgeMacHost"]
        ),
    ],
    swiftLanguageVersions: [.v5]
)
