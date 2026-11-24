# Third-party code inside this repository

For an official binary, download the corresponding source from its [matching release](https://github.com/antimajorana/Kandinsky/releases). Each release includes a source archive and identifies the Git revision used to build it.

Kandinsky is based on [Atlas by Alneb](https://github.com/Alneb/atlas). It was renamed and modified in November 2026.

Kandinsky is licensed AGPL-3.0-or-later (`LICENSE`), except its plugin SDK (`crates/kandinsky-plugin`, `crates/kandinsky-core/sdk/js`), which is MIT OR Apache-2.0 so plugins may carry any licence. These parts come from elsewhere and keep their own licences:

| path | what | licence | changes |
|---|---|---|---|
| `crates/vendor/softbuffer/` | [softbuffer](https://github.com/rust-windowing/softbuffer), a software framebuffer used by the capture window | MIT OR Apache-2.0 (its `LICENSE-MIT`, `LICENSE-APACHE` kept) | two `Xrgb8888` → `Argb8888` in `src/backends/wayland/buffer.rs`, for a transparent window (`Cargo.toml` `[patch]`) |
| `ui/src/vendor/dockview/dockview.css` | [dockview](https://github.com/mathuo/dockview)'s stylesheet | MIT | theme variables mapped to Kandinsky's tokens |
| `ui/src/lib/editor/live/` | Obsidian-style live preview and syntax, from obsidian-web, the author's own earlier project | the author's own work, licensed here as AGPL-3.0-or-later with the rest of Kandinsky | adapted to Kandinsky's editor |
| `crates/vendor/openink-stroke/` | openink's pen engine (knote2's pens, libneo_pen's width formulas), from `boox_5c_re`, the author's own Boox repo | MIT | none: `src/` copied as it is by `scripts/dev/sync-openink.sh` (commit in `VENDORED.md`); only `Cargo.toml` is Kandinsky's |
| `crates/vendor/openink-shape/` | openink's shape recogniser (classifier + segmenter + fits) and its trained weights (`weights/shape.oisw`), from `boox_5c_re` | MIT; the weights were trained partly on **Google's Quick, Draw! dataset (CC BY 4.0 — credited here and in the Notepad plugin's README, as the licence asks)**, plus synthetic ink and the author's own handwriting; no MyScript code or weights | none: `src/` and `weights/` copied by `scripts/dev/sync-openink.sh`; only `Cargo.toml` is Kandinsky's (`autobins = false`: the training-data tools are not shipped) |
| `crates/vendor/openink-nn/` | openink's tiny inference library (the `.oisw` weight format, dense layers, GRUs), which openink-shape runs on, from `boox_5c_re` | MIT | none: `src/` copied by `scripts/dev/sync-openink.sh`; only `Cargo.toml` is Kandinsky's |
| `crates/kandinsky-android/android/res/font/excalifont.ttf` | **Excalifont**, Excalidraw's hand-written font (the font of Excalidraw's text, family 5), for the Android Notepad's text | SIL Open Font License 1.1 (github.com/excalidraw/excalifont); the file's name table says "Copyright (c) 2024 by Excalidraw" | the seven unicode-range `.woff2` pieces Excalidraw ships (`ui/node_modules/@excalidraw/excalidraw/dist/prod/fonts/Excalifont/`) decompressed and merged into one TTF (573 glyphs), once, with fontTools: `TTFont(woff2).flavor = None` per piece, then `fontTools.merge.Merger().merge(pieces)` — Android reads TTF, not WOFF2 |
| `crates/kandinsky-android/android/res/font/assistant.ttf`, `assistant_semibold.ttf` | **Assistant** (Medium 500, SemiBold 600), the font of Excalidraw's own interface, for the Android Notepad's islands, panel and menus | SIL Open Font License 1.1 (Assistant by Ben Nathan, Google Fonts) | Excalidraw's `Assistant-Medium.woff2` / `Assistant-SemiBold.woff2` (`ui/node_modules/@excalidraw/excalidraw/dist/prod/fonts/Assistant/`) decompressed to TTF with fontTools (`flavor = None`), 451 glyphs each |

The dependencies fetched by Cargo and npm are not in this repository. Their licences are listed when publishing a release (`cargo about generate`, `npx license-checker --production`), and all of them must be compatible with the AGPL.
