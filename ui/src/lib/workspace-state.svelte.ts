// Reactive workspace state kept in a `.svelte.ts` module so Svelte 5 compiles `$state` runes properly.
export const workspaceState = $state({ active: "" as string, saved: [] as string[] });
