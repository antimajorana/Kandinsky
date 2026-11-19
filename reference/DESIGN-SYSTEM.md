# Kandinsky Design System: Kandinsky Paper × Obsidian Mechanics × Wassily Kandinsky Art

This reference specification governs all UI/UX styling for **Kandinsky** (`kandinsky-source/ui/src/`).
Pair this document with the `1440×900` reference captures in this folder:
- `target-notion-kandinsky-dark.png` (*Velvet Circles* — Dark Mode target)
- `target-notion-kandinsky-light.png` (*Bauhaus Paper* — Light Mode target)
- `current-kandinsky-dark.png` / `current-kandinsky-light.png` (latest live captures from `npm run visual-diff`)

Run `npm run visual-diff` in `$env:LOCALAPPDATA\Kandinsky` (or `craft-anything-cli web-pixels-compare --common-area`) to measure `layout_similarity` and `perceptual_similarity` against these targets.

---

## 1. Core Design Philosophy

1. **Looks like Kandinsky Paper / Notion (Unified Sidebar + Clean Page Canvas):**
   - **Single unified navigation sidebar:** One clean `248px` collapsible sidebar replaces the old outer icon rail and multi-tab IDE strip in default Notion shell mode (with a Settings toggle to keep Dockview split tabs / Classic Rail available for power workflows):
     - Vault header (`The Oracle`) with the *Several Circles* emblem.
     - Primary navigation rows (`Search` `Ctrl K`, `Quick capture` `Ctrl Alt N`, `Home`, `Notifications`, `All pages`, `Graph`).
     - Collapsible `Favorites` and vault page tree with page icons and semantic folder accents.
     - Pinned bottom actions (`Trash`, `Plugins`, `Settings`).
   - **Minimal document top bar:** Clean breadcrumb trail (`The Oracle > wiki / concepts > ...`) on the left; `Edited ...`, `Star`, `History`, `...` menu (Full width, Source `Ctrl+E`), `Share/Export`, and `Trash` on the right—no IDE tab strip cluttering normal reading/writing.
   - **Page hero & blocks:** Optional cover image banner / subtle `Add a cover` action, large note icon emblem, `33px` bold title (`letter-spacing: -0.028em`), compact **Notion property rows** (`13px` muted key on left, colored pills/dates/links on right), `/` slash-command menu, `+` / `⋮⋮` margin handles, inline highlights, toggles, horizontal-rule tables, and Notion-style `.base` views (`Table`, `Board`, `Calendar`, `Timeline`, `Gallery`, `List`).

2. **Works like Obsidian (and *The Oracle*'s vault setup):**
   - **100% plain local files (`kandinsky-source/docs/PHILOSOPHY.md`):** Markdown + YAML frontmatter on disk, `[[wikilinks]]`, backlinks & unlinked mentions, `.base`, `.page`, `.canvas`, `.excalidraw`, KaTeX + TikZJax + Typst + Mermaid math/diagrams, Barnes–Hut Graph View, and docked `Antigravity` / `Claude` / `Solver` panes.
   - **Preserved `.obsidian` ergonomics from *The Oracle*:**
     - Default reading measure `740px` (`--measure`, toggleable to `full-width`), base font `16px`, line-height `1.68`.
     - Hidden agent plumbing toggle in explorer (`AGENTS.md`, `wiki/hot.md`, `wiki/index.md`, `wiki/log.md`, `wiki/overview.md`, `wiki/meta`, `zAI`, `zMeta`, `zAttachments`, `genkan`).
     - Semantic wiki folder accents harmonized with Kandinsky pigments: `wiki/concepts` → Cobalt, `wiki/sources` → Viridian, `wiki/entities` → Mauve/Blush, `wiki/meta` → Slate Blue.

3. **Inspired by Wassily Kandinsky (*Several Circles*, 1926 & *Point and Line to Plane*):**
   - **Restraint first:** Calm, high-contrast archival sheets so dense equations never compete with decoration.
   - **Dark Mode (`palette = "kandinsky"` — *Velvet Circles*):**
     - `--bg`: `#15161a` | `--bg-alt`: `#1b1d22` | `--bg-elev`: `#21242b` | `--border`: `rgba(237, 235, 230, 0.075)`
     - `--text`: `#e8e6e1` | `--heading`: `#f5f3ee` | `--text-muted`: `#9ca0ab` | `--accent` / `--link`: `#7d97f4`
     - `--yellow`: `#dfab2e` | `--red`: `#d94e41` | `--green`: `#3ca395` | `--orange`: `#e28327` | `--purple`: `#d48fb0`
   - **Light Mode (`palette = "kandinsky"` — *Bauhaus Paper*):**
     - `--bg`: `#faf8f4` | `--bg-alt`: `#f2efe9` | `--bg-elev`: `#ffffff` | `--border`: `rgba(30, 32, 36, 0.085)`
     - `--text`: `#222428` | `--heading`: `#141518` | `--text-muted`: `#6b707b` | `--accent` / `--link`: `#264ca4`
     - `--yellow`: `#c48b16` | `--red`: `#c6362c` | `--green`: `#247a7d` | `--orange`: `#cf6d17` | `--purple`: `#9b4dca`
   - **Bauhaus micro-geometry:** Callout cards (`●` Theorem, `◎` Proof/Verified, `▲` Warning, `■` Definition) with soft `6–11%` pigment washes; *Several Circles* halo nodes in Graph View.
