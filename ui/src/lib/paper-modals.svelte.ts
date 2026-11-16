// Reactive modal state for Zotero migration and References workflows (add/search, drop inbox, duplicate merge, folder scan).

export type PaperWorkflowTab = "add" | "inbox" | "duplicates" | "scan";

export const zoteroModal = $state({ open: false });

export function openZoteroImportModal(): void {
  zoteroModal.open = true;
}

export function closeZoteroImportModal(): void {
  zoteroModal.open = false;
}

export const paperWorkflowModal = $state<{
  open: boolean;
  tab: PaperWorkflowTab;
  initialQuery: string;
}>({
  open: false,
  tab: "add",
  initialQuery: "",
});

export function openPaperWorkflowModal(tab: PaperWorkflowTab = "add", initialQuery = ""): void {
  paperWorkflowModal.tab = tab;
  paperWorkflowModal.initialQuery = initialQuery;
  paperWorkflowModal.open = true;
}

export function closePaperWorkflowModal(): void {
  paperWorkflowModal.open = false;
}
