# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**This fork is the device layer of Digital Memorial.** Read `../digital-memorial/docs/MEMORIAL.md` (product repo) before any memorial work:
it holds the product spec, data model, invariants, the FreeKiosk/backend boundary and the open decisions.

### Digital Memorial build notes

- The fork is pinned to an upstream release tag (currently `v2.0.0-beta.5`); move it only on purpose, by
  fast-forwarding to a newer tag, and re-test on a real tablet.
- Toolchain (no Homebrew, no sudo): JDK 17 in `~/Library/Java/jdk-17`, Android SDK in `~/Library/Android/sdk`
  (platform 36, build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1). Export
  `JAVA_HOME=~/Library/Java/jdk-17/Contents/Home ANDROID_HOME=~/Library/Android/sdk`.
- `android/gradle.properties` is git-ignored upstream: copy `android/gradle.properties.example` on a fresh clone.
- Release signing key: `~/.memorial-signing/memorial-release.keystore`, passwords in `~/.gradle/gradle.properties`
  (`FREEKIOSK_UPLOAD_*`). Never in this repo. Losing it means Device Owner tablets cannot be updated without a factory
  reset: keep a backup.
- Build for ARM tablets: `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a`.
- Our changes to upstream (keep them few and isolated, to stay mergeable):
  - `android/app/build.gradle`: `enableSelfUpdate = false` in every build. The GitHub self-update (`UpdateModule.kt`)
    points at upstream releases, signed with another key, so it can never update our Device Owner tablets.
  - `src/screens/PinScreen.tsx`: back to the kiosk after 30 s without a touch (`PIN_IDLE_RETURN_MS`); test in
    `__tests__/PinScreenIdleReturn.test.tsx`.
  - `android/app/build.gradle`: our version numbers (`versionCode` upstream*100 + N, `versionName` upstream +
    `-dm.N`). Bump them for every APK released to tablets (`pnpm release:apk` in the product repo).
  - `src/components/WebViewComponent.tsx`: page-alive watchdog. A page that posts `{type:'KIOSK_PAGE_ALIVE'}` (the
    Digital Memorial display does, every 30 s) gets remounted after 2 min of silence (hung, blank or native error
    page). Armed per URL once it has reported alive (remembered in AsyncStorage). Test:
    `__tests__/PageAliveWatchdog.test.tsx`.
  - `src/utils/memorialScreenSchedule.ts` (+ a branch in `WebViewComponent` and a handler in `KioskScreen`): the
    page can post `{type:'KIOSK_SCREEN_SCHEDULE', enabled, sleepTime, wakeTime}` (the Digital Memorial display
    sends the funeral home's schedule from the panel, default off 00:00–07:30). It is saved as FreeKiosk's own screen
    scheduler config (one every-day rule, wake-on-touch off), which turns the screen off and on with native alarms.
    Test: `__tests__/MemorialScreenSchedule.test.tsx`.
  - `KioskModule.setScreenAlarm`: the screen schedule alarms are exact alarm clocks (`USE_EXACT_ALARM` in the
    manifest). HyperOS deferred the upstream inexact alarms by days, so the screen never came back on.
  - `MemorialUpdateModule.kt` + `src/utils/memorialAppUpdate.ts`: remote updates. The page posts
    `{type:'KIOSK_APP_UPDATE', versionCode, url, sha256}` (the release published with `pnpm release:publish`); the
    module downloads it (https), checks SHA-256, package, version and signing certificate, and installs it silently
    as Device Owner (BootReceiver relaunches on MY_PACKAGE_REPLACED). `{type:'KIOSK_HELLO'}` gets the installed
    version back through `window.__dmKioskInfo`. Test: `__tests__/MemorialAppUpdate.test.tsx`.
  - `MainActivity.applyDefaultLauncherPolicy`: FreeKiosk is the persistent Home whenever the kiosk is enabled, not
    only with the opt-in setting. HyperOS revokes autostart on every update, so MY_PACKAGE_REPLACED could not relaunch
    the kiosk after a remote update; Android relaunches Home by itself.
  - `MemorialAdminExit.kt` (+ a call in `KioskModule.exitKioskMode` and at the top of `MainActivity`): because
    FreeKiosk is Home, "Exit Kiosk Mode" used to land straight back in the kiosk. The exit now records the boot;
    until the next reboot a Home launch hands over to the system launcher. Any other launch (icon, ADB provisioning,
    relaunch after an update) brings the kiosk back.
- Kiosk hardening is configuration, applied by `pnpm tablet:provision` in the product repo (`HARDENING` list).
- Updating the APK on an installed frame: HyperOS cancels `adb install` while in lock task; leave kiosk mode first
  (see `../digital-memorial/docs/provisioning.md`).

## What is FreeKiosk

FreeKiosk is a free, open-source Android kiosk platform built with React Native + TypeScript, with extensive Kotlin native modules for device control. It is designed as an open alternative to Fully Kiosk Browser.

Key capabilities: WebView kiosk, external app launcher, dashboard, media player, 40+ REST API endpoints, MQTT/Home Assistant integration, Device Owner mode, ADB provisioning.

## Commands

```bash
# Development
npm start                           # Start Metro bundler
npm run android                     # Run on connected device/emulator
npm run lint                        # ESLint
npm test                            # Jest unit tests
npm test -- --testPathPattern=foo   # Run a single test file

# Android build - three variants, selected by a -P flag
cd android && ./gradlew assembleRelease                 # APK for the GitHub release
cd android && ./gradlew assembleRelease -Pcloudprovi    # APK uploaded to the cloud
cd android && ./gradlew bundleRelease   -Pplaystore     # AAB for the Play Store
```

| Build | Goes where | Self-update | AccessibilityService |
|-------|-----------|-------------|----------------------|
| `assembleRelease` | GitHub release, website download | yes | yes |
| `assembleRelease -Pcloudprovi` | uploaded as the cloud's beta APK | yes | **stripped** |
| `bundleRelease -Pplaystore` | Play Store | **no** | **stripped** |

**A release needs two APK builds, not one.** The cloud serves its uploaded APK through two
routes - the public `dpc-apk-download` the Android setup wizard fetches during QR
provisioning, and the dashboard download a signed-in tester uses - so that one has to be the
`-Pcloudprovi` build. Play Protect blocks a sideloaded install outright when the app declares
an accessibility service ("App blocked to protect your device"), which kills QR provisioning
mid-wizard with no way past it. The GitHub APK keeps the service, so anyone provisioning over
ADB still gets it, and ADB is the only way to grant the `WRITE_SECURE_SETTINGS` it needs to
turn on anyway.

The two flags are mutually exclusive and the build fails if both are set. Each strips its
service with `tools:node="remove"` in `android/app/src/<flag>/AndroidManifest.xml`, which
removes the declaration rather than disabling it - Play Protect reads the manifest, so
`android:enabled="false"` would not help.

Output APK: `android/app/build/outputs/apk/release/app-release.apk`

Requirements: Node 20+, JDK 17+, Android SDK 26+.

## Architecture

### React Native ↔ Native Bridge Pattern

Every piece of device functionality lives in a Kotlin module (`android/app/src/main/java/com/freekiosk/`) paired with a TypeScript bridge in `src/utils/`. When adding device-level features, both sides must be updated together.

Key native modules:
- **KioskModule.kt** — lock task, screen on/off, power, home button override
- **AppLauncherModule.kt** — external app lifecycle management
- **BlockingOverlayModule.kt** — draws overlay views to block UI regions
- **HttpServerModule.kt** — embedded HTTP server for REST API
- **FreeKioskAccessibilityService.kt** — accessibility service for back-button/gesture suppression
- **BackgroundAppMonitorService.kt** / **KioskWatchdogService.kt** — foreground services keeping kiosk alive

### State & Storage

`src/utils/storage.ts` is the central persistent state layer (~2000+ lines). All settings, kiosk config, and feature flags are stored via AsyncStorage abstractions here. `src/utils/secureStorage.ts` handles credentials via Keychain. Virtually every component reads settings through these utilities.

### Display Modes

`src/screens/KioskScreen.tsx` is the primary runtime screen. It conditionally renders one of:
- **WebViewComponent** — wraps `react-native-webview` with auto-reload, keyboard avoidance, cookie injection, HTTP basic auth
- **ExternalAppOverlay** — launches and monitors an external Android app
- **MediaPlayerComponent** — video/image slideshow player
- **DashboardGrid** — tile-based launcher

Mode is determined by settings read from storage at startup.

### Settings UI

`src/screens/settings/SettingsScreenNew.tsx` hosts a tabbed settings interface. Each tab is a separate component under `src/screens/settings/tabs/` and `src/components/settings/`. The settings UI uses React Native Paper (Material Design).

### Navigation

Minimal stack: `src/navigation/AppNavigator.tsx` routes between KioskScreen, PinScreen, SettingsScreenNew, and BlockingOverlaysScreen.

### REST API & MQTT

`src/utils/ApiService.ts` handles inbound REST requests (routed through `HttpServerModule`). `src/utils/MqttModule.ts` manages MQTT for Home Assistant discovery. Documentation for all endpoints is in `docs/rest-api.md` and `docs/MQTT.md`.

### Types

Shared TypeScript types for complex features live in `src/types/` — important ones: `managedApps.ts`, `dashboard.ts`, `blockingOverlay.ts`, `screenScheduler.ts`, `planner.ts`.

### Dependency Patches

`patches/` contains patch-package patches applied via `postinstall`. Do not upgrade patched dependencies without verifying the patches still apply.

Current patches:
- **`react-native-webview+13.16.0.patch`** — auto-grant camera/mic permissions in kiosk mode (and, since #219, also request the matching Android runtime permission when it is missing: auto-granting only covers the web layer, and nothing else in the app asked for `CAMERA`/`RECORD_AUDIO` outside the permission wizard. The system suppresses that dialog in lock task, so it has to be granted before Lock Mode), SSL certificate handling for same-host redirects, a native `DownloadListener` hook routing PDFs to the bundled viewer, and a guard in `RNCWebViewManagerImpl.applyUserAgentString()` that catches the `IllegalArgumentException` Chromium throws for a custom User-Agent containing illegal header characters (it crashed the app on the Fabric mount thread) and falls back to the default UA.
- **`@react-native-community+slider+5.1.1.patch`** — re-entrancy guard in `ReactSliderManager.onProgressChanged()` to stop a `StackOverflowError` when initializing a Slider on Android 8.x (#86).
- **`@react-native-cookies+cookies+6.2.1.patch`** — build/compat fix.
- **`react-native-vision-camera+4.7.3.patch`** — three fixes: (1) guard `CameraDevicesManager` against `getCameraIdList()` returning `null` on cameraless x86 / BlissOS devices, which otherwise throws an NPE during TurboModule init and crashes the app on launch (#187); (2) `runOnUiThreadAndWait()` now routes exceptions back to the suspended coroutine via `resumeWith(Result.failure(e))` instead of letting them escape as an uncaught exception on the UI Handler thread (which crashed the app); (3) `CameraViewModule.takePhoto()` calls `findCameraView()` inside `withPromise` so a `ViewNotFoundError` (CameraView unmounted mid-capture, e.g. motion detection) rejects the promise instead of crashing — the `backgroundCoroutineScope` has no exception handler. Together (2)+(3) fix the `ViewNotFoundError` crash from `findCameraView` reported on v1.2.19.
