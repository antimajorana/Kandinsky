// Reactive modal state for Import Notes (Notion, NoteCraft, OneNote, or auto-detect).

export const importNotesModal = $state({ open: false, targetDir: "" });

export function openImportModal(targetDir = ""): void {
  importNotesModal.targetDir = targetDir;
  importNotesModal.open = true;
}

export function closeImportModal(): void {
  importNotesModal.open = false;
}
