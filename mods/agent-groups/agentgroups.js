// SPDX-License-Identifier: Apache-2.0

const SEP = "·";

// Keep this split consistent with space-groups/groups.js. Each mod installs independently.
export function splitName(space) {
  const name = space?.name ?? "";
  const at = space?.named ? name.indexOf(SEP) : -1;
  if (at < 0) return { group: null, label: name };
  return { group: name.slice(0, at).trim(), label: name.slice(at + SEP.length).trim() };
}

export function groupAgents(agents, spaceById) {
  const groups = new Map();
  for (const agent of agents) {
    const space = spaceById.get(agent.space);
    const { group } = splitName(space);
    const id = group === null ? `sp-${agent.space}` : `prefix-${JSON.stringify([space.machine ?? null, group])}`;
    if (!groups.has(id)) {
      const label = group === null ? agent.space_name || space?.name || "" : group || "(empty group)";
      groups.set(id, { id, label, status: null, members: [] });
    }
    groups.get(id).members.push(agent);
  }
  return [...groups.values()];
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
