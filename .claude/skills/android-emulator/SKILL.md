---
name: android-emulator
description: Run and drive the Android emulator for Finnbook — boot the AVD, serve the app from the Docker container, and use Chrome DevTools over adb to inspect the page, grant notification permission, and deliver real pushes to the service worker. Use when testing the PWA, push notifications, the service worker, or media/video behaviour on a real device.
---

# Testing Finnbook on the Android emulator

Everything here was learned the hard way; the notes in each step are the parts that cost
time.

## 1. Environment

```sh
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

The JDK is the brew **formula** `openjdk`, deliberately — a JDK cask installs to `/Library`
and prompts for a password nobody can type.

## 2. Serve the app from the CONTAINER, not serve.py

```sh
cd <repo root>
docker build -f deploy/Dockerfile -t finnbook:test .
docker run -d --name finnbook -p 8099:8080 \
  -v "$PWD/scrapbook/pb_data:/pb/pb_data" finnbook:test
```

The container is the only place the production arrangement exists — one origin for page and
API, and only the files the Dockerfile copied. A file present locally but missing from the
image once broke every device for ten days while every local test passed. See "Running it"
in `scrapbook/CLAUDE.md`.

It listens on **8080** inside unless `PORT` is set. Mount `pb_data` or each run starts an
empty database. Hooks and migrations are baked in: **rebuild after editing
`deploy/pb_hooks/` or `pb_migrations/`** — reloading the page will not pick them up.

## 3. Boot the emulator and bridge it

```sh
emulator -avd finnbook -no-snapshot-save &        # Pixel 7, Android 35, Play services
adb wait-for-device
adb reverse tcp:8099 tcp:8099                     # ONE port: the container is one origin
adb forward tcp:9222 localabstract:chrome_devtools_remote
adb shell am start -a android.intent.action.VIEW -d "http://localhost:8099/" com.android.chrome
```

The emulator's `localhost` is a secure context, so service workers and push work over plain
http. On first run only, clear Chrome's welcome screen ("Use without an account", then
"Got it") — that accepts Chrome's terms, so **ask the user first**.

## 4. Drive the page

`cdp.mjs` sits beside this file. `CDP_PORT` selects which localhost page to attach to.

```sh
node cdp.mjs targets                              # what is open
node cdp.mjs eval "document.title"
node cdp.mjs eval "(async () => (await fetch('/api/health')).status)()"
node cdp.mjs push                                 # a real bodiless push to the worker
```

## 5. Notification permission

`Browser.grantPermissions` **does not work** on Android Chrome — it reports success and
`Notification.permission` stays `default`. Grant it for real:

```sh
adb shell pm grant com.android.chrome android.permission.POST_NOTIFICATIONS   # Android 13+
node cdp.mjs gesture "Notification.requestPermission()" &                     # prompt appears
adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml .        # find "Allow"
adb shell input tap <x> <y>
```

A `gesture` call that triggers a prompt **blocks until something taps it**, so run it in the
background or it will look like a hang.

## 6. Reading what happened

```sh
adb exec-out screencap -p > shot.png
adb shell dumpsys notification --noredact | grep -E "android\.(title|text)="
adb shell uiautomator dump /sdcard/ui.xml && adb shell cat /sdcard/ui.xml \
  | grep -o 'text="[^"]*"' | sort -u
```

## Gotchas worth remembering

- **Origins are per port.** Moving 8814 → 8099 means a new service worker registration, a
  new push subscription, a fresh permission prompt and signing in again.
- **`ServiceWorker.deliverPushMessage` is on the PAGE target**, not the browser target. It
  delivers a real push to the real worker with no VAPID and no server cron.
- **Signing in is the user's job.** Never type their credentials.
- **`MediaRecorder` on the emulator's Chrome 124 cannot produce MP4**, so videos are never
  re-encoded there. Real phones may differ — check
  `MediaRecorder.isTypeSupported('video/mp4')` before concluding anything about encoding.
- **A file input can be filled with `DataTransfer`** from the page, which tests our handling
  but not Android's own picker.
