# Kandinsky

A workspace for Markdown notes, PDFs, tables, and tasks. Your vault is a folder of plain files, with Kandinsky’s settings and plugins in `.kandinsky/`.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/readme/workspace-dark.webp">
  <img src="docs/img/readme/workspace-light.webp" alt="Kandinsky workspace with the page tree, note properties, and a Markdown note">
</picture>

- Write with live preview, wikilinks, backlinks, templates, and tasks. Query notes with Obsidian Bases.
- Arrange blocks on pages, annotate PDFs, and edit CSV and TSV tables. Open Excel sheets read-only or export them to CSV for editing.
- Extend the workspace with plugins for mail, calendars, research, and other tools.

## Get started

- [Download the latest installer](https://github.com/antimajorana/kandinsky/releases/latest) · [First run](docs/guides/FIRST-RUN.md) · [Self-hosting](docs/guides/SERVER.md)
- [Obsidian and Notion compatibility](docs/guides/COMPATIBILITY.md) · [Plugin maturity](docs/guides/PLUGIN-MATURITY.md)

To develop locally with Rust stable and Node 24:

```sh
npm --prefix ui ci
bash scripts/dev/dev.sh /path/to/vault
```

[Documentation](docs/INDEX.md) · [Contributing](docs/CONTRIBUTING.md) · [Changelog](docs/CHANGELOG.md) · [Security](docs/SECURITY.md)

Kandinsky is based on [Atlas by Alneb](https://github.com/Alneb/atlas), renamed and modified in November 2026. [AGPL-3.0-or-later](LICENSE) · [SDK and third-party licenses](docs/THIRD-PARTY.md)
