import assert from "node:assert/strict";
import test from "node:test";
import { exceedsDragThreshold, groupAgents, groupMoveApplied, hasNewAttention, machineSections, orderMachines, planGroupMove, rowPlacement, splitName, toggleGroupFold, trackAgentState } from "../mods/agent-groups/agentgroups.js";
import { orderMachines as orderSpaceMachines } from "../mods/space-groups/groups.js";

const space = (id, name, { machine = null, named = true } = {}) => ({ id, name, machine, named });
const agent = (address, s) => ({ address, space: s.id, space_name: s.name });
const index = (...spaces) => new Map(spaces.map((s) => [s.id, s]));
const addresses = (group) => group.members.map((a) => a.address);

test("Agents 将同一机器的同前缀空间合并，组和成员保持首次出现顺序", () => {
  const anki = space("s1", "学习·anki");
  const ops = space("s2", "运维·排障");
  const work = space("s3", " 学习 · 找工作");
  const study = space("s4", "学习·学习管理");
  const list = [
    agent("ops", ops), agent("anki", anki), agent("work", work),
    agent("ops2", ops), agent("study", study),
  ];
  const groups = groupAgents(list, index(anki, ops, work, study));
  assert.deepEqual(groups.map((g) => g.label), ["运维", "学习"]);
  assert.deepEqual(groups.map(addresses), [["ops", "ops2"], ["anki", "work", "study"]]);
});

test("Agents 为无前缀的同名空间分别分组，空间缺失时使用窗口标签", () => {
  const first = space("s1", "普通");
  const second = space("s2", "普通");
  const missing = space("s3", "缺失·窗口标签");
  const groups = groupAgents(
    [agent("one", first), agent("two", second), agent("three", missing), agent("four", first)],
    index(first, second),
  );
  assert.deepEqual(groups.map((g) => g.id), ["sp-s1", "sp-s2", "sp-s3"]);
  assert.deepEqual(groups.map((g) => g.label), ["普通", "普通", "缺失·窗口标签"]);
  assert.deepEqual(groups.map(addresses), [["one", "four"], ["two"], ["three"]]);
});

test("Agents 的自动命名空间即使含中点也单独成组", () => {
  const automatic = space("auto", "学习·anki", { named: false });
  const named = space("named", "学习·阅读");
  const groups = groupAgents([agent("auto", automatic), agent("named", named)], index(automatic, named));
  assert.deepEqual(groups.map((g) => g.label), ["学习·anki", "学习"]);
  assert.deepEqual(splitName(automatic), { group: null, label: "学习·anki" });
});

test("Agents 的同名前缀不跨机器合并", () => {
  const local = space("local", "学习·anki");
  const remote = space("remote/s1", "学习·anki", { machine: "remote" });
  const groups = groupAgents([agent("local", local), agent("remote/t1", remote)], index(local, remote));
  assert.deepEqual(groups.map((g) => g.id), ['prefix-[null,"学习"]', 'prefix-["remote","学习"]']);
  assert.deepEqual(groups.map(addresses), [["local"], ["remote/t1"]]);
});

test("Agents 短名只切掉第一段前缀，保留后续中点并去除外侧空格", () => {
  assert.deepEqual(splitName(space("id", "  学习  ·  外语·anki  ")), { group: "学习", label: "外语·anki" });
  const empty = space("empty", " · ");
  assert.deepEqual(splitName(empty), { group: "", label: "" });
  assert.equal(groupAgents([agent("t", empty)], index(empty))[0].label, "(empty group)");
});

test("折叠后变 done 或 blocked 时显示小点，子 Agent 也纳入判断", () => {
  const idle = trackAgentState(undefined, "idle", 10);
  const changed = {
    parent: trackAgentState(idle, "done", 30),
    child: trackAgentState(idle, "blocked", 35),
  };
  assert.equal(changed.parent.at, 10);
  assert.equal(changed.parent.statusAt, 30);
  assert.equal(hasNewAttention(["parent"], changed, 20), true);
  assert.equal(hasNewAttention(["child"], changed, 20), true);
  assert.equal(hasNewAttention(["other"], changed, 20), false);
});

test("折叠前和折叠时已有的状态、重复观测及 working 均不显示小点", () => {
  const done = trackAgentState(undefined, "done", 20);
  assert.equal(trackAgentState(done, "done", 100), done);
  assert.equal(hasNewAttention(["a"], { a: done }, 20), false);
  assert.equal(hasNewAttention(["a"], { a: done }, 25), false);
  const working = trackAgentState(done, "working", 30);
  assert.equal(hasNewAttention(["a"], { a: working }, 25), false);
  const idle = trackAgentState(done, "idle", 30);
  assert.equal(idle.at, 20);
  assert.equal(hasNewAttention(["a"], { a: idle }, 25), false);
});

test("打开会清除折叠时间，重折叠重新计时，JSON 读回保留新状态判断", () => {
  const key = "学习";
  const original = new Map();
  const folded = toggleGroupFold(original, key, 10);
  assert.equal(original.size, 0);
  const restored = new Map(JSON.parse(JSON.stringify([...folded])));
  const changed = { a: trackAgentState(undefined, "blocked", 15) };
  assert.equal(hasNewAttention(["a"], changed, restored.get(key)), true);
  const open = toggleGroupFold(restored, key, 20);
  assert.equal(open.has(key), false);
  assert.equal(hasNewAttention(["a"], changed, open.get(key)), false);
  const refold = toggleGroupFold(open, key, 25);
  assert.equal(refold.get(key), 25);
  assert.equal(hasNewAttention(["a"], changed, refold.get(key)), false);
});

const prefix = (label, machine = null) => `prefix-${JSON.stringify([machine, label])}`;

function replayGroupMove(spaces, plan, expectedIds) {
  const result = [...spaces];
  for (const args of plan.commands) {
    assert.deepEqual(Object.keys(args).sort(), ["id", "index"]);
    assert.ok(args.index >= 1 && args.index <= result.length);
    const from = result.findIndex((s) => s.id === args.id);
    assert.notEqual(from, -1);
    result.splice(args.index - 1, 0, result.splice(from, 1)[0]);
  }
  assert.deepEqual(result.map((s) => s.id), expectedIds);
  assert.equal(groupMoveApplied(result, plan.expected), true);
  assert.deepEqual(new Map(result.map((s) => [s.id, s.name])), new Map(spaces.map((s) => [s.id, s.name])));
  return result;
}

test("Agents 前缀组移到首组之前，同时移动没有 Agent 的同前缀空间", () => {
  const spaces = [space("b", "B·b"), space("a1", "A·active"), space("gap", "间隔"), space("a2", "A·no-agent")];
  const listed = [agent("b", spaces[0]), agent("a", spaces[1])];
  const [first, source] = groupAgents(listed, index(...spaces));
  const plan = planGroupMove(spaces, source.id, first.id, "before");
  assert.deepEqual(plan.commands, [{ id: "a1", index: 1 }, { id: "a2", index: 2 }]);
  const order = replayGroupMove(spaces, plan, ["a1", "a2", "b", "gap"]);
  const bySpace = new Map(listed.map((a) => [a.space, a]));
  const readback = groupAgents(order.map((s) => bySpace.get(s.id)).filter(Boolean), index(...order));
  assert.deepEqual(readback.map((g) => g.label), ["A", "B"]);
});

test("Agents 前缀组移到末组之后，以末组无 Agent 的成员作为锚点", () => {
  const host = "local-mac";
  const spaces = [
    space("local", "本机"), space("a1", "A·one", { machine: host }),
    space("b1", "B·with-agent", { machine: host }), space("a2", "A·two", { machine: host }),
    space("b2", "B·no-agent", { machine: host }), space("remote", "其他机器", { machine: "windows" }),
  ];
  const plan = planGroupMove(spaces, prefix("A", host), prefix("B", host), "after");
  assert.deepEqual(plan.commands, [{ id: "a2", index: 5 }, { id: "a1", index: 4 }]);
  assert.equal(plan.expected.anchor, "b2");
  const result = replayGroupMove(spaces, plan, ["local", "b1", "b2", "a1", "a2", "remote"]);
  assert.deepEqual(planGroupMove(result, prefix("A", host), prefix("B", host), "after").commands, []);
});

test("Agents 的无前缀单空间组可移动，自动名称和前缀组都保持原状", () => {
  const spots = [space("p", "A·auto", { named: false }), space("a1", "A·1"), space("a2", "A·2")];
  const plan = planGroupMove(spots, "sp-p", prefix("A"), "after");
  assert.deepEqual(plan.commands, [{ id: "p", index: 3 }]);
  const result = replayGroupMove(spots, plan, ["a1", "a2", "p"]);
  assert.equal(result[2].named, false);
});

test("Agents 跨机器、拖到自身或不可拖动的分区均没有移动计划", () => {
  const spots = [space("a", "A·a"), space("b", "A·b", { machine: "remote" })];
  assert.equal(planGroupMove(spots, prefix("A"), prefix("A", "remote"), "after"), null);
  assert.equal(planGroupMove(spots, prefix("A"), prefix("A"), "before"), null);
  assert.equal(planGroupMove(spots, "pinned", prefix("A"), "after"), null);
  assert.equal(planGroupMove(spots, prefix("A"), "sec-4", "before"), null);
});

test("Agents 拖动阈值和半区与 Spaces 一致", () => {
  const start = { x: 0, y: 0 };
  assert.equal(exceedsDragThreshold(start, { x: -4, y: 4 }), false);
  assert.equal(exceedsDragThreshold(start, { x: 0, y: 5 }), true);
  assert.equal(rowPlacement({ local_position: { y: 14 }, bounds: { height: 30 } }), "before");
  assert.equal(rowPlacement({ local_position: { y: 15 }, bounds: { height: 30 } }), "after");
  assert.equal(rowPlacement({}), undefined);
});

test("Agents 多机按 Spaces 的共享机器顺序分块，单机省略标题", () => {
  const local = space("s1","学习·本机");
  const remote = space("remote/s2","学习·远程",{machine:"remote"});
  const other = space("other/s3","普通");
  const groups = groupAgents([agent("local",local),agent("remote/t",remote),agent("other/t",other)], index(local,remote));
  const defaults = machineSections(groups);
  assert.deepEqual(defaults.map(s => s.title), ["other","remote","This computer"]);
  assert.deepEqual(machineSections(groups, ["remote","","other"]).map(s => s.machine), ["remote",null,"other"]);
  assert.deepEqual(machineSections(groups.slice(1), ["","remote"]).map(s => s.machine), ["other","remote"]);
  assert.equal(machineSections([groups[1]])[0].title,null);
  assert.equal(planGroupMove([local,remote],groups[0].id,groups[1].id,"after"),null);
  assert.deepEqual(orderMachines([null,"remote","other"], ["other",""]), orderSpaceMachines([null,"remote","other"], ["other",""]));
});
