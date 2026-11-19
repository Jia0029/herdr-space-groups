import assert from "node:assert/strict";
import test from "node:test";
import { groupRows, nestWorktrees, splitName } from "../mods/space-groups/groups.js";

function row(id, name, options = {}) {
  const { machine = null, named = true, g = null, status = null, active = false } = options;
  return { w: { id, name, machine, named, status, active }, g, tree: null };
}

const ids = (rows) => rows.map((r) => r.w.id);

test("有分隔符、无分隔符和未命名空间", () => {
  assert.deepEqual(splitName({ name: "学习·anki", named: true }), { group: "学习", label: "anki" });
  assert.deepEqual(splitName({ name: "普通空间", named: true }), { group: null, label: "普通空间" });
  assert.deepEqual(splitName({ name: "学习·目录", named: false }), { group: null, label: "学习·目录" });
});

test("只按第一个分隔符切开，去除两侧首尾空格", () => {
  assert.deepEqual(splitName({ name: "  学习  ·  外语·anki  ", named: true }), { group: "学习", label: "外语·anki" });
  assert.deepEqual(splitName({ name: " · ", named: true }), { group: "", label: "" });
});

test("组位于其第一个成员的位置，组内成员保持原顺序", () => {
  const entries = groupRows([
    row("plain1", "普通"),
    row("a1", "学习·anki"),
    row("plain2", "学习·自动名", { named: false }),
    row("b1", "项目·主线"),
    row("a2", " 学习 · 阅读"),
    row("b2", "项目·发布"),
  ]);
  assert.deepEqual(entries.map((e) => e.kind === "space" ? e.row.w.id : e.name), ["plain1", "学习", "plain2", "项目"]);
  assert.deepEqual(ids(entries[1].rows), ["a1", "a2"]);
  assert.deepEqual(ids(entries[3].rows), ["b1", "b2"]);
  assert.equal(entries[2].row.label, "学习·自动名");
});

test("各机器的同名前缀互不合并，状态和选中也分别计算", () => {
  const entries = groupRows([
    row("a", "学习·anki", { status: "working" }),
    row("b", "学习·阅读", { machine: "remote", active: true, status: "blocked" }),
    row("c", "学习·听力", { status: "done" }),
    row("d", "学习·写作", { machine: "remote" }),
  ]);
  assert.deepEqual(entries.map((e) => JSON.parse(e.key)), [[null, "学习"], ["remote", "学习"]]);
  assert.deepEqual(entries.map((e) => ids(e.rows)), [["a", "c"], ["b", "d"]]);
  assert.deepEqual(entries.map((e) => [e.status, e.active]), [["done", false], ["blocked", true]]);
});

test("折叠摘要遵循 blocked > done > working > idle > 无状态", () => {
  const statuses = ["idle", "working", "done", "blocked"];
  assert.equal(groupRows([row("plain", "G·plain")])[0].status, null);
  for (let i = 0; i < statuses.length; i++) {
    const members = statuses.slice(0, i + 1).map((status) => row(status, `G·${status}`, { status }));
    assert.equal(groupRows(members)[0].status, statuses[i]);
  }
});

test("同组 worktree 在第一条主仓库下嵌套，保留组首位置和子项顺序", () => {
  const main = { repo: "repo", linked: false };
  const linked = { repo: "repo", linked: true };
  const entries = groupRows([
    row("child1", "工作·feature·a", { g: linked, active: true }),
    row("plain", "笔记"),
    row("main", "工作·repo", { g: main }),
    row("other", "工作·其他"),
    row("child2", "工作·feature-b", { g: linked }),
    row("main2", "工作·repo2", { g: main }),
    row("outside", "别组·feature-c", { g: linked }),
    row("unprefixed", "feature-d", { g: linked }),
  ]);
  assert.deepEqual(entries.map((e) => e.kind === "group" ? e.name : e.row.w.id), ["工作", "plain", "别组", "unprefixed"]);
  assert.deepEqual(ids(entries[0].rows), ["main", "child1", "child2", "other", "main2"]);
  assert.deepEqual(entries[0].rows.map((r) => r.tree), [null, "├─", "└─", null, null]);
  assert.equal(entries[0].rows[1].label, "feature·a");
  assert.equal(entries[0].active, true);
  assert.equal(entries[2].rows[0].tree, null);
  assert.equal(entries[3].row.tree, null);
});

test("未分组 worktree 继续使用原版主仓库排序", () => {
  const rows = [
    row("child", "feature", { g: { repo: "repo", linked: true } }),
    row("other", "笔记"),
    row("main", "repo", { g: { repo: "repo", linked: false } }),
  ];
  const ordered = nestWorktrees(rows);
  assert.deepEqual(ids(ordered), ["other", "main", "child"]);
  assert.equal(groupRows(ordered)[2].row.tree, "└─");
});
