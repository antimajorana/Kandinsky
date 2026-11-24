# Kandinsky

A workspace for Markdown notes, tasks, PDFs, and tables. Your **vault** is the folder where your notes and files live.

## Get started

1. Download the Windows x64 installer and run the `.exe`. [Latest release](https://github.com/antimajorana/kandinsky/releases/latest)
2. Open Kandinsky and choose **New vault…** or **Open a folder…**. You can open an existing Obsidian vault.
3. Select **New note** in the sidebar. Type `[[Note name]]` to link to another note. [First-run guide](docs/guides/FIRST-RUN.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/readme/workspace-dark.webp">
  <img src="docs/img/readme/workspace-light.webp" alt="A Markdown note with properties, links, and an embedded recipe table">
</picture>

## Organize notes with Bases

A **Base** shows your notes as a table, board, or calendar. Each row is a note, so you can filter and sort by its properties, such as status or rating. Press **F1** and search for **Bases** to open or create one. Select **New** to create a row from a template and answer its prompts. [Notes and templates](docs/guides/NOTES-SYSTEM.md#notes-from-templates)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/readme/base-template-dark.webp">
  <img src="docs/img/readme/base-template-light.webp" alt="A Base’s new-row form showing a default template with two prompts">
</picture>

## Build from source

For local development, use Rust stable and Node 24.

```sh
npm --prefix ui ci
bash scripts/dev/dev.sh /path/to/vault
```

[Documentation](docs/INDEX.md) · [Compatibility](docs/guides/COMPATIBILITY.md) · [Self-hosting](docs/guides/SERVER.md) · [Changelog](docs/CHANGELOG.md)

[AGPL-3.0-or-later](LICENSE) · [License notices](docs/THIRD-PARTY.md)
