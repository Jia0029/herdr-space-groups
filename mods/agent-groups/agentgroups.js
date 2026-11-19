// SPDX-License-Identifier: Apache-2.0

const SEP = "·";
const DRAG_THRESHOLD = 4;

// Keep this split consistent with space-groups/groups.js. Each mod installs independently.
export function splitName(space) {
  const name = space?.name ?? "";
  const at = space?.named ? name.indexOf(SEP) : -1;
  if (at < 0) return { group: null, label: name };
  return { group: name.slice(0, at).trim(), label: name.slice(at + SEP.length).trim() };
}

function spaceGroupId(space, spaceId, group = splitName(space).group) {
  return group === null ? `sp-${spaceId}` : `prefix-${JSON.stringify([space.machine ?? null, group])}`;
}

export function groupAgents(agents, spaceById) {
  const groups = new Map();
  for (const agent of agents) {
    const space = spaceById.get(agent.space);
    const { group } = splitName(space);
    const id = spaceGroupId(space, agent.space, group);
    if (!groups.has(id)) {
      const label = group === null ? agent.space_name || space?.name || "" : group || "(empty group)";
      groups.set(id, { id, label, status: null, members: [] });
    }
    groups.get(id).members.push(agent);
  }
  return [...groups.values()];
}

// Keep the threshold, row halves and simulated move indexes consistent with
// space-groups/groups.js. These moves preserve names and use group headers.
export function exceedsDragThreshold(start, position) {
  return Math.max(Math.abs(position.x - start.x), Math.abs(position.y - start.y)) > DRAG_THRESHOLD;
}

export function rowPlacement({ local_position, bounds }) {
  const y = local_position?.y;
  const height = bounds?.height;
  if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) return undefined;
  return y < height / 2 ? "before" : "after";
}

export function groupMoveApplied(spaces, { machine, ids, anchor, after }) {
  const order = spaces.filter((s) => (s.machine ?? null) === machine).map((s) => s.id);
  const at = order.indexOf(anchor);
  const start = after ? at + 1 : at - ids.length;
  return at >= 0 && start >= 0 && ids.every((id, i) => order[start + i] === id);
}

export function planGroupMove(spaces, sourceId, targetId, placement) {
  if (sourceId === targetId || (placement !== "before" && placement !== "after")) return null;
  const source = [], target = [];
  for (const s of spaces) {
    const id = spaceGroupId(s, s.id);
    if (id === sourceId) source.push(s);
    else if (id === targetId) target.push(s);
  }
  if (!source.length || !target.length) return null;
  const machine = source[0].machine ?? null;
  if (machine !== (target[0].machine ?? null)) return null;
  const after = placement === "after";
  const anchor = (after ? target[target.length - 1] : target[0]).id;
  const ids = source.map((s) => s.id);
  const expected = { machine, ids, anchor, after };
  const commands = [];
  if (!groupMoveApplied(spaces, expected)) {
    const order = spaces.map((s) => s.id);
    for (const id of after ? [...ids].reverse() : ids) {
      const from = order.indexOf(id);
      order.splice(from, 1);
      const to = order.indexOf(anchor) + (after ? 1 : 0);
      order.splice(to, 0, id);
      if (from !== to) commands.push({ id, index: to + 1 });
    }
  }
  return { commands, expected };
}

// Keep done and idle together for the shipped elapsed time, and track the
// actual transition separately for the folded group's attention indicator.
export function trackAgentState(previous, status, now) {
  if (previous && previous.status === status) return previous;
  const s = status === "done" ? "idle" : status;
  return { s, at: previous?.s === s ? previous.at : now, status, statusAt: now };
}

export function toggleGroupFold(folded, id, now) {
  const next = new Map(folded);
  if (!next.delete(id)) next.set(id, now);
  return next;
}

export function hasNewAttention(addresses, changed, foldedAt) {
  if (foldedAt === undefined) return false;
  return addresses.some((address) => {
    const entry = changed[address];
    return (entry?.status === "done" || entry?.status === "blocked") && entry.statusAt > foldedAt;
  });
}
