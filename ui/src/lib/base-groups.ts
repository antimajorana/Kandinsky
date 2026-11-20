// A Bases view's rows gathered by its `groupBy` value (board lanes, the table's / cards' / list's groups): status
// columns order by lifecycle bucket (To do → In progress → Done → other), everything else in natural order,
// "No value" last; an ungrouped view is one group with no title.
import type { BaseRow } from "./gen/BaseRow";
import type { BaseView } from "./gen/BaseView";
import type { StatusGroups } from "./gen/StatusGroups";
import { effectiveColumnFormat, statusSortRank } from "./base-format";
import { propertySpec } from "./property-spec.svelte";

export const NO_VALUE = "No value";

export interface GroupRowsOptions {
  isStatus?: boolean;
  groups?: StatusGroups | null;
  values?: readonly string[] | null;
}

export function groupRows(view: BaseView, opts?: GroupRowsOptions): { title: string | null; rows: BaseRow[] }[] {
  if (!view.group_by) return [{ title: null, rows: view.rows }];
  const m = new Map<string, BaseRow[]>();
  for (const r of view.rows) {
    const g = r.group || NO_VALUE;
    if (!m.has(g)) m.set(g, []);
    m.get(g)!.push(r);
  }
  const norm = (s: string) => s.replace(/^note\./, "");
  const groupCol =
    view.columns.find((c) => c.id === view.group_by || norm(c.id) === norm(view.group_by!)) ?? { id: view.group_by };
  const key = view.group_key ?? (/^(file|formula)\./.test(view.group_by) ? null : norm(view.group_by));
  const colSpec = key ? propertySpec.spec?.properties[key] : undefined;
  const groups = opts?.groups !== undefined ? opts.groups : (colSpec?.groups ?? null);
  const values = opts?.values !== undefined ? opts.values : (colSpec?.values ?? null);
  const isStatus =
    opts?.isStatus ??
    (colSpec?.kind === "status" || effectiveColumnFormat(groupCol, undefined, colSpec) === "status");

  return [...m]
    .sort(([a], [b]) => {
      if (a === NO_VALUE) return 1;
      if (b === NO_VALUE) return -1;
      if (isStatus) {
        const [ba, pa] = statusSortRank(a, groups, values);
        const [bb, pb] = statusSortRank(b, groups, values);
        if (ba !== bb) return ba - bb;
        if (pa !== pb) return pa - pb;
      }
      return a.localeCompare(b, undefined, { numeric: true });
    })
    .map(([title, rows]) => ({ title, rows }));
}
