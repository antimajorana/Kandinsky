<script lang="ts">
  // A `.base` file opened on its own: calm topbar + full-size interactive table.
  import BaseTable from "../components/BaseTable.svelte";
  import PaneTopbar from "../components/PaneTopbar.svelte";
  import { below, popMenu } from "../lib/menu";
  import { shownName } from "../lib/paths";
  import { copyPath } from "../lib/tabs.svelte";
  import { isFileStarred, toggleFileStar } from "../lib/bookmarks.svelte";
  import { open, type PaneProps } from "../lib/dock";
  import { api } from "../lib/api";
  import { toast } from "../lib/state.svelte";

  let { spec }: PaneProps<"base"> = $props();
  // svelte-ignore state_referenced_locally -- a pane's spec is fixed for its lifetime
  const path = spec.path;
  const starred = $derived(isFileStarred(path));
  const baseTitle = $derived(shownName(path));

  async function copyWikilink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(`[[${baseTitle}]]`);
      toast("Wikilink copied", baseTitle);
    } catch {
      toast("Could not copy to clipboard", "", "error");
    }
  }

  function openShareMenu(e: MouseEvent): void {
    popMenu(
      below(e, [
        { label: "Copy [[wikilink]]", icon: "link", run: () => void copyWikilink() },
        { label: "Copy file path", icon: "file-text", run: () => void copyPath(path) },
        { label: "Export / Print…", icon: "external-link", run: () => window.print() },
      ], 4),
    );
  }

  function openMoreMenu(e: MouseEvent): void {
    popMenu(
      below(e, [
        { label: "Edit source", icon: "file-code", run: () => open({ kind: "editor", path }) },
        { label: "Reveal in Explorer", icon: "folder-open", run: () => open({ kind: "explorer", source: "vault", place: "", path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" }) },
        "sep",
        { label: "Move to Trash", icon: "trash", danger: true, run: () => void api.trash(path).then(() => toast("Moved to Trash", baseTitle)) },
      ], 4),
    );
  }
</script>

<div class="base-pane">
  <PaneTopbar
    {path}
    title={baseTitle}
    ariaLabel="Database header"
    {starred}
    showFileIcon={true}
    onStar={() => toggleFileStar(path, baseTitle)}
    onShare={openShareMenu}
    onMore={openMoreMenu}
  />
  <BaseTable path={spec.path} view={spec.view} />
</div>

<style>
  .base-pane { height: 100%; display: flex; flex-direction: column; background: var(--bg); }
  .base-pane > :global(.base) { flex: 1; }
</style>
