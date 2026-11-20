<script lang="ts">
  // Notion-style searchable Emoji, Bauhaus Emblem, and Custom Image page icon picker.
  import {
    cleanImageIconPath,
    EMOJI_CATALOG,
    EMOJI_CATEGORIES,
    getRecentIcons,
    isImageIcon,
    lookupEmojiEntry,
    pushRecentIcon,
    randomEmojiIcon,
    searchEmojiIcons,
    type EmojiCategoryId,
    type EmojiEntry,
  } from "../lib/emoji-data";
  import { dirOf } from "../lib/paths";
  import { blobUrlNow, warm } from "../lib/raw";
  import { isNotionShell } from "../lib/shell-mode.svelte";
  import { resolveLink, resolveOrBeside, vaultReady } from "../lib/vault";

  let {
    path = "",
    currentIcon = "",
    onSelect,
    onResetDefault,
    onRemove,
  }: {
    path?: string;
    currentIcon?: string;
    onSelect: (icon: string) => void;
    onResetDefault: () => void;
    onRemove: () => void;
  } = $props();

  let tab = $state<"emoji" | "image">("emoji");
  let query = $state("");
  let activeCategory = $state<EmojiCategoryId>("symbols");
  let recents = $state<string[]>(getRecentIcons());
  let customUrl = $state("");
  let previewUrl = $state<string | null>(null);
  let scrollEl = $state<HTMLDivElement>();

  $effect(() => {
    const cleaned = cleanImageIconPath(currentIcon);
    if (isImageIcon(cleaned)) {
      customUrl = cleaned;
    }
  });

  // Resolve custom image preview (remote URL or vault-relative image path)
  $effect(() => {
    const val = cleanImageIconPath(customUrl);
    if (!val || !isImageIcon(val)) {
      previewUrl = null;
      return;
    }
    if (/^(https?:|data:|blob:)/i.test(val)) {
      previewUrl = val;
      return;
    }
    const dir = dirOf(path);
    const target = resolveLink(val, dir) ?? val;
    const now = blobUrlNow(target);
    if (now) {
      previewUrl = now;
      return;
    }
    let cancelled = false;
    void vaultReady()
      .then(() => warm(resolveOrBeside(val, dir)))
      .then((u) => {
        if (!cancelled) previewUrl = u;
      })
      .catch(() => {
        if (!cancelled) previewUrl = null;
      });
    return () => {
      cancelled = true;
    };
  });

  const searchResults = $derived.by(() => (query.trim() ? searchEmojiIcons(query) : []));

  const groupedSections = $derived.by(() => {
    const byCat = new Map<EmojiCategoryId, EmojiEntry[]>();
    for (const c of EMOJI_CATEGORIES) {
      if (c.id !== "recent") byCat.set(c.id, []);
    }
    for (const item of EMOJI_CATALOG) {
      byCat.get(item.category)?.push(item);
    }
    return EMOJI_CATEGORIES.filter((c) => c.id !== "recent").map((c) => ({
      id: c.id,
      label: c.label,
      items: byCat.get(c.id) ?? [],
    }));
  });

  function pickEmoji(glyph: string): void {
    recents = pushRecentIcon(glyph);
    onSelect(glyph);
  }

  function pickRandom(): void {
    pickEmoji(randomEmojiIcon());
  }

  function submitCustomImage(e: SubmitEvent): void {
    e.preventDefault();
    const cleaned = cleanImageIconPath(customUrl);
    if (!cleaned) return;
    onSelect(cleaned);
  }

  function jumpToCategory(cat: EmojiCategoryId): void {
    activeCategory = cat;
    query = "";
    const target = scrollEl?.querySelector<HTMLElement>(`[data-cat="${cat}"]`);
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function isSelected(glyph: string): boolean {
    return currentIcon === glyph || (!currentIcon && glyph === "◎" && isNotionShell());
  }
</script>

<div class="emoji-picker" data-testid="icon-picker">
  <div class="picker-top">
    <div class="kandinsky-seg picker-tabs" role="tablist" aria-label="Icon type">
      <button
        type="button"
        role="tab"
        aria-selected={tab === "emoji"}
        class:on={tab === "emoji"}
        onclick={() => (tab = "emoji")}
      >
        Emoji
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "image"}
        class:on={tab === "image"}
        onclick={() => (tab = "image")}
      >
        Custom image
      </button>
    </div>
    <div class="picker-head-actions">
      {#if tab === "emoji"}
        <button type="button" class="mini-act" data-testid="icon-random-btn" onclick={pickRandom} title="Pick random icon">
          Random
        </button>
      {/if}
      <button type="button" class="mini-act" data-testid="icon-default-btn" onclick={onResetDefault} title="Use default ◎ emblem">
        Default ◎
      </button>
      <button type="button" class="mini-act" data-testid="icon-remove-btn" onclick={onRemove}>
        Remove
      </button>
    </div>
  </div>

  {#if tab === "emoji"}
    <div class="search-row">
      <input
        type="search"
        class="search-input"
        placeholder="Search emoji or symbol…"
        aria-label="Search emoji or symbol"
        data-testid="icon-search-input"
        bind:value={query}
      />
    </div>

    {#if !query.trim()}
      <div class="cat-pills" role="navigation" aria-label="Emoji categories">
        {#each EMOJI_CATEGORIES as cat (cat.id)}
          {#if cat.id !== "recent" || recents.length > 0}
            <button
              type="button"
              class="cat-pill"
              class:active={activeCategory === cat.id}
              onclick={() => jumpToCategory(cat.id)}
            >
              {cat.label}
            </button>
          {/if}
        {/each}
      </div>
    {/if}

    <div class="emoji-scroll" bind:this={scrollEl}>
      {#if query.trim()}
        {#if searchResults.length}
          <div class="cat-head">Results ({searchResults.length})</div>
          <div class="icon-grid">
            {#each searchResults as item (item.icon)}
              <button
                type="button"
                class="icon-cell"
                class:selected={isSelected(item.icon)}
                title="{item.name} ({item.icon})"
                aria-label={item.name}
                onclick={() => pickEmoji(item.icon)}
              >
                {item.icon}
              </button>
            {/each}
          </div>
        {:else}
          <p class="empty-msg">No emoji or symbol matches “{query.trim()}”.</p>
        {/if}
      {:else}
        {#if recents.length}
          <div class="cat-section" data-cat="recent" data-testid="icon-recent-section">
            <div class="cat-head">Recent</div>
            <div class="icon-grid">
              {#each recents as g (`recent-${g}`)}
                <button
                  type="button"
                  class="icon-cell"
                  class:selected={isSelected(g)}
                  title={lookupEmojiEntry(g)?.name ?? `Set icon ${g}`}
                  aria-label={lookupEmojiEntry(g)?.name ?? `Icon ${g}`}
                  onclick={() => pickEmoji(g)}
                >
                  {g}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        {#each groupedSections as sec (sec.id)}
          <div class="cat-section" data-cat={sec.id}>
            <div class="cat-head">{sec.label}</div>
            <div class="icon-grid">
              {#each sec.items as item (`${sec.id}-${item.icon}`)}
                <button
                  type="button"
                  class="icon-cell"
                  class:selected={isSelected(item.icon)}
                  title="{item.name} ({item.icon})"
                  aria-label={item.name}
                  onclick={() => pickEmoji(item.icon)}
                >
                  {item.icon}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {:else}
    <form class="image-form" onsubmit={submitCustomImage}>
      <label class="img-label" for="custom-icon-input">Vault image path or URL</label>
      <div class="img-input-row">
        <input
          id="custom-icon-input"
          type="text"
          class="img-input"
          placeholder="assets/icon.png or https://…"
          aria-label="Custom icon image path or URL"
          data-testid="icon-custom-image-input"
          bind:value={customUrl}
        />
        <button type="submit" class="btn primary mini-submit">Apply</button>
      </div>
      {#if previewUrl}
        <div class="img-preview-row">
          <img src={previewUrl} alt="Icon preview" class="img-preview" />
          <span class="img-hint">Preview of page icon</span>
        </div>
      {:else}
        <p class="img-help">
          Enter a vault-relative image path (for example <code>assets/emblem.png</code>) or an <code>https://</code> image link.
        </p>
      {/if}
    </form>
  {/if}
</div>

<style>
  .emoji-picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 2px;
  }

  .picker-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    flex-wrap: wrap;
  }

  .picker-tabs > button {
    font-size: calc(11.5px * var(--ui-scale, 1));
    padding: 2px 8px;
  }

  .picker-head-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }

  .mini-act {
    padding: 3px 7px;
    border-radius: var(--radius-sm);
    font-size: calc(11px * var(--ui-scale, 1));
    color: var(--text-muted);
    border: 1px solid var(--border);
    background: var(--bg);
    cursor: pointer;
    transition: background 100ms, color 100ms, border-color 100ms;
  }
  .mini-act:hover {
    color: var(--text);
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .search-row {
    display: flex;
  }

  .search-input {
    width: 100%;
    min-width: 0;
    padding: 5px 9px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text);
    font-size: calc(12px * var(--ui-scale, 1));
    outline: none;
  }
  .search-input:focus {
    border-color: var(--accent);
  }

  .cat-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .cat-pill {
    padding: 2px 7px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-muted);
    font-size: calc(10.5px * var(--ui-scale, 1));
    cursor: pointer;
    transition: background 100ms, color 100ms, border-color 100ms;
  }
  .cat-pill:hover {
    color: var(--text);
    background: var(--bg-hover);
  }
  .cat-pill.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .emoji-scroll {
    max-height: 256px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-right: 2px;
  }

  .cat-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .cat-head {
    font-size: calc(10.5px * var(--ui-scale, 1));
    font-weight: 600;
    letter-spacing: .05em;
    text-transform: uppercase;
    color: var(--text-faint);
    padding: 2px 2px 0;
  }

  .icon-grid {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 4px;
  }

  .icon-cell {
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: transparent;
    color: var(--heading);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    transition: background 90ms, border-color 90ms, transform 90ms;
  }
  .icon-cell:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }
  .icon-cell.selected {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }

  .empty-msg {
    margin: 12px 4px;
    color: var(--text-faint);
    font-size: calc(12px * var(--ui-scale, 1));
    text-align: center;
  }

  .image-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 2px;
  }

  .img-label {
    font-size: calc(11.5px * var(--ui-scale, 1));
    font-weight: 500;
    color: var(--text-muted);
  }

  .img-input-row {
    display: flex;
    gap: 6px;
  }

  .img-input {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text);
    font-size: calc(12px * var(--ui-scale, 1));
    outline: none;
  }
  .img-input:focus {
    border-color: var(--accent);
  }

  .mini-submit {
    flex: none;
  }

  .img-preview-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg);
  }

  .img-preview {
    width: 28px;
    height: 28px;
    object-fit: cover;
    border-radius: 5px;
    flex: none;
  }

  .img-hint,
  .img-help {
    margin: 0;
    font-size: calc(11.5px * var(--ui-scale, 1));
    color: var(--text-faint);
    line-height: 1.45;
  }
</style>
