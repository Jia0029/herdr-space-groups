// SPDX-License-Identifier: Apache-2.0

export const SEP = "·";
const DRAG_THRESHOLD = 4;
const STATUS_PRIORITY = ["blocked", "done", "working", "idle"];

export function exceedsDragThreshold(start, position) {
  return Math.max(Math.abs(position.x - start.x), Math.abs(position.y - start.y)) > DRAG_THRESHOLD;
}

export function releaseAction(drag, key, position) {
  if (drag.key === key) return "click";
  return drag.moved || exceedsDragThreshold(drag.start, position) ? "drop" : null;
}

export function rowPlacement({ local_position, bounds }) {
  const y = local_position?.y;
  const height = bounds?.height;
  if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) return undefined;
  return y < height / 2 ? "before" : "after";
}

export function splitName(space) {
  const at = space.named ? space.name.indexOf(SEP) : -1;
  if (at < 0) return { group: null, label: space.name };
  return {
    group: space.name.slice(0, at).trim(),
    label: space.name.slice(at + SEP.length).trim(),
  };
}

const machineOf = (space) => space.machine ?? null;
const groupKey = (space, group) => JSON.stringify([machineOf(space), group]);

export function endDropTarget(sourceMachine, machine) {
  return sourceMachine === machine ? { kind: "edge", machine, edge: "end" } : null;
}

function dropMembers(spaces, item) {
  if (item.kind === "space") return spaces.filter((space) => space.id === item.id);
  return spaces.filter((space) => groupKey(space, splitName(space).group) === item.id);
}

function atDropPosition(spaces, { machine, ids, anchor, after, edge }) {
  const order = spaces.filter((space) => machineOf(space) === machine).map((space) => space.id);
  if (edge) {
    const start = edge === "top" ? 0 : order.length - ids.length;
    return start >= 0 && ids.every((id, i) => order[start + i] === id);
  }
  const at = order.indexOf(anchor);
  const start = after ? at + 1 : at - ids.length;
  return at >= 0 && start >= 0 && ids.every((id, i) => order[start + i] === id);
}

export function dropApplied(spaces, expected) {
  const { rename } = expected;
  if (rename && !spaces.some((space) => space.id === rename.id && space.named && space.name === rename.name)) {
    return false;
  }
  return atDropPosition(spaces, expected);
}

// Sources are a space ID or a group key. Targets can also be machine edges.
// Use the underlying order, including members hidden by folded groups.
export function planDrop(spaces, source, target, placement) {
  if (target.kind === "edge") return planEdgeDrop(spaces, source, target);
  const members = dropMembers(spaces, source);
  const destination = dropMembers(spaces, target);
  if (!members.length || !destination.length || machineOf(members[0]) !== machineOf(destination[0])) return null;
  const ids = members.map((space) => space.id);
  const anchors = destination.filter((space) => !ids.includes(space.id));
  if (!anchors.length || (source.kind === "group" && anchors.length !== destination.length)) return null;

  const after = target.kind === "space" && placement !== undefined
    ? placement === "after"
    : (source.kind === "space" && target.kind === "group")
      || spaces.indexOf(members[0]) < spaces.indexOf(destination[0]);
  const anchor = (after ? anchors[anchors.length - 1] : anchors[0]).id;
  const to = splitName(destination[0]).group;
  const rename = source.kind === "space" ? renameForDrop(members[0], to, target.kind === "group") : null;
  return buildDropPlan(spaces, { machine: machineOf(members[0]), ids, anchor, after, rename });
}

export function planEdgeDrop(spaces, source, { machine, edge }) {
  machine ??= null;
  if (edge !== "top" && edge !== "end") return null;
  const members = dropMembers(spaces, source);
  if (!members.length || machineOf(members[0]) !== machine) return null;
  const ids = members.map((space) => space.id);
  const remaining = spaces.filter((space) => machineOf(space) === machine && !ids.includes(space.id));
  const after = edge === "end";
  const anchor = (after ? remaining[remaining.length - 1] : remaining[0])?.id;
  const rename = source.kind === "space" ? renameForDrop(members[0], null) : null;
  return buildDropPlan(spaces, { machine, ids, anchor, after, rename, edge });
}

function renameForDrop(space, to, onHeading = false) {
  const { group, label } = splitName(space);
  if (to !== group || onHeading) {
    const name = to === null ? label : `${to}${SEP}${label}`;
    if (name && (!space.named || name !== space.name)) return { id: space.id, name };
  }
  return null;
}

function buildDropPlan(spaces, expected) {
  const { ids, anchor, after, rename } = expected;
  const commands = rename ? [{ cmd: "space.rename", args: rename }] : [];
  if (!atDropPosition(spaces, expected)) {
    const order = spaces.map((space) => space.id);
    // Insert before the same anchor in forward order or after it in reverse.
    // Each 1-based index uses the order left by every earlier command.
    for (const id of after ? [...ids].reverse() : ids) {
      const from = order.indexOf(id);
      order.splice(from, 1);
      const to = order.indexOf(anchor) + (after ? 1 : 0);
      order.splice(to, 0, id);
      if (from !== to) commands.push({ cmd: "space.move", args: { id, index: to + 1 } });
    }
  }
  return { commands, expected };
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
    const key = groupKey(r.w, group);
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
