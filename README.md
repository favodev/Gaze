# GAZE

Gaze is a distraction tracking browser extension with one shared codebase and separate packages for Chromium and Firefox-based browsers.

## Build Commands

Run from the project root:

```bash
npm run build:chromium
```

Builds Chromium package in `dist-browsers/chromium`.

```bash
npm run build:firefox
```

Builds Firefox/Zen package in `dist-browsers/firefox`.

```bash
npm run build:all
```

Builds both packages.

## Load Extension Locally

### Chrome / Edge / Brave

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `dist-browsers/chromium`.

### Firefox / Zen

1. Open `about:debugging#/runtime/this-firefox`.
2. Click Load Temporary Add-on.
3. Select `dist-browsers/firefox/manifest.json`.

## Release Assets (ZIP)

Publish one ZIP per browser target in the same GitHub release.

Recommended asset names:

- `gaze-chromium-vX.Y.Z.zip`
- `gaze-firefox-vX.Y.Z.zip`

The `release/` folder in this repository is used for generated ZIP files.

## Important: manifest.json Naming

Do not rename `manifest.json` inside extension folders or ZIP files.

- The extension system expects this exact filename.
- Browser-specific differences are handled by package folder and ZIP filename, not by renaming the manifest file.

## Suggested GitHub Release Notes

```md
- Chromium build (Chrome, Edge, Brave): gaze-chromium-vX.Y.Z.zip
- Firefox/Zen build: gaze-firefox-vX.Y.Z.zip
```