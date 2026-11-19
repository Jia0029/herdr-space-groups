// SPDX-License-Identifier: Apache-2.0
// Adapted from the Herdr 0.1.16 built-in spaces mod (github.com/herdrdev/herdr-app).
// Changes: per-machine name-prefix groups, local folding, collapsed group status,
// and group-scoped worktree nesting. See NOTICE.
//
// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind.
// Click to switch, right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, ScrollHandle } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, closeOverlay, props, exec, hc, theme, shared, setShared, watchFolder, window, layout, notify } from "herdr";
import { dropApplied, endDropTarget, exceedsDragThreshold, findNewSpace, MACHINE_ORDER_KEY, namesApplied, nestWorktrees, orderMachines, planDrop, planIntoGroup, planMachineMove, planRenameGroup, planUngroup, releaseAction, rowPlacement, splitName, validateGroupName, wideSpaceList } from "./groups.js";

const FOLDED_GROUPS_KEY = "space-groups.folded";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const RAIL_CELL = 32;
// A space's name and its git tail never shrink below this, so a short one ("api")
// stays readable instead of turning into an ellipsis next to a long branch.
const SIDE_MIN = 48;
const GROUP_INDENT = 14;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Places looked at together (two git runs each). All at once, a few hundred spaces
// run out of the app's open files (256 when started from the Dock on macOS) or
// past a machine core's 16 running execs, and those spaces wait for FALLBACK.
const AT_ONCE = 6;

// Both runs, finished: a place isn't done while one of its runs still holds a slot.
async function both(a, b) {
  const done = await Promise.allSettled([a, b]);
  const failed = done.find((d) => d.status === "rejected");
  if (failed) throw failed.reason;
  return done.map((d) => d.value);
}

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    const panel = props() ?? {};
    if (panel.groupPrompt) { this.initGroupPrompt(panel, cx); return; }
    if (panel.groupAction) {
      cx.timer.after(0, cx => this.performGroupAction(panel, cx));
      return;
    }
    if (panel.groupMenu) return;
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Map(); // local repos' pending folder watches
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.drag = null;
    this.scroll = ScrollHandle.new(); // the list's position: the active space is brought into view through it
    this.activeAt = -1; // the active space's place among the list's children (headers and rows), -1 when not drawn
    this.machines = [];
    try {
      this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
      if (!this.reconnecting || typeof this.reconnecting !== "object" || Array.isArray(this.reconnecting)) this.reconnecting = {};
      for (const state of Object.values(this.reconnecting)) state.busy = false;
    } catch { this.reconnecting = {}; }
    try { this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]")); } catch { this.folded = new Set(); }
    try { this.foldedGroups = new Set(JSON.parse(localStorage.getItem(FOLDED_GROUPS_KEY) ?? "[]")); } catch { this.foldedGroups = new Set(); }
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
    }
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.check(keys[next++], cx);
        }));
      }
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      );
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      );
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {}
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  openGroupMenu(machine, group) {
    openOverlay({ mod: "space-groups", kind: "popup", width: 205, height: group === null ? 42 : 106,
      props: { groupMenu: true, machine, group } });
  }

  groupMenu(panel, t) {
    const items = panel.group === null ? [["create", "New group…", true]] : [
      ["rename", "Rename group…", true],
      ["ungroup", "Ungroup", false],
      ["add", "New space in group", false],
    ];
    return v_flex().w_full().p(5).bg(t.popover).text_color(t.foreground).text_size(12.8)
      .children(items.map(([action, label, prompt]) => h_flex().id(`group-menu-${action}`).h(32).px(8)
        .items_center().rounded(6).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click(() => {
          if (!prompt) { this.startGroupAction(panel, action, panel.group); return; }
          closeOverlay(panel.overlay);
          openOverlay({ mod: "space-groups", kind: "dialog", modal: true, width: 340, height: 185,
            props: { groupPrompt: action, machine: panel.machine, group: panel.group, title: label } });
        }).child(label)));
  }

  initGroupPrompt(panel, cx) {
    const value = panel.groupPrompt === "rename" ? panel.group : "";
    this.groupInput = InputState.new({ value });
    this.groupInput.set_selected_range({ start: 0, end: value.length });
    this.groupInput.on("change", (_e, cx) => { this.groupInputError = null; cx.notify(); });
    this.groupInput.on("submit", (_e, cx) => this.submitGroupPrompt(panel, cx));
    this.groupFocus = cx.focus_handle();
    this.groupInput.focus();
    cx.timer.after(600, () => this.groupInput.focus());
  }

  submitGroupPrompt(panel, cx) {
    const { name, error } = validateGroupName(this.groupInput.value());
    if (error) { this.groupInputError = error; cx.notify(); return; }
    this.startGroupAction(panel, panel.groupPrompt, name);
  }

  groupPrompt(panel, t) {
    const button = (id, label, action) => h_flex().id(id).h(30).px(12).items_center().rounded(6)
      .bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover)).on_click(action).child(label);
    return v_flex().id("group-prompt").track_focus(this.groupFocus)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { cx.stop_propagation(); closeOverlay(panel.overlay); }
      })
      .w_full().p(15).gap(8).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(div().font_semibold().child(panel.title))
      .child(div().text_color(t.dim).child("Group name"))
      .child(Input.new(this.groupInput).h(34).px(8).rounded(6).border_1().border_color(t.input).bg(t.background))
      .when(Boolean(this.groupInputError), el => el.child(div().text_color(t.blocked).child(this.groupInputError)))
      .child(h_flex().gap(8).justify_end()
        .child(button("group-cancel", "Cancel", () => closeOverlay(panel.overlay)))
        .child(button("group-save", "Save", (_e, cx) => this.submitGroupPrompt(panel, cx))));
  }

  startGroupAction(panel, action, name) {
    closeOverlay(panel.overlay);
    // The work has its own short-lived view so clicking away from the menu
    // cannot interrupt discovery of the space or verification of the change.
    openOverlay({ mod: "space-groups", kind: "window", frame: "none", width: 220, height: 46,
      props: { groupAction: action, machine: panel.machine, group: panel.group, name } });
  }

  applySpaceCommands(commands) {
    for (const { cmd, args } of commands) {
      if (cmd === "space.rename") run("space.rename", args);
      if (cmd === "space.move") run("space.move", args);
    }
  }

  finishGroupAction(panel, ok) {
    if (!ok) notify({ title: "Group update was not confirmed", level: "error" });
    closeOverlay(panel.overlay);
  }

  waitForGroupAction(panel, deadline, inspect, done, cx) {
    try {
      const result = inspect(spaces());
      if (result) { done(result, cx); return; }
      const remaining = deadline - Date.now();
      if (remaining <= 0) { this.finishGroupAction(panel, false); return; }
      cx.timer.after(Math.min(100, remaining), cx => this.waitForGroupAction(panel, deadline, inspect, done, cx));
    } catch { this.finishGroupAction(panel, false); }
  }

  applyGroupPlan(panel, plan, cx) {
    if (!plan) { this.finishGroupAction(panel, false); return; }
    this.applySpaceCommands(plan.commands);
    this.waitForGroupAction(panel, Date.now() + 2000, live => (
      plan.expected ? dropApplied(live, plan.expected) : namesApplied(live, plan.names)
    ), () => this.finishGroupAction(panel, true), cx);
  }

  performGroupAction(panel, cx) {
    try {
      const current = spaces();
      if (panel.groupAction === "rename") {
        this.applyGroupPlan(panel, planRenameGroup(current, panel.machine, panel.group, panel.name), cx);
        return;
      }
      if (panel.groupAction === "ungroup") {
        this.applyGroupPlan(panel, planUngroup(current, panel.machine, panel.group), cx);
        return;
      }
      if (panel.groupAction !== "create" && panel.groupAction !== "add") { this.finishGroupAction(panel, false); return; }
      const before = new Set(current.map(s => s.id));
      run("space.new", { machine: panel.machine ?? "", focus: true });
      this.waitForGroupAction(panel, Date.now() + 3000, live => findNewSpace(before, live, panel.machine),
        (space, cx) => this.applyGroupPlan(panel, planIntoGroup(spaces(), space.id, panel.machine, panel.name), cx), cx);
    } catch { this.finishGroupAction(panel, false); }
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Ungrouped worktrees keep the shipped order. Grouped worktrees nest only
  // in the sidebar so grouping doesn't move them across intervening spaces.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const repos = new Map(list.filter((r) => splitName(r.w).group === null).map((r) => [r.w.id, r.g?.repo]));
    const out = nestWorktrees(list, (r) => repos.get(r.w.id));
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  trackDrag(el, target) {
    const key = `${target.kind}-${target.id}`;
    const source = el.on_mouse_down("left", (e) => {
      this.drag = { source: target, key, start: e.position, moved: false, over: null };
    });
    return this.trackDropTarget(source, target, key);
  }

  trackDropTarget(el, target, key) {
    return el
      .on_mouse_move((e, cx) => {
        if (!this.drag) return;
        cx.stop_propagation();
        this.moveDrag(e, cx, target, key);
      })
      .on_mouse_up("left", (e, cx) => this.finishDrag(e, cx, target, key));
  }

  pointerDrop(source, target, placement) {
    if (!target) return null;
    if (source.kind === "machine") {
      if (target.kind !== "machine") return null;
      const order = planMachineMove(this.machineNames, shared(MACHINE_ORDER_KEY), source.machine, target.machine, placement);
      return order ? { order, expected: { after: placement === "after" } } : null;
    }
    const destination = target.kind === "machine" ? { kind: "edge", machine: target.machine, edge: "top" } : target;
    return planDrop(spaces(), source, destination, placement);
  }

  usesPlacement(source, target) {
    return source.kind === "machine" ? target?.kind === "machine" : target?.kind === "space";
  }

  moveDrag(e, cx, target, key) {
    const drag = this.drag;
    if (!drag) return;
    const wasMoving = drag.moved;
    drag.moved ||= exceedsDragThreshold(drag.start, e.position);
    if (!drag.moved) return;
    const placement = this.usesPlacement(drag.source, target) ? rowPlacement(e) : undefined;
    if (target && drag.over?.key === key
      && (placement === undefined || drag.over.after === (placement === "after"))) return;
    const plan = this.pointerDrop(drag.source, target, placement);
    const next = plan ? { key, after: plan.expected.after } : null;
    if (wasMoving && drag.over?.key === next?.key && drag.over?.after === next?.after) return;
    drag.over = next;
    cx.notify();
  }

  finishDrag(e, cx, target, key) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    cx.stop_propagation();
    cx.notify();
    const action = releaseAction(drag, key, e.position);
    if (action === "click") {
      if (target.kind === "space") run("space.select", { id: target.id });
      else if (target.kind === "group") this.toggleGroup(target.id);
      else if (target.kind === "machine" && !drag.moved && !exceedsDragThreshold(drag.start, e.position)) {
        if (target.openSettings) run("app.settings", { section: "machines" });
        else this.toggleMachine(target.machine);
      }
      return;
    }
    if (action !== "drop") return;
    const placement = this.usesPlacement(drag.source, target) && drag.over?.key === key
      ? (drag.over.after ? "after" : "before")
      : drag.source.kind === "machine" && target.kind === "machine" ? rowPlacement(e) : undefined;
    const plan = this.pointerDrop(drag.source, target, placement);
    if (plan?.order) { setShared(MACHINE_ORDER_KEY, plan.order); return; }
    if (!plan?.commands.length) return;
    this.applySpaceCommands(plan.commands);
    this.verifyDrop(plan.expected, Date.now() + 2000, cx);
  }

  toggleGroup(key) {
    if (this.foldedGroups.has(key)) this.foldedGroups.delete(key);
    else this.foldedGroups.add(key);
    localStorage.setItem(FOLDED_GROUPS_KEY, JSON.stringify([...this.foldedGroups]));
  }

  toggleMachine(machine) {
    if (this.folded.has(machine)) this.folded.delete(machine);
    else this.folded.add(machine);
    localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
  }

  cancelDrag(cx) {
    if (!this.drag) return;
    this.drag = null;
    cx.notify();
  }

  verifyDrop(expected, deadline, cx) {
    if (dropApplied(spaces(), expected)) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      notify({ title: "Space drop failed", body: "The requested name or order was not confirmed.", level: "error" });
      return;
    }
    cx.timer.after(Math.min(100, remaining), (cx) => this.verifyDrop(expected, deadline, cx));
  }

  dropLine(t, after) {
    return div().absolute().left(0).right(0).h(2).bg(t.accent)
      .when(after, el => el.bottom(0))
      .when(!after, el => el.top(0));
  }

  groupHeading(entry, t) {
    const { key, name, rows, active, status } = entry;
    const folded = this.foldedGroups.has(key);
    const selected = folded && active;
    const dragKey = `group-${key}`;
    const over = this.drag?.over?.key === dragKey ? this.drag.over : null;
    const head = h_flex().relative().id(`space-group-${key}`).h(26).flex_none().px(8).gap(7)
      .items_center().rounded(7).text_size(11.5).text_color(selected ? t.foreground : t.muted)
      .cursor_pointer()
      .when(selected, el => el.bg(t.selected))
      .when(!selected && !this.drag?.moved, el => el.hover(s => s.bg(t.hover)))
      .when(this.drag?.moved && this.drag.key === dragKey, el => el.opacity(0.5))
      .when(Boolean(over), el => el.border_1().border_color(t.accent))
      .when(over && this.drag.source.kind === "group", el => el.child(this.dropLine(t, over.after)))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.openGroupMenu(rows[0].w.machine ?? null, name);
      })
      .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none())
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(name || "(empty group)"))
      .child(div().flex_none().text_color(selected ? t.muted : t.dim).child(String(rows.length)))
      .when(folded && status !== null, el => el.child(
        div().flex_none().text_color(tone(t, status)).tooltip(status).child(glyph(status)),
      ));
    return this.trackDrag(head, { kind: "group", id: key, machine: rows[0].w.machine ?? null });
  }

  spaceRows(rows, t, collapsed) {
    if (collapsed) return { items: rows.map(r => this.compact(r, t)), activeAt: rows.findIndex(r => r.w.active) };
    const { entries, activeAt } = wideSpaceList(rows, this.foldedGroups);
    const items = entries.map(e => e.kind === "group" ? this.groupHeading(e, t) : this.row(e.row, t, e.inGroup));
    return { items, activeAt };
  }

  endZone(target, t) {
    const key = `edge-end-${JSON.stringify(target.machine)}`;
    const over = this.drag.over?.key === key;
    const zone = h_flex().id(key).h(18).flex_none().items_center().justify_center()
      .rounded(4).border_1().border_dashed().border_color(over ? t.accent : t.border)
      .text_size(10).text_color(over ? t.accent : t.dim)
      .when(over, el => el.bg(t.hover))
      .child("Move to end");
    return this.trackDropTarget(zone, target, key);
  }

  withEndZone(rows, machine, t, collapsed) {
    if (collapsed || !this.drag?.moved || this.drag.source.kind === "machine") return rows;
    const target = endDropTarget(this.drag.source.machine, machine);
    return target ? [...rows, this.endZone(target, t)] : rows;
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    // Where the active space's row lands among the children this returns: the list scrolls by its direct
    // children, including group and machine headings, separators, guidance and drop zones.
    this.activeAt = -1;
    let before = 0;
    const remote = [...new Set([...rows.map(r => r.w.machine), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)].filter(Boolean))];
    this.machineNames = [null, ...remote];
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) {
      if (loading(null) && !rows.length) return [loadingRow(null)];
      const { items, activeAt } = this.spaceRows(rows, t, collapsed);
      this.activeAt = activeAt;
      return this.withEndZone(items, null, t, collapsed);
    }
    const machineNames = orderMachines(this.machineNames, shared(MACHINE_ORDER_KEY));
    return machineNames.flatMap((m, i) => {
      const separator = !collapsed && i > 0 ? [div().w_full().h(1).flex_none().mt(8).mb(4).bg(t.border)] : [];
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const dropKey = `machine-${m ?? ""}`;
      const machineDrag = this.drag?.source.kind === "machine";
      const over = this.drag?.over?.key === dropKey ? this.drag.over : null;
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${JSON.stringify(m)}`).relative().h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer()
        .when(!this.drag?.moved, el => el.hover(s => s.bg(t.hover)))
        .when(machineDrag && this.drag.moved && this.drag.key === dropKey, el => el.opacity(0.5))
        .when(over && machineDrag, el => el.child(this.dropLine(t, over.after)))
        .when(!collapsed && over && !machineDrag, el => el.border_1().border_color(t.accent))
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          this.openGroupMenu(m, null);
        })
        .when(machine?.keeps_running_after_logout === false, el => el.child(div().id(`machine-logout-${m}`)
          .flex_none().text_color(t.blocked).tooltip("Agents stop when you disconnect. Click for the fix.")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }); }).child("⚠")))
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().text_color(t.muted).child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const machineHead = this.trackDrag(head, { kind: "machine", id: m ?? "", machine: m, openSettings: collapsed && Boolean(login) });
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) { before += separator.length + 1; return [...separator, machineHead]; }
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const items = [...separator, cell(machineHead), ...guidance];
      if (!folded) {
        const { items: spaceRows, activeAt } = mine.length
          ? this.spaceRows(mine, t, collapsed)
          : { items: [loading(m) ? loadingRow(m) : cell(empty)], activeAt: -1 };
        if (activeAt >= 0) this.activeAt = before + items.length + activeAt;
        items.push(...this.withEndZone(spaceRows, m, t, collapsed));
      }
      before += items.length;
      return items;
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one. When the row is full, it
  // and the name both start from their text's width and give way in proportion.
  gitTail(g, tree, name, t, minTextWidth) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_auto()
      .min_w(where ? minTextWidth : 0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, g, tree, label }, t, inGroup = false) {
    const on = w.active;
    const minTextWidth = inGroup ? SIDE_MIN - GROUP_INDENT : SIDE_MIN;
    const dragKey = `space-${w.id}`;
    const over = this.drag?.over?.key === dragKey ? this.drag.over : null;
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    const row = v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .when(inGroup, el => el.pl(8 + GROUP_INDENT))
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on && !this.drag?.moved, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.drag?.moved && this.drag.key === dragKey, el => el.opacity(0.5))
      .when(Boolean(over), el => el.child(this.dropLine(t, over.after)))
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...label][0]?.toUpperCase() ?? "?")))
          .child(div().flex_initial().min_w(minTextWidth).truncate().text_color(t.foreground).child(label))
          .child(g ? this.gitTail(g, tree, label, t, minTextWidth) : div().flex_1()),
      );
    return this.trackDrag(row, { kind: "space", id: w.id, machine: w.machine ?? null });
  }

  compact({ w, i }, t) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  render() {
    const t = theme();
    const panel = props() ?? {};
    if (panel.groupMenu) return this.groupMenu(panel, t);
    if (panel.groupPrompt) return this.groupPrompt(panel, t);
    if (panel.groupAction) return div().p(12).bg(t.popover).text_color(t.foreground).child("Updating spaces…");
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    const list = this.grouped(t, collapsed);
    // Bring the active space into view when it, or its place in the list, changes; a row already in view stays put.
    const active = sp.find(p => p.active)?.id;
    if (!this.drag?.moved && (this.revealAfterDrag || active !== this.revealed || this.activeAt !== this.revealedAt)) {
      this.revealAfterDrag = false;
      this.revealed = active;
      this.revealedAt = this.activeAt;
      if (this.activeAt >= 0) this.scroll.scroll_to_item(this.activeAt);
    }
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().id("space-list").flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always").track_scroll(this.scroll)
        .on_size_change((_size, cx) => {
          if (this.activeAt < 0) return;
          if (this.drag?.moved) this.revealAfterDrag = true;
          else { this.scroll.scroll_to_item(this.activeAt); cx.notify(); }
        })
        .on_mouse_move((e, cx) => this.moveDrag(e, cx, null, null))
        .on_mouse_up("left", (_e, cx) => this.cancelDrag(cx))
        .on_mouse_down_out((_e, cx) => this.cancelDrag(cx))
        .on_hover((inside, cx) => { if (!inside) this.cancelDrag(cx); })
        .children(list));
  }
}
