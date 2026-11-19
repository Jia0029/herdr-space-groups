import assert from "node:assert/strict";
import test from "node:test";
import { groupAgents, hasNewAttention, splitName, toggleGroupFold, trackAgentState } from "../mods/agent-groups/agentgroups.js";

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
