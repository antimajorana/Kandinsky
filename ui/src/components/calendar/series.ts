// A repeating event is stored once, with no per-occurrence exceptions: changing the date of one occurrence moves the
// whole series by the same amount, so the user is asked before that happens.
import { confirmDialog } from "../../lib/confirm";
import type { CalendarEvent } from "../../lib/types";

/** Whether the user agrees to move every occurrence of the repeating event `ev`. */
export function confirmMoveSeries(ev: Pick<CalendarEvent, "title" | "repeat">): Promise<boolean> {
  return confirmDialog(
    "Move the whole series?",
    `“${ev.title}” repeats ${ev.repeat}. One occurrence cannot be moved on its own: every occurrence moves by the same number of days.`,
    "Move all occurrences",
    false,
  );
}
