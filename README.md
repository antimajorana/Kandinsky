# Kandinsky

Kandinsky is a workspace for Markdown notes, tasks, PDFs, and tables. Your **vault** is the folder that holds those files.

[Download for Windows (x64)](https://github.com/antimajorana/kandinsky/releases/latest) · [First-run guide](docs/guides/FIRST-RUN.md)

Run the installer, then choose **New vault…** or **Open a folder…**. You can open an existing Obsidian vault directly.

## A coffee notebook

Create a note called **Coffee** and type `[[V60]]` to link to a recipe note. Give each recipe a `type` of `Recipe` and a `rating`.

A **Base** shows matching notes as a table, board, or calendar. Press **F1**, search for **Bases**, and create `recipes.base`. Filter by type, sort by rating, and embed the table in **Coffee** with `![[recipes.base]]`.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/readme/workspace-dark.webp">
  <img src="docs/img/readme/workspace-light.webp" alt="Coffee note with links and an embedded recipe table sorted by rating">
</picture>

Select **New** in the Base to add another recipe from a template. In this example, **Brew log** asks for the dose and water amount. The answers are saved in a Markdown note that appears in the table. [Notes and templates](docs/guides/NOTES-SYSTEM.md#notes-from-templates)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/readme/base-template-dark.webp">
  <img src="docs/img/readme/base-template-light.webp" alt="New recipe form with the Brew log template and fields for dose and water">
</picture>

## Build from source

For local development, use Rust stable and Node 24.

```sh
npm --prefix ui ci
bash scripts/dev/dev.sh /path/to/vault
```

[Documentation](docs/INDEX.md) · [Compatibility](docs/guides/COMPATIBILITY.md) · [Self-hosting](docs/guides/SERVER.md) · [Changelog](docs/CHANGELOG.md)

[AGPL-3.0-or-later](LICENSE) · [License notices](docs/THIRD-PARTY.md)
