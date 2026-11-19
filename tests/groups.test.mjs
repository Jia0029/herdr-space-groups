import assert from "node:assert/strict";
import test from "node:test";
import { dropApplied, exceedsDragThreshold, groupRows, nestWorktrees, planDrop, planEdgeDrop, releaseAction, rowPlacement, splitName } from "../mods/space-groups/groups.js";

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

const space = (id, name = id, machine = null, named = true) => ({ id, name, machine, named });
const one = (id) => ({ kind: "space", id });
const group = (name, machine = null) => ({ kind: "group", id: JSON.stringify([machine, name]) });
const move = (id, index) => ({ cmd: "space.move", args: { id, index } });
const rename = (id, name) => ({ cmd: "space.rename", args: { id, name } });

function applyDrop(spaces, plan, expectedIds) {
  const actual = spaces.map((entry) => ({ ...entry }));
  for (const { cmd, args } of plan.commands) {
    const from = actual.findIndex((space) => space.id === args.id);
    assert.notEqual(from, -1);
    if (cmd === "space.rename") {
      Object.assign(actual[from], { name: args.name, named: true });
    } else {
      assert.equal(cmd, "space.move");
      assert.ok(args.index >= 1 && args.index <= actual.length);
      actual.splice(args.index - 1, 0, actual.splice(from, 1)[0]);
    }
  }
  assert.deepEqual(actual.map((space) => space.id), expectedIds);
  assert.equal(dropApplied(actual, plan.expected), true);
  return actual;
}

test("拖到折叠组标题时，加入包含隐藏成员的组尾", () => {
  const spaces = [space("x"), space("a", "G·a"), space("gap"), space("b", "G·b"), space("end")];
  const plan = planDrop(spaces, one("x"), group("G"));
  assert.deepEqual(plan.commands, [rename("x", "G·x"), move("x", 4)]);
  applyDrop(spaces, plan, ["a", "gap", "b", "x", "end"]);
  assert.equal(spaces[0].name, "x");
});

test("同组成员拖到组标题时，排到其他成员之后", () => {
  const spaces = [space("a", "G·a"), space("b", "G·b")];
  const plan = planDrop(spaces, one("a"), group("G"));
  assert.deepEqual(plan.commands, [move("a", 2)]);
  applyDrop(spaces, plan, ["b", "a"]);
});

test("拖到他组成员时替换旧前缀，并遵循向前或向后的插入线", () => {
  const spaces = [space("a", "G·a·detail"), space("b", "H·b"), space("c", "G·c")];
  const down = planDrop(spaces, one("a"), one("b"));
  assert.equal(down.expected.after, true);
  assert.deepEqual(down.commands, [rename("a", "H·a·detail"), move("a", 2)]);
  applyDrop(spaces, down, ["b", "a", "c"]);
  const up = planDrop(spaces, one("c"), one("b"));
  assert.equal(up.expected.after, false);
  assert.deepEqual(up.commands, [rename("c", "H·c"), move("c", 2)]);
  applyDrop(spaces, up, ["a", "c", "b"]);
});

test("同组拖动只移动，保留原名空格", () => {
  const spaces = [space("a", " G · a "), space("b", "G·b")];
  const plan = planDrop(spaces, one("a"), one("b"));
  assert.deepEqual(plan.commands, [move("a", 2)]);
  applyDrop(spaces, plan, ["b", "a"]);
});

test("拖到未分组空间时去掉首个前缀，空显示名保留原名", () => {
  const spaces = [space("a", "G·a·detail"), space("b", "G· "), space("plain")];
  const plan = planDrop(spaces, one("a"), one("plain"));
  assert.deepEqual(plan.commands, [rename("a", "a·detail"), move("a", 3)]);
  applyDrop(spaces, plan, ["b", "plain", "a"]);
  const empty = planDrop(spaces, one("b"), one("plain"));
  assert.deepEqual(empty.commands, [move("b", 3)]);
  applyDrop(spaces, empty, ["a", "plain", "b"]);
});

test("整组向前移动只移动组成员，保留顺序并计入其他机器的索引", () => {
  const spaces = [space("remote", "remote", "other"), space("t"), space("x"), space("a1", "A·1"), space("y"), space("a2", "A·2")];
  const plan = planDrop(spaces, group("A"), one("t"));
  assert.equal(plan.expected.after, false);
  assert.deepEqual(plan.commands, [move("a1", 2), move("a2", 3)]);
  applyDrop(spaces, plan, ["remote", "a1", "a2", "t", "x", "y"]);
});

test("整组向后移动到另一组标题时，每个索引按上一次移动结果计算", () => {
  const spaces = [
    space("a1", "A·1"), space("x"), space("a2", "A·2"), space("y"),
    space("t1", "T·1"), space("t2", "T·2"), space("end"),
  ];
  const plan = planDrop(spaces, group("A"), group("T"));
  assert.equal(plan.expected.after, true);
  assert.deepEqual(plan.commands, [move("a2", 6), move("a1", 5)]);
  applyDrop(spaces, plan, ["x", "y", "t1", "t2", "a1", "a2", "end"]);
});

test("跨机器、整组拖到自身成员或自身标题均无操作", () => {
  const spaces = [space("a", "A·a"), space("b", "A·b"), space("remote", "A·c", "remote")];
  assert.equal(planDrop(spaces, one("a"), group("A", "remote")), null);
  assert.equal(planDrop(spaces, group("A", "remote"), one("b")), null);
  assert.equal(planDrop(spaces, group("A"), one("b")), null);
  assert.equal(planDrop(spaces, group("A"), group("A")), null);
});

test("未命名空间入组使用当前显示名，并变成已命名", () => {
  const spaces = [space("a", "A·a"), space("auto", "folder·child", null, false)];
  const plan = planDrop(spaces, one("auto"), group("A"));
  assert.deepEqual(plan.commands, [rename("auto", "A·folder·child")]);
  const actual = applyDrop(spaces, plan, ["a", "auto"]);
  assert.equal(actual[1].named, true);
  assert.equal(dropApplied(spaces, plan.expected), false);
});

test("回读必须同时确认位置、精确名称和已命名状态", () => {
  const spaces = [space("plain"), space("a", "A·a"), space("b", "A·b")];
  const plan = planDrop(spaces, one("plain"), group("A"));
  const actual = applyDrop(spaces, plan, ["a", "b", "plain"]);
  assert.equal(dropApplied([actual[2], actual[0], actual[1]], plan.expected), false);
  actual[2].named = false;
  assert.equal(dropApplied(actual, plan.expected), false);
  actual[2].named = true;
  actual[2].name = "A.plain";
  assert.equal(dropApplied(actual, plan.expected), false);
});

test("同一项按下松开时，1 至 3 像素的抖动仍视为点击", () => {
  for (const key of ["space-a", "group-A"]) {
    const drag = { key, start: { x: 10, y: 10 }, moved: false };
    for (const offset of [1, 2, 3]) {
      const position = { x: 10 - offset, y: 10 + offset };
      assert.equal(exceedsDragThreshold(drag.start, position), false);
      assert.equal(releaseAction(drag, key, position), "click");
    }
  }
});

test("超过阈值后回到原项，仍按点击处理", () => {
  const start = { x: 10, y: 10 };
  assert.equal(exceedsDragThreshold(start, { x: 10, y: 15 }), true);
  const drag = { key: "group-A", start, moved: true };
  assert.equal(releaseAction(drag, drag.key, start), "click");
  assert.equal(releaseAction(drag, drag.key, { x: 10, y: 16 }), "click");
});

test("在他项松开时，只有超过 4 像素才触发投放", () => {
  const drag = { key: "space-a", start: { x: 10, y: 10 }, moved: false };
  assert.equal(releaseAction(drag, "group-A", { x: 14, y: 6 }), null);
  assert.equal(releaseAction(drag, "group-A", { x: 5, y: 10 }), "drop");
  assert.equal(releaseAction({ ...drag, moved: true }, "group-A", { x: 10, y: 12 }), "drop");
});

test("全分组的机器可拖出空间到首尾，位置限于该机器块", () => {
  const host = "mac-mini";
  const spaces = [
    space("local"), space("a", "A·a", host), space("b", "B·b", host),
    space("c", "A·c", host), space("other", "other", "windows"),
  ];
  const top = planEdgeDrop(spaces, one("b"), { machine: host, edge: "top" });
  assert.deepEqual(top.commands, [rename("b", "b"), move("b", 2)]);
  applyDrop(spaces, top, ["local", "b", "a", "c", "other"]);
  const end = planEdgeDrop(spaces, one("b"), { machine: host, edge: "end" });
  assert.deepEqual(end.commands, [rename("b", "b"), move("b", 4)]);
  applyDrop(spaces, end, ["local", "a", "c", "b", "other"]);
});

test("上方的组移到末尾，成员保持原相对顺序", () => {
  const spaces = [space("a1", "A·1"), space("b", "B·b"), space("a2", "A·2"), space("c", "C·c")];
  const plan = planEdgeDrop(spaces, group("A"), { machine: null, edge: "end" });
  assert.deepEqual(plan.commands, [move("a2", 4), move("a1", 3)]);
  applyDrop(spaces, plan, ["b", "c", "a1", "a2"]);
});

test("下方的组移到首位，成员保持原相对顺序且不改名", () => {
  const spaces = [space("b", "B·b"), space("a1", "A·1"), space("c", "C·c"), space("a2", "A·2")];
  const plan = planEdgeDrop(spaces, group("A"), { machine: null, edge: "top" });
  assert.deepEqual(plan.commands, [move("a1", 1), move("a2", 2)]);
  applyDrop(spaces, plan, ["a1", "a2", "b", "c"]);
});

test("已在末尾且无需改名，无命令", () => {
  const spaces = [space("a"), space("b", "B·b"), space("c", "B·c"), space("last")];
  const end = { machine: null, edge: "end" };
  assert.deepEqual(planEdgeDrop(spaces, one("last"), end).commands, []);
  assert.deepEqual(planEdgeDrop(spaces.slice(0, -1), group("B"), end).commands, []);
  assert.deepEqual(planEdgeDrop(spaces.slice(1, 3), group("B"), end).commands, []);
  assert.deepEqual(planEdgeDrop(spaces.slice(0, -1), one("c"), end).commands, [rename("c", "c")]);
});

test("跨机器的首尾区域无效", () => {
  const spaces = [space("a", "A·a"), space("b", "A·b", "remote")];
  assert.equal(planEdgeDrop(spaces, one("a"), { machine: "remote", edge: "top" }), null);
  assert.equal(planEdgeDrop(spaces, group("A", "remote"), { machine: null, edge: "end" }), null);
});

test("机器标题使用与列表首位相同的投放计划，支持空间和整组", () => {
  const host = "mac-mini";
  const spaces = [space("a", "A·a", host), space("b", "B·b", host)];
  const heading = { kind: "edge", machine: host, edge: "top" };
  for (const source of [one("b"), group("B", host)]) {
    assert.deepEqual(planDrop(spaces, source, heading), planEdgeDrop(spaces, source, heading));
  }
});

test("未命名的空间去首尾时仍是自动命名，空显示名也不改名", () => {
  const spaces = [space("blank", "B· "), space("auto", "folder·child", null, false), space("other")];
  const top = planEdgeDrop(spaces, one("auto"), { machine: null, edge: "top" });
  assert.deepEqual(top.commands, [move("auto", 1)]);
  assert.equal(applyDrop(spaces, top, ["auto", "blank", "other"])[0].named, false);
  const end = planEdgeDrop(spaces, one("blank"), { machine: null, edge: "end" });
  assert.deepEqual(end.commands, [move("blank", 3)]);
  applyDrop(spaces, end, ["auto", "other", "blank"]);
});

test("回读要求源项位于机器块实际首尾，而不是只靠近原锚点", () => {
  const spaces = [space("a", "A·a"), space("b", "B·b")];
  const plan = planEdgeDrop(spaces, one("a"), { machine: null, edge: "end" });
  const actual = applyDrop(spaces, plan, ["b", "a"]);
  assert.equal(dropApplied([...actual, space("new")], plan.expected), false);
  assert.equal(dropApplied([...actual, space("remote", "remote", "windows")], plan.expected), true);
});

test("从上方拖到下方组首成员的上半区，改名并成为组内第一位", () => {
  const spaces = [space("a1", "A·a1"), space("a2", "A·a2"), space("b1", "B·b1"), space("b2", "B·b2")];
  const plan = planDrop(spaces, one("a1"), one("b1"), "before");
  assert.deepEqual(plan.commands, [rename("a1", "B·a1"), move("a1", 2)]);
  const actual = applyDrop(spaces, plan, ["a2", "a1", "b1", "b2"]);
  assert.deepEqual(ids(groupRows(actual.map((w) => ({ w })))[1].rows), ["a1", "b1", "b2"]);
});

test("从下方拖到上方组末成员的下半区，改名并成为组内最后一位", () => {
  const spaces = [space("a1", "A·a1"), space("a2", "A·a2"), space("b1", "B·b1"), space("b2", "B·b2")];
  const plan = planDrop(spaces, one("b2"), one("a2"), "after");
  assert.deepEqual(plan.commands, [rename("b2", "A·b2"), move("b2", 3)]);
  const actual = applyDrop(spaces, plan, ["a1", "a2", "b2", "b1"]);
  assert.deepEqual(ids(groupRows(actual.map((w) => ({ w })))[0].rows), ["a1", "a2", "b2"]);
});

test("同组空间按指定的 before 或 after 移动，保留名称", () => {
  const spaces = [space("a1", "A·a1"), space("a2", "A·a2"), space("a3", "A·a3")];
  const before = planDrop(spaces, one("a1"), one("a3"), "before");
  assert.deepEqual(before.commands, [move("a1", 2)]);
  applyDrop(spaces, before, ["a2", "a1", "a3"]);
  const after = planDrop(spaces, one("a3"), one("a1"), "after");
  assert.deepEqual(after.commands, [move("a3", 2)]);
  applyDrop(spaces, after, ["a1", "a3", "a2"]);
});

test("缺少 placement 时按原方向推断，组标题和机器首尾忽略 placement", () => {
  const spaces = [space("a1", "A·a1"), space("a2", "A·a2"), space("b1", "B·b1"), space("b2", "B·b2")];
  assert.deepEqual(planDrop(spaces, one("a1"), one("b1")).commands, [rename("a1", "B·a1"), move("a1", 3)]);
  assert.deepEqual(planDrop(spaces, one("b2"), one("a2")).commands, [rename("b2", "A·b2"), move("b2", 2)]);
  for (const source of [one("a1"), group("A")]) {
    for (const target of [group("B"), { kind: "edge", machine: null, edge: "end" }]) {
      assert.deepEqual(planDrop(spaces, source, target, "before"), planDrop(spaces, source, target));
    }
  }
});

test("目标行的中点属于下半区，缺少有效边界时交给方向规则", () => {
  const at = (y) => rowPlacement({ local_position: { y }, bounds: { height: 28 } });
  assert.equal(at(13.9), "before");
  assert.equal(at(14), "after");
  assert.equal(at(27), "after");
  assert.equal(rowPlacement({}), undefined);
  assert.equal(rowPlacement({ local_position: { y: 0 }, bounds: { height: 0 } }), undefined);
});
