// prune 功能单测：直接构造 HealthTracker 数据，验证 pruneStale 逻辑。
// 保存操作被拦截（stub this.save），不污染仓库 data 目录。
'use strict';
const assert = require('assert');
const { HealthTracker, keyOf } = require('./lib/health');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('PASS', name);
}

// 准备：两个节点，各若干实例；其中包含已删除实例与「查询失败需保留」节点
function makeTracker() {
  const t = new HealthTracker();
  t.data.instances = {};
  const add = (daemonId, uuid, status) => {
    t.data.instances[keyOf(daemonId, uuid)] = { daemonId, uuid, status, onlineSeconds: 1 };
  };
  // daemon A（实时仅剩 a1, a2；a3 已删除）
  add('A', 'a1', '3');
  add('A', 'a2', '0');
  add('A', 'a3', '0');
  // daemon B（实例列表查询失败，应整体保留）
  add('B', 'b1', '3');
  add('B', 'b2', '0');
  // daemon C（节点已从 MCSM 移除，其条目应被清理）
  add('C', 'c1', '0');
  t.save = () => { t.saved = true; }; // 拦截持久化
  return t;
}

check('清理已删除实例 + 保留查询失败节点 + 清理已移除节点', () => {
  const t = makeTracker();
  const live = new Set([keyOf('A', 'a1'), keyOf('A', 'a2')]);
  const removed = t.pruneStale(live, ['B']);
  assert.deepStrictEqual(removed.sort(), [keyOf('A', 'a3'), keyOf('C', 'c1')].sort());
  const keys = Object.keys(t.data.instances).sort();
  assert.deepStrictEqual(keys, [keyOf('A', 'a1'), keyOf('A', 'a2'), keyOf('B', 'b1'), keyOf('B', 'b2')].sort());
  assert.strictEqual(t.saved, true);
});

check('无残留时返回空数组且不保存', () => {
  const t = makeTracker();
  const live = new Set(['A', 'B', 'C'].flatMap((d, i) => [keyOf(d, d.toLowerCase() + (i + 1))]));
  // 构造 live 包含全部现有键
  const liveAll = new Set(Object.keys(t.data.instances));
  const removed = t.pruneStale(liveAll, []);
  assert.deepStrictEqual(removed, []);
  assert.strictEqual(t.saved, undefined);
});

check('空 liveKeys 且无保留节点时全部清空（等价于手动 reset 但保留 statsByDay）', () => {
  const t = makeTracker();
  t.data.statsByDay = { '2026-08-15': { messages: 5, commands: 0 } };
  const removed = t.pruneStale(new Set(), []);
  assert.strictEqual(removed.length, 6);
  assert.deepStrictEqual(t.data.instances, {});
  assert.deepStrictEqual(Object.keys(t.data.statsByDay), ['2026-08-15']); // 统计历史不受影响
});

check('liveKeys 支持数组传入', () => {
  const t = makeTracker();
  const removed = t.pruneStale([keyOf('A', 'a1')], []);
  assert.ok(removed.includes(keyOf('A', 'a2')));
  assert.ok(removed.includes(keyOf('B', 'b1')));
});

console.log('ALL', passed, 'UNIT TESTS PASSED');
