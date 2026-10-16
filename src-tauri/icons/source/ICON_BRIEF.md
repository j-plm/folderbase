# FolderBase app icon: brief for the repo

This folder contains the finished icon artwork and exports for FolderBase. Read this before wiring the icon into the build or changing it.

## The design, and why

A yellow folder with a three-column table card sliding out of the top.

- **Folder:** it is a file manager, and the folder reads instantly at any size.
- **Table card:** the app's differentiator is that folders are views over a database, not containers. The table peeking out says "folder meets database" (the Database view mode in the spec).
- **Blue header band:** the strongest cue at 16 and 32px, where the grid lines are too fine to survive. Without it the icon is just a yellow folder.
- **Proportions, all deliberately chosen:** folder body about 1.45:1 wide to tall (1.35:1 looked too tall, 1.56:1 looked squat); the table sits 2 units lower than first drawn so it is tucked into the folder; light grid lines (dark lines looked too much like a spreadsheet app); glyph fills about 75% of the tile (`translate(7 7) scale(1.14)` on the 128 grid; reduced from 79% / `translate(4 4) scale(1.2)`), similar to the macOS Launchpad icons.
- **Native feel is the top priority** (the spec's "Native Fidelity Standard"): one design family on macOS and Windows, with each platform's own packaging.
- **Colours are placeholders.** The owner wants to explore colour later. Palette in use: folder back `#E6A323`, folder front `#FFC93D`, header `#6FA4F0`, grid lines `#C5CCD8`, card outline `#C9D2E0`, tile background `#EEF1F6` (Tahoe preview) / white-to-`#E6E9EF` gradient (legacy). The Tahoe layers are flat fills so recolouring is a find-and-replace.

## Where things live in the repo

The exports below have been wired into Tauri's `bundle.icon` (`src-tauri/tauri.conf.json`):

- `src-tauri/icons/icon.icns` ← `export/macos/AppIcon.icns` (also the Dock icon under `cargo tauri dev`)
- `src-tauri/icons/icon.ico` ← `export/windows/icon.ico` (also the window/taskbar icon on Windows)
- `src-tauri/icons/32x32.png`, `128x128.png`, `128x128@2x.png` ← the 32/128/256px frames of `icon.ico` (flat design, used on Linux)
- `source/icon_1024.png` is the 1024px frame of `icon.icns`; regenerate it whenever the `.icns` changes.
- When re-exporting, put the new `.icns`/`.ico` straight into `src-tauri/icons/` (not here), then touch `src-tauri/src/lib.rs`, because Cargo does not rebuild when only an icon changes.
- Source artwork is in this folder (`src-tauri/icons/source/`), with the Tahoe layers in `tahoe-layers/`.

## What is here (as originally delivered)

```
source/
  macos-legacy-1024.svg      macOS Sequoia and earlier: bakes in its own shape, shadow, shading
  tahoe-layers/              macOS 26 (Tahoe): flat layers for Apple's Icon Composer
    01-back-folder.svg
    02-table.svg
    03-front-panel.svg
  windows-flat.svg           Windows: no tile, flat fills
export/
  macos/AppIcon.icns         built from macos-legacy-1024.svg (all sizes 16 to 1024, plus @2x)
  macos/icon_1024.png        1024px PNG of the legacy icon (source for `tauri icon` or similar)
  windows/icon.ico           16, 20, 24, 32, 40, 48, 64, 96, 128, 256px
  windows/png/               the same sizes as PNGs
  preview/                   checking renders only; not for shipping
```

## Why there are two macOS icons

macOS handles icon shape differently by version:

- **Sequoia and earlier:** macOS applies no mask or shading. The icon file must carry its own rounded shape, margin and shadow. That is `macos-legacy-1024.svg` (1024 canvas, 824px body, 100px margin).
- **Tahoe (macOS 26):** the system expects a layered Icon Composer icon and applies masking, Liquid Glass lighting, shadows and the dark, clear and tinted appearances itself. Icons that do not conform (pixels outside the system mask) are shrunk and put on a grey box. A legacy-style icon with a baked-in rounded tile and shadow risks that, and baked-in shading would double up with the system's.

So ship **both**: the legacy `.icns` for older systems, and a Tahoe `.icon` built from the three flat layers. The layers deliberately have no tile, rounding, shadow or gloss. Do not add them.

## Wiring it in

The spec recommends Tauri or Electron. Check which the repo uses and **verify the details against the installed version's docs**, because I did not test any of this on a Mac or a Windows machine.

- **Tauri:** `bundle.icon` in `tauri.conf.json` lists the icon files (`.icns`, `.ico`, PNGs). `tauri icon <1024px.png>` can regenerate a full set from `export/macos/icon_1024.png`. I found a Tauri change adding support for loading an Icon Composer `.icon` file (compiled to `Assets.car`) in the bundler config; confirm it is in the Tauri version in use before relying on it.
- **Electron:** not checked. Look up how the packager in use handles `.icns` plus an `Assets.car` for Tahoe.
- **Windows:** use `export/windows/icon.ico`.
- On Tahoe the icon is compiled with `actool`; the macOS 26 SDK is needed for the layered icon to be picked up.

## What still needs doing or checking

1. **Build the Tahoe `.icon` by hand in Icon Composer** (free, from Apple's developer downloads or Xcode 26). Drag in the three layers as three separate groups, back to front, so each gets its own depth. Set the background fill to a light neutral (the preview used `#EEF1F6`), and add a dark appearance (the light background will not work in dark mode). I did not generate the `.icon` bundle myself, because I am not confident of its file schema.
2. **The squircle is an approximation.** The legacy tile uses a superellipse (n=5) as a stand-in for Apple's continuous-corner shape. Compare it against Apple's official macOS icon template and swap in the exact shape before release; a mismatch is exactly what can trigger the grey box on Tahoe.
3. **The `.icns` and `.ico` were written by a small script and have not been opened on a Mac or Windows machine.** Open both and confirm every size appears.
4. **Small sizes (16 and 24px):** the grid lines mostly vanish and the icon relies on the blue header. If it looks weak in the Dock, Finder list view or Windows taskbar, draw a simplified small-size variant with one divider and a thicker header.
5. **Colour exploration** is still open (see above).
