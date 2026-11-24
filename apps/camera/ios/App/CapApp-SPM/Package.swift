// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.6.2"),
        .package(name: "CapacitorCommunityCameraPreview", path: "../../../../../node_modules/.pnpm/@capacitor-community+camera_9e79c0f318c345173fafe18a7209c213/node_modules/@capacitor-community/camera-preview"),
        .package(name: "CapacitorCommunityKeepAwake", path: "../../../../../node_modules/.pnpm/@capacitor-community+keep-awake@8.0.1_@capacitor+core@8.6.2/node_modules/@capacitor-community/keep-awake"),
        .package(name: "CapacitorPreferences", path: "../../../../../node_modules/.pnpm/@capacitor+preferences@8.0.1_@capacitor+core@8.6.2/node_modules/@capacitor/preferences"),
        .package(name: "CapacitorScreenOrientation", path: "../../../../../node_modules/.pnpm/@capacitor+screen-orientation@8.0.2_@capacitor+core@8.6.2/node_modules/@capacitor/screen-orientation")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunityCameraPreview", package: "CapacitorCommunityCameraPreview"),
                .product(name: "CapacitorCommunityKeepAwake", package: "CapacitorCommunityKeepAwake"),
                .product(name: "CapacitorPreferences", package: "CapacitorPreferences"),
                .product(name: "CapacitorScreenOrientation", package: "CapacitorScreenOrientation")
            ]
        )
    ]
)
