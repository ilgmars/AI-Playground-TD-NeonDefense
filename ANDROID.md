# Android Support

Neon Defense ships as an Android APK — a thin `WebView` wrapper around the same vanilla-JS web app served at the GitHub Pages URL. No Capacitor, Cordova, or Ionic.

## What the APK is

- [android/app/src/main/java/com/neondefense/game/MainActivity.java](android/app/src/main/java/com/neondefense/game/MainActivity.java) — an `AppCompatActivity` that hosts a `WebView` loading `file:///android_asset/www/index.html`.
- [android/app/src/main/assets/www/](android/app/src/main/assets/www/) — a **mirror** of the web files at the repo root (`index.html`, `style.css`, `src/`). These get packaged into the APK.
- Gradle output: `android/app/build/outputs/apk/debug/app-debug.apk`. The canonical distribution copy is the **`Games` release asset** (<https://github.com/ilgmars/AI-Playground-TD-NeonDefense/releases>) — CI ([build-apk.yml](.github/workflows/build-apk.yml)) rebuilds, signs, audits, and re-uploads it on every green push to `main`. No APK is tracked in git; a locally-built `NeonDefense.apk` at the repo root is gitignored.

Because `assets/www/` is a copy and not a symlink, **every change to `index.html`, `style.css`, or anything under `src/` must be re-copied into `android/app/src/main/assets/www/` before a LOCAL rebuild.** (CI does this sync automatically at build time, so the committed mirror being stale never affects released APKs — it only bites local Gradle builds.)

## Prerequisites (Windows)

Paths below are the ones currently configured on the dev box — adjust for your environment.

| Tool | Version | Location |
| --- | --- | --- |
| JDK | 17 (Adoptium 17.0.18+8) | `C:/Users/Janis/android-build/jdk/jdk-17.0.18+8` |
| Android SDK | API 34 + build-tools + platform-tools | `C:/Users/Janis/android-build/android-sdk` (referenced by [android/local.properties](android/local.properties)) |
| Gradle | 8.5 | `C:/Users/Janis/.gradle/wrapper/dists/gradle-8.5-bin/5t9huq95ubn472n8rpzujfbqh/gradle-8.5/bin/gradle.bat` |

AGP 8.x (used by this project) requires JDK 17 specifically — 11 or 21 will fail.

The repo does **not** currently ship `gradlew` / `gradlew.bat`. Either invoke the cached gradle binary directly (shown below) or generate the wrapper once with `cd android && gradle wrapper`.

## Build in three steps

From Git Bash at the repo root:

```bash
# 1. Sync the web app into the Android project.
rm -rf android/app/src/main/assets/www/src
cp -R src         android/app/src/main/assets/www/src
cp index.html     android/app/src/main/assets/www/index.html
cp style.css      android/app/src/main/assets/www/style.css

# 2. Build the debug APK. Set JAVA_HOME inline since it isn't persistent.
cd android
JAVA_HOME="C:/Users/Janis/android-build/jdk/jdk-17.0.18+8" \
PATH="C:/Users/Janis/android-build/jdk/jdk-17.0.18+8/bin:$PATH" \
"C:/Users/Janis/.gradle/wrapper/dists/gradle-8.5-bin/5t9huq95ubn472n8rpzujfbqh/gradle-8.5/bin/gradle.bat" \
  assembleDebug --console=plain --no-daemon

# 3. Promote the output APK to the repo root.
cp app/build/outputs/apk/debug/app-debug.apk ../NeonDefense.apk
cd ..
```

Cold build ≈ 30-60s, incremental ≈ 5-10s. `--no-daemon` is defensive for short-lived shells; drop it if you're iterating.

## Release variant

[android/app/build.gradle](android/app/build.gradle) wires the release build to the **debug** keystore for convenience:

```gradle
buildTypes {
    release {
        minifyEnabled false
        signingConfig signingConfigs.debug
    }
}
```

Swap `assembleDebug` → `assembleRelease` in step 2; output goes to `android/app/build/outputs/apk/release/app-release.apk`. **This is not a production signing setup** — swap in a real keystore before publishing to the Play Store or sharing broadly.

## Install & verify

```bash
# Via ADB (phone in developer mode, USB-connected):
adb install -r NeonDefense.apk

# Or sideload: copy NeonDefense.apk to the phone, tap it in the file manager.
# "Install unknown apps" permission must be granted for the installing app.
```

Expected APK size: ~3 MB.

## Troubleshooting

**`JAVA_HOME is not set` / `Unsupported class file major version`**
Gradle picked up a wrong JDK. Pass `JAVA_HOME` inline (as in step 2) or set it globally to a JDK 17 install.

**`SDK location not found`**
Edit [android/local.properties](android/local.properties) so `sdk.dir` points at your local SDK. That file is machine-local and should stay out of git.

**`gradlew: No such file or directory`**
The wrapper scripts aren't committed. Run the gradle binary directly as shown, or generate the wrapper: `cd android && gradle wrapper`.

**APK installs but looks stale after UI changes**
You forgot step 1. Re-copy the web assets into `android/app/src/main/assets/www/`, then rebuild. Gradle's incremental task `mergeDebugAssets` picks up the change automatically once the files are there.

**Gradle sync / AGP version mismatch**
This repo pins Gradle 8.5 and expects AGP 8.x. If you've upgraded one independently, keep the compatibility matrix in mind (AGP 8.2+ ↔ Gradle 8.2+).

## File map

```
android/
  app/
    build.gradle                 AGP plugin, SDK levels, dependencies, signing
    src/main/
      AndroidManifest.xml        Package, main activity, INTERNET permission
      assets/www/                Mirrored web app — this is what ships
      java/com/neondefense/game/
        MainActivity.java        WebView host + asset loader
        NeonDefenseApp.java      Application class
      res/                       Icons, themes, strings
  build.gradle                   Top-level gradle config
  gradle/wrapper/                Gradle version pin (gradle-wrapper.properties)
  gradle.properties              AndroidX flags, JVM args
  local.properties               SDK path (machine-local, gitignored)
  settings.gradle                Module declarations
```
