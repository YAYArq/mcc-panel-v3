// 单测：设置引号回环 / matches.ini 白名单回环 / TSL 正则匹配真实日志行
'use strict';
const assert = require('assert');
const mccMod = require('./lib/mcc-mod');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('PASS', name);
}

const TSL_REGEX = '\\[TSL\\] ([a-zA-Z0-9_\\u4e00-\\u9fa5]{1,16}) 请求(?:你传送到他的位置|传送到你的位置)';

// 真实 ini 片段（含旧英文正则，TOML 单引号字符串）
const INI = [
  '[Main.Advanced]',
  'BotOwners = [ "wu_xin__", "yayarq", ] # comment',
  '',
  '[ChatFormat]',
  'Builtins = true',
  "TeleportRequest = '(?s)([a-zA-Z0-9_]+) (invites you to teleport to them|wants to teleport to you)\\.'",
  '',
  '[ChatBot.RemoteControl]',
  'Enabled = true',
  'AutoTpaccept = true',
  'AutoTpaccept_Everyone = false',
  ''
].join('\n');

check('设置页：提取正则不带引号', () => {
  const parsed = mccMod.parseSettings(INI);
  const tp = parsed.groups.find((g) => g.id === 'tp');
  const regex = tp.items.find((i) => i.key === 'tp.regex');
  assert.ok(!regex.value.startsWith("'"), '值应无引号: ' + regex.value);
  assert.ok(regex.value.includes('invites you'), '内容应保留');
});

check('设置页：保存 TSL 正则写成 TOML 单引号合法行', () => {
  const out = mccMod.applySettings(INI, { 'tp.regex': TSL_REGEX });
  const m = /^[ \t]*TeleportRequest[ \t]*=[^\n]*/m.exec(out);
  assert.ok(m, '存在 TeleportRequest 行');
  assert.ok(m[0].trim().startsWith("TeleportRequest = '"), '应以单引号开头: ' + m[0]);
  assert.ok(!m[0].includes('"'), '不应出现双引号');
  // 再提取应还原干净值
  const parsed = mccMod.parseSettings(out);
  const tp = parsed.groups.find((g) => g.id === 'tp');
  const regex = tp.items.find((i) => i.key === 'tp.regex');
  assert.strictEqual(regex.value, TSL_REGEX);
});

check('设置页：BotOwners 白名单在 tp 分组且回环正确', () => {
  const parsed = mccMod.parseSettings(INI);
  const tp = parsed.groups.find((g) => g.id === 'tp');
  const bo = tp.items.find((i) => i.key === 'chat.botOwners');
  assert.ok(bo, 'tp 分组应含白名单项');
  assert.deepStrictEqual(bo.value.split('\n'), ['wu_xin__', 'yayarq']);
  const out = mccMod.applySettings(INI, { 'chat.botOwners': 'yayarq\nnewplayer\n' });
  const m = /^[ \t]*BotOwners[ \t]*=[^\n]*/m.exec(out);
  assert.ok(m && m[0].includes('"newplayer"'), '写回应含新玩家: ' + m[0]);
  const parsed2 = mccMod.parseSettings(out);
  const bo2 = parsed2.groups.find((g) => g.id === 'tp').items.find((i) => i.key === 'chat.botOwners');
  assert.deepStrictEqual(bo2.value.split('\n'), ['yayarq', 'newplayer']);
});

check('matches.ini：白名单复合正则命中真实服务器格式', () => {
  const txt = mccMod.buildMatchesIni([
    { trigger: '!home', action: 'send /home', cooldown: 5, enabled: true, whitelist: ['YAYArq', 'wu_xin__'] }
  ]);
  const m = /^match=(.+)$/m.exec(txt);
  assert.ok(m, '有 match 行');
  const re = new RegExp(m[1]);
  // 真实格式（含装饰前缀）
  assert.ok(re.test('▌『萌新新』YAYArq > !home'), 'TSL 格式');
  assert.ok(re.test('▌[%s] [ 萌新 ][烟雨江南绿玩会] wu_xin__: !home'), 'wuxin 冒号格式');
  assert.ok(re.test('<YAYArq> !home'), '英文 <玩家> 格式');
  // 非白名单不触发
  assert.ok(!re.test('▌『萌新新』Stranger > !home'), '陌生人不应触发');
  assert.ok(!re.test('▌『萌新新』XYAYArq > !home'), '名字包含关系不应触发');
});

check('matches.ini：白名单与触发词回环还原', () => {
  const cmds = [
    { trigger: '!home', action: 'send /home', cooldown: 5, enabled: true, whitelist: ['YAYArq', 'wu_xin__'] },
    { trigger: '你好', action: 'send 你好呀', cooldown: 0, enabled: false, whitelist: [] }
  ];
  const txt = mccMod.buildMatchesIni(cmds);
  const back = mccMod.parseMatchesIni(txt);
  assert.strictEqual(back.length, 2);
  assert.strictEqual(back[0].trigger, '!home', '触发词应还原为原始值');
  assert.deepStrictEqual(back[0].whitelist, ['YAYArq', 'wu_xin__']);
  assert.strictEqual(back[0].enabled, true);
  assert.strictEqual(back[1].trigger, '你好');
  assert.deepStrictEqual(back[1].whitelist, []);
  assert.strictEqual(back[1].enabled, false);
  // 再序列化应与首轮一致（幂等）
  assert.strictEqual(mccMod.buildMatchesIni(back), txt);
});

check('旧 matches.ini（无白名单注释）解析兼容', () => {
  const old = '[Match]\nmatch=!hello\naction=send hi\ncooldown=3\nenabled=true\n\n[Match]\nmatch=!bye\naction=send bye\nenabled=false\n';
  const back = mccMod.parseMatchesIni(old);
  assert.strictEqual(back.length, 2);
  assert.strictEqual(back[0].trigger, '!hello');
  assert.deepStrictEqual(back[0].whitelist, []);
  assert.strictEqual(back[1].enabled, false);
});

check('默认传送正则匹配 TSL 两种真实提示（含 ▌ 前缀）', () => {
  const re = new RegExp(mccMod.defaultTeleportRegex());
  assert.ok(re.test('▌[TSL] YAYArq 请求你传送到他的位置。(60 秒内有效) [接受] [拒绝]'));
  assert.ok(re.test('▌[TSL] YAYArq 请求传送到你的位置。(60 秒内有效) [接受] [拒绝]'));
  assert.ok(re.test('player1 wants to teleport to you.'));
  const m = re.exec('▌[TSL] YAYArq 请求你传送到他的位置。(60 秒内有效) [接受] [拒绝]');
  assert.strictEqual(m[1], 'YAYArq', '捕获组 1 应为请求者名字');
});

console.log('ALL', passed, 'TESTS PASSED');
