// Reactive modal state for Per-Page Version History (local snapshots + Git commits).

export interface RestoredPayload {
  path: string;
  text: string;
  mtime: number;
}

export const pageHistoryModal = $state({
  open: false,
  path: "",
  onRestored: null as ((res: RestoredPayload) => void) | null,
});

export function openPageHistory(path: string, onRestored?: (res: RestoredPayload) => void): void {
  pageHistoryModal.path = path;
  pageHistoryModal.onRestored = onRestored ?? null;
  pageHistoryModal.open = true;
}

export function closePageHistory(): void {
  pageHistoryModal.open = false;
  pageHistoryModal.onRestored = null;
}
