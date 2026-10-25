# Build

Everything below is copy-paste for a fresh **GitHub Codespace** (Ubuntu, 4+ cores recommended). Debug builds only.

## 0. One-time setup

```sh
git clone https://github.com/DeepuExplainsAi/KRISH.git && cd KRISH
npm ci
```

Codespaces images ship Node and a JDK; if `java -version` is not 21, install it:

```sh
sudo apt-get update && sudo apt-get install -y openjdk-21-jdk-headless
```

Android SDK (command-line tools, no Android Studio):

```sh
export ANDROID_HOME=$HOME/android-sdk
mkdir -p $ANDROID_HOME/cmdline-tools && cd $ANDROID_HOME/cmdline-tools
curl -sLo cmd.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q cmd.zip && mv cmdline-tools latest && rm cmd.zip && cd -
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platforms;android-36" "build-tools;36.0.0"
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
```

## 1. Build the web UI and sync it into Android

```sh
npm run build:ui
npx cap sync android
```

## 2. Debug APKs

```sh
cd android
./gradlew assembleLiteDebug      # small APK, Tier 0 sandbox only
./gradlew assembleFullDebug      # adds the optional Linux sandbox (arm64 only)
```

Outputs:

- `android/app/build/outputs/apk/lite/debug/app-lite-debug.apk`
- `android/app/build/outputs/apk/full/debug/app-full-debug.apk`

Download from the Codespaces file explorer (right-click, Download) and install on the phone (allow "install unknown apps").
The `lite` and `full` flavors use different application IDs (`app.krish.agent.lite` vs `app.krish.agent`) and can coexist.

## 3. Desktop app

```sh
npm run build:ui
cd desktop && npm install --no-save electron@45.0.0    # downloads the Electron binary once
npx electron .
```

In a Codespace there is no display; run this on your own computer. Desktop needs a graphical session.

Real-Electron smoke test (12 checks through the preload bridge: https-only, blocked channels, isolated-world observe, stale-fingerprint refusal, layout toggle, snapshot, clear data). On a headless Linux box it needs `xvfb`; it loads https://example.com:

```sh
npm run build:ui && npm run smoke -w desktop
```

## 4. Optional on-device model (WebGPU, experimental)

Off by default and not compiled in. To include it (adds ~6 MB of JS and makes the app download model files at first use):

```sh
KRISH_LOCAL_MODEL=1 npm run build:ui && npx cap sync android
```

## 5. CI

`ci/workflows/check.yml` type-checks, lints, tests and compile-checks both Kotlin flavors on every push.
To enable it, copy it into place with a token that has the `workflow` scope (or via the GitHub web UI):

```sh
mkdir -p .github/workflows && cp ci/workflows/check.yml .github/workflows/check.yml
```

`ci/workflows/build-apk.yml` builds both debug APKs and uploads them as workflow artifacts (manual trigger).

## Troubleshooting

- `SDK location not found`: create `android/local.properties` with `sdk.dir=...` (step 0).
- Gradle out of memory on a small machine: add `org.gradle.jvmargs=-Xmx1g` to `~/.gradle/gradle.properties`.
- Tier 1 shows "blocked by Android": some OS builds block executing bundled binaries. Tier 0 keeps working. See SECURITY.md.
