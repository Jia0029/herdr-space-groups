// SPDX-License-Identifier: Apache-2.0

export const SEP = "·";
const STATUS_PRIORITY = ["blocked", "done", "working", "idle"];

export function splitName(space) {
  const at = space.named ? space.name.indexOf(SEP) : -1;
  if (at < 0) return { group: null, label: space.name };
  return {
    group: space.name.slice(0, at).trim(),
    label: space.name.slice(at + SEP.length).trim(),
  };
}

// Keep the shipped sidebar's first-main-checkout rule and child order.
export function nestWorktrees(rows, repoOf = (r) => r.g?.repo) {
  const mains = new Set(rows.filter((r) => repoOf(r) && !r.g.linked).map(repoOf));
  const nested = (r) => r.g?.linked && mains.has(repoOf(r));
  const out = [];
  const placed = new Set();
  for (const r of rows) {
    if (nested(r)) continue;
    out.push({ ...r, tree: null });
    const repo = repoOf(r);
    if (!repo || r.g.linked || placed.has(repo)) continue;
    placed.add(repo);
    const kids = rows.filter((k) => nested(k) && repoOf(k) === repo);
    kids.forEach((k, i) => out.push({ ...k, tree: i === kids.length - 1 ? "└─" : "├─" }));
  }
  return out;
}

// Iterate in display order, inserting a group where its first space occurs.
export function groupRows(rows) {
  const entries = [];
  const groups = new Map();
  for (const r of rows) {
    const { group, label } = splitName(r.w);
    const row = { ...r, label };
    if (group === null) {
      entries.push({ kind: "space", row });
      continue;
    }
    const key = JSON.stringify([r.w.machine ?? null, group]);
    if (!groups.has(key)) {
      const entry = { kind: "group", key, name: group, rows: [], active: false, status: null };
      groups.set(key, entry);
      entries.push(entry);
    }
    groups.get(key).rows.push(row);
  }
  for (const entry of groups.values()) {
    const statuses = new Set(entry.rows.map((r) => r.w.status));
    entry.status = STATUS_PRIORITY.find((status) => statuses.has(status)) ?? null;
    entry.active = entry.rows.some((r) => r.w.active);
    entry.rows = nestWorktrees(entry.rows);
  }
  return entries;
}
