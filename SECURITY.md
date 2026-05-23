# Security & APK transparency

This page exists for one reason: some antivirus engines (notably
Windows Defender, on older releases) have flagged the Neon Defense
APK as malware. Every one of those flags has been a **false
positive** — the APK is a thin WebView wrapping a static JavaScript
canvas game, with no network permissions and no obfuscation. This
document tells you exactly what's in the build, how to verify it
matches the one CI produced, and how to report the false positive
upstream.

If you find what you think is a *real* security issue, see
[Reporting a real vulnerability](#reporting-a-real-vulnerability) at
the bottom.

---

## TL;DR

| What | Detail |
|---|---|
| **What the APK contains** | One `Activity` that opens a `WebView` pointing at the bundled HTML+JS. The game logic is the same code GitHub Pages serves. |
| **Permissions requested** | **None.** No `INTERNET`, no `ACCESS_NETWORK_STATE`, no storage, no camera — see the `aapt2 dump permissions` line in [every Build APK Actions log](https://github.com/ilgmars/AI-Playground-TD-NeonDefense/actions/workflows/build-apk.yml). |
| **Network traffic** | The WebView is locked to `appassets.androidplatform.net` (Google's WebViewAssetLoader scheme); all external `http://` and `https://` requests are intercepted and returned as empty 0-byte bodies. Google Fonts loads from the network *if* the device is online, otherwise the page falls back to system fonts. |
| **Code obfuscation** | None. `minifyEnabled false` on the release build — the Java sources are the same ~250 lines you see in the repo. |
| **Signing** | Release keystore stored as `KEYSTORE_BASE64` GitHub secret; fingerprint printed to every build log under "apksigner verify --print-certs". |
| **Reproducibility** | Source-level reproducible: anyone can `git clone`, build with the same Android SDK + JDK, and produce a bytewise-identical APK *except for the signature block*. |
| **AI authorship** | Every line — including the Android sources — was written by an AI assistant under human direction. See the [AI-only build policy](README.md#about-this-project). |

---

## Why Windows Defender flags hybrid APKs

Generic Defender heuristics (and a handful of other AV engines) have
historically flagged any APK that:

- Wraps a `WebView` and ships its UI as bundled HTML+JS.
- Is downloaded from outside the Play Store (any "sideloaded" file
  is treated as higher risk by default).
- Has a low download count + a new file hash. SmartScreen treats
  unfamiliar binaries as suspicious until enough installs accumulate.
- Uses signing keys not previously seen by Microsoft's reputation
  database.

All four describe this project. None of them are evidence of
malicious behaviour. The static analysis Defender runs doesn't
inspect what the JavaScript does — it just sees "WebView + bundled
JS" and pattern-matches against years of shovelware that uses the
same envelope.

---

## What's in the APK (audit checklist)

You can verify each item below independently. The CI build log
prints everything in plain text.

### 1. The full file list

The `Audit APK` step in [`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml)
runs `unzip -l NeonDefense.apk | head -50` and dumps it to the
Actions log. The list contains:

- `AndroidManifest.xml`
- `classes.dex` — compiled Java from `android/app/src/main/java/`
  (two files, ~250 lines total — see them below)
- `assets/www/` — the same HTML/JS/CSS GitHub Pages serves
- `res/` — drawables / themes / strings
- `META-INF/` — signature files

No native libraries (`lib/`) of any architecture. No third-party SDKs
beyond `androidx.appcompat` + `androidx.webkit`.

### 2. The Java sources

There are exactly two Java files, totalling under 300 lines:

- [`MainActivity.java`](android/app/src/main/java/com/neondefense/game/MainActivity.java)
  — creates the WebView, locks it to local assets, sets up the
  crash dialog. Nothing else.
- [`NeonDefenseApp.java`](android/app/src/main/java/com/neondefense/game/NeonDefenseApp.java)
  — installs an uncaught-exception handler that writes
  `crash.txt` to the app's private files dir.

Neither file touches the network. Neither file requests any
permission.

### 3. The AndroidManifest

[`android/app/src/main/AndroidManifest.xml`](android/app/src/main/AndroidManifest.xml)
has no `<uses-permission>` entries. The "Permissions declared in
AndroidManifest" step in CI confirms this every build.

### 4. The signed APK fingerprint

The `apksigner verify --print-certs` line in the build log shows:

- `Signer #1 certificate DN: …`
- `Signer #1 certificate SHA-256 digest: …`

Compare this SHA-256 across releases. It will be **constant** as
long as we use the same keystore. A change in the certificate
fingerprint without a matching commit to `KEYSTORE_BASE64` rotation
is suspicious; question it.

### 5. SHA-256 of the file itself

Every release ships with `NeonDefense.apk.sha256` next to the APK.
Verify:

```sh
# After downloading both files from the GitHub Release:
sha256sum -c NeonDefense.apk.sha256
# → NeonDefense.apk: OK
```

If `OK`, the file you downloaded is the exact byte sequence CI
produced. The same SHA-256 is printed to the CI log so you can
cross-check it against the Actions run that built it.

---

## Reporting the false positive to Microsoft

If Defender still flags the APK on your machine, please submit it
for analysis — that's how the signature database learns:

> <https://www.microsoft.com/en-us/wdsi/filesubmission>

Suggested submission text:

> APK: `NeonDefense.apk` (SHA-256 published with each GitHub
> Release at <https://github.com/ilgmars/AI-Playground-TD-NeonDefense/releases>).
> Open-source: <https://github.com/ilgmars/AI-Playground-TD-NeonDefense>.
> No permissions requested (`aapt2 dump permissions` returns empty).
> No native libraries. Build provenance + audit trail in
> <https://github.com/ilgmars/AI-Playground-TD-NeonDefense/actions/workflows/build-apk.yml>.

Microsoft typically responds within a few business days and adds
the file to the safe-list.

---

## Rebuilding from source yourself

You don't have to trust the CI-produced APK. Build it yourself:

```sh
git clone https://github.com/ilgmars/AI-Playground-TD-NeonDefense.git
cd AI-Playground-TD-NeonDefense

# Sync web assets the same way CI does.
rm -rf android/app/src/main/assets/www/src
cp -R src android/app/src/main/assets/www/src
cp index.html android/app/src/main/assets/www/index.html
cp style.css  android/app/src/main/assets/www/style.css

# Build (requires JDK 17 + Android SDK 34).
cd android
./gradlew assembleDebug --no-daemon
ls -lh app/build/outputs/apk/debug/app-debug.apk
```

The Java bytecode under `classes.dex` will be bytewise identical to
the release build (same source, same compiler, same SDK target).
The signature block + `META-INF/` will differ because you signed
with the debug keystore rather than ours.

---

## Reporting a real vulnerability

If you've found a genuine security issue — not a Defender false
positive — please file it via GitHub's private vulnerability
reporting:

> <https://github.com/ilgmars/AI-Playground-TD-NeonDefense/security/advisories/new>

The repo policy is the same as the rest of the project: an AI
assistant will be doing the triage and the fix. Please be patient
with the turnaround.

---

## Related

- [README](README.md) — main project overview
- [Aegis anti-tamper notes](src/security/aegis.js) — the in-game
  honor-system armour (separate from this APK-level integrity work)
- [`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml)
  — the build + audit pipeline
