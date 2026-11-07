# dsh-wallpaper-glass

[中文说明 / Chinese](README.md)

![check](https://github.com/mcxiaochenn/dsh-wallpaper-bg/actions/workflows/check.yml/badge.svg)

Local wallpaper for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI, plus a matching set of adjustable glass surfaces for the sidebar, top bar and dialogs.

The left sidebar gains a **Wallpaper** entry: pick any image from local disk as the page background, tune the wallpaper's opacity and gaussian blur, and tune each UI surface separately (or all at once). It ships with one bundled default wallpaper, so a fresh install works immediately.

> Tested against DSH 0.2.2-rc.1 (desktop profile). The glass styling relies on host DOM contracts; see "How it works" if a host upgrade changes them.

## Features

- Sidebar entry → a dedicated Wallpaper page in the centre column
- Local images: file picker or drag-and-drop; kept in the browser's IndexedDB, never uploaded
- Wallpaper itself: opacity (blends toward the palette base colour) and gaussian blur (pre-rendered on canvas; the slider reads in display pixels)
- Glass surfaces, each tunable on its own: **sidebar**, **top bar** (Windows caption row + conversation header), **dialogs** (including the settings panel)
  - Opacity: 100 % keeps the theme's own surface, lower values let the wallpaper through
  - Blur: backdrop blur radius; blurs the wallpaper, never the text
- **Apply to all surfaces** switch: two sliders drive all three surfaces together
- Light and dark palettes both work: every colour is a `--dsw-*` token snapshot mixed with `color-mix`, never hard-coded
- Bundled default wallpaper (`assets/default-wallpaper.webp`) for the first run; removing it does not bring it back, and "Use bundled wallpaper" restores it on demand
- Defaults are the author's own configuration: wallpaper 65 % + 8 px blur; all surfaces 0 % + 25 px blur
- Bilingual UI (Chinese/English) following the DSH language

## Install

Requirements: DSH 0.2.0-rc.1 or newer, with the web GUI (`dsh-web-app`) in the profile.

### From npm (recommended)

```text
plugin_manager install_bundle dsh-wallpaper-glass
```

> The npm package is `dsh-wallpaper-glass`; the GitHub repository is [dsh-wallpaper-bg](https://github.com/mcxiaochenn/dsh-wallpaper-bg) because the `dsh-wallpaper-bg` npm name is taken by another author's plugin.

Reload the page afterwards (desktop: `Ctrl+R`, or `Ctrl+Shift+R` if unchanged). The plugin manager lists it as "壁纸 / Wallpaper".

### Mainland China npm mirror

The plugin manager runs pnpm inside the profile and reads your npm/pnpm registry settings. If the official registry is slow or times out, switch to a mirror first:

```powershell
# npm
npm config set registry https://registry.npmmirror.com

# or pnpm
pnpm config set registry https://registry.npmmirror.com
```

Then run `plugin_manager install_bundle dsh-wallpaper-glass` again.

To scope it to one installation, add a `.npmrc` inside the profile directory:

```ini
registry=https://registry.npmmirror.com
```

The mirror only affects downloads; the plugin itself makes no network requests, and wallpaper images stay in the local browser.

### From source (development)

```powershell
git clone https://github.com/mcxiaochenn/dsh-wallpaper-bg.git
```

Hand the **directory** to the plugin manager (absolute path):

```text
plugin_manager install_bundle C:\path\to\dsh-wallpaper-bg
```

A local directory install is a `link:` dependency: edit a file, reload the page, and the change is live.

### Uninstall

```text
plugin_manager remove_bundle dsh-wallpaper-glass
```

## Usage

1. Click the wallpaper icon in the left sidebar.
2. "Choose image", or drop an image file onto the panel.
3. Adjust "Wallpaper opacity" and "Wallpaper blur".
4. Tune the sidebar, top bar and dialogs under "UI surfaces", or enable "Apply to all surfaces".
5. "Remove wallpaper" clears it; "Use bundled wallpaper" brings the bundled image back.

Surface settings stay saved after removing the wallpaper; they only apply while a wallpaper is present.

## Defaults and bundled wallpaper

- Defaults: wallpaper 65 % / 8 px blur, uniform switch on, all surfaces 0 % / 25 px.
- The bundled wallpaper is the author's own image, shipped as the first-run default. The MIT license covers the code only; replace `assets/default-wallpaper.webp` if you redistribute the plugin with another image (the host route serves whatever file is there).

## Storage

| Content | Location |
| --- | --- |
| User-picked image | Browser IndexedDB: `dsh-wallpaper` / `assets` / `current` |
| All settings | Browser localStorage: `dsh-wallpaper/settings` |
| Bundled wallpaper | `assets/default-wallpaper.webp` inside the package, served by the host route |

Storage keys keep their pre-rename names (`dsh-wallpaper`) so older data keeps loading. Images belong to the current origin: `127.0.0.1` and `localhost` do not share storage.

## How it works

DSH has no official wallpaper extension point, so this plugin uses the host's real DOM contracts:

| Target | Hook | Approach |
| --- | --- | --- |
| Page background | `:has(> [data-shell-overlay])` (the single shell frame) | Paints the wallpaper plus a base-colour scrim, and sets `--dsw-alias-bg-base` to `transparent` inside the frame so the centre column and base surfaces reveal it |
| Sidebar | `:has(> [data-slot="sidebar"])` (the sidebar column) | Overrides the column's `--dsw-specific-sidebar-fill` with a translucent colour; a `::before` layer supplies the backdrop blur |
| Top bar | the frame's `::before` under `html[data-windows-titlebar]`; in web mode the `[data-slot="conversation.header"] header` | Same values drive both the caption row and the conversation header |
| Dialogs | `[role="dialog"][aria-modal="true"]` | Host modals and the settings panel share this role; translucent fill + `::before` backdrop blur |
| Bundled wallpaper | Host route `GET /api/dsh-wallpaper-glass/default` | Serves `assets/default-wallpaper.webp`; no base64 in the client bundle |

Key decisions:

- **Colours come from tokens**: `body` snapshots `--dsw-alias-bg-base`, `--dsw-specific-sidebar-fill` and `--dsw-alias-bg-layer-2` into custom properties, then mixes them with `transparent` through `color-mix`, so palette switches and third-party themes follow automatically.
- **The blur layer must sit below the content**: `isolation: isolate` + `::before { z-index: -1 }`. Without it the positioned layer covers the content and blurs the text too.
- **Wallpaper blur is pre-rendered**: a CSS `background-image` cannot be filtered, so the client draws a blurred copy on canvas (`ctx.filter = blur()`); the radius is divided by the `background-size: cover` scale so slider values approximate visual pixels.
- **The bundled wallpaper comes from a host route**: the client fetches it only when no local image exists. The route is same-origin with the DSH web server and is not exposed beyond whatever interface DSH binds (loopback by default).

## Compatibility and limitations

- Only tested against DSH 0.2.2-rc.1 (desktop profile); host DOM/class changes may break the glass surfaces (the wallpaper itself is less affected).
- Images are limited to 32 MB; the blurred rendition is capped at 1920×1440 to keep the renderer responsive.
- With IndexedDB disabled, a wallpaper lasts for the current session only.
- Third-party themes may redefine the tokens used here; the glass look follows the theme by design.
- The npm package name differs from the repository name (see "Install").

## Development

```powershell
npm run check        # manifest, files, patch, locales, bundled image, client syntax (zero deps)
npm pack --dry-run   # inspect the npm tarball
```

There is no build step; `client.js` is the browser half and `index.js` the host half. Reload the page after editing the browser half; restart DSH to reload the host half.

CI (`.github/workflows/check.yml`) runs `node --check` and `npm run check`.

### Publishing to npm

`.github/workflows/publish.yml` publishes with `npm publish --provenance` when a GitHub Release is published. Add an `NPM_TOKEN` repository secret (an npm Automation token) first.

Manual publish:

```powershell
npm login
npm publish --access public
```

`prepublishOnly` runs the repository checks. Bump the version for each release.

## License

MIT © 2026 辰渊尘 ([mcxiaochenn](https://github.com/mcxiaochenn))

The bundled wallpaper (`assets/default-wallpaper.webp`) is the author's own image and is not covered by the MIT license.
