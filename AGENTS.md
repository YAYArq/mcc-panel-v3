# AGENTS.md — mcc-panel-v3 交接文档

> 本文件供后续开发（无论哪个 harness / 开发者）快速接手项目。改代码前请先读本文件与 README.md。

## 项目一句话

通过 **MCSManager (MCSM)** 控制 **MCC (Minecraft Console Client)** bot 实例的零依赖网页面板（Node.js 原生模块，无 npm 依赖），v3 版在 v2 基础上**只加不减**地叠加了健康监控、自动化、MCC 魔改、权限分级、IP 白名单。

仓库：`YAYArq/mcc-panel-v3`（v2 历史在 `YAYArq/mcc-panel-v2`）。生产环境：`/opt/mcc-panel` + systemd `mcc-panel.service`，Node v20。

## 硬性约束（必须遵守）

1. **零第三方依赖**：只能用 `fs/http/https/crypto/path/child_process` 等 Node 原生模块，禁止引入 npm 包。
2. **apikey 永不出后端**：MCSM apikey 只在 `panel.config.json` 与 `lib/mcsm-client.js`，前端所有请求经后端代理。
3. **只加不减**：v2 的 API 路径与前端交互保持不变；新功能一律用 `/api/v3/*` 新路径。
4. **持久化用 JSON**：数据存 `data/*.json`（含 JSONL），不引入数据库。
5. **前端原生 JS**：无框架，风格与现有 UI 一致（深色/浅色主题变量 `--bg/--accent/...`，主题 key `yayabot_theme`）。
6. **注释用中文**。

## 目录结构与职责

```
server.js            # 原生 http 服务器：静态文件 + 会话(带 role) + IP白名单 + v2代理 + v3路由挂载 + 引擎启动
lib/config.js        # 配置加载（v3 / ipWhitelist / trustProxy / users[].role）
lib/mcsm-client.js   # MCSM API 客户端（自动附加 apikey、请求头、超时）
lib/store.js         # data/*.json 持久化：原子写(tmp+rename)、JSONL 追加/截断
lib/cron.js          # 标准 5 字段 cron：parse/matches/describe/nextRun（AND 语义、本地时区）
lib/health.js        # 实例健康监控 + 消息统计（HealthTracker，MCSM 状态码 3=运行中）
lib/automation.js    # AutomationEngine：定时任务(cron)、掉线检测(reco→重启)、防AFK、自启组
lib/avatar.js        # 正版头像服务：Mojang 用户名->UUID->皮肤URL->PNG 代理（两级缓存+失败冷却）
lib/mcc-mod.js       # MCC 魔改纯函数：matches.ini/servers.txt 生成解析、INI 段注入、脚本模板、可视化设置(parseSettings/applySettings)
lib/v3-routes.js     # 全部 /api/v3/* 路由（handleV3Route(ctx)，未匹配返回 null）
public/index.html    # 页面结构（左侧竖排导航 sidebar + Hero 大标题区 + 主区 main-area + 拼贴实例网格 + v3 面板 + 抽屉/模态）
public/app.js        # v2 交互 + v3 视图切换(enterV3View/exitV3View) + 角色同步(need-admin 隐藏)
public/api.js        # 前端 API 封装（含 v3Get/v3Post/v3Put/v3Delete）
public/v3.css        # v3 面板样式（复用主题变量）
public/v3.js         # v3 面板全部交互（自包含，挂 MccPanel.v3，app.js 调 onShown/setUser）
install.sh           # 一键安装（升级场景保留已有 panel.config.json；创建 data/）
data/                # 运行时数据（gitignore）：health.json / schedules.json / automation.json / logs.jsonl
```

## 已实现功能总览（v3 目标三大块全部落地）

### 1. 面板增强
- **实例健康监控**：在线时长（当前/累计/最长）、重启次数、掉线次数、消息统计（今日/累计/近30天柱状图）。数据由引擎每 `v3.healthPollIntervalMs`(默认15s) 轮询所有节点实例+日志增量采集。
- **实例配置批量导入导出(JSON)**：`/api/v3/instances/export?includeIni=true`（含 ini 时解析出 serverIp/serverPort/accountType/accountLogin）、`/api/v3/instances/import`（逐条复用 v2 createMcsmInstance 创建）。
- **实例克隆**：`/api/v3/instance/clone`（复制源配置+全部文件，替换 cwd 为新名）。
- **操作日志筛选/导出**：`/api/v3/operation-logs?user=&action=&from=&to=&limit=`、`/api/v3/operation-logs/export?format=csv|json`；日志已持久化到 `data/logs.jsonl`（保留 10000 条）。
- **权限分级**：`config.users[].role` = `admin` | `readonly`（缺省 admin；单口令模式=admin）。readonly 对任何非 GET 请求 403（v2/v3 统一拦截），前端隐藏 `.need-admin` 按钮。
- **IP 白名单**：`ipWhitelistEnabled` + `ipWhitelist` + `trustProxy`（反代取 X-Forwarded-For），服务器级拦截（含静态资源/healthz）。

### 2. 自动化
- **定时任务**：`/api/v3/schedules` CRUD，cron 5 字段（AND 语义），动作类型 start/stop/restart/command；每 30s 检查一次分钟边界，`lastRunMinute` 防重复；含运行历史(20条)与错误记录。
- **掉线检测自动重连**：`/api/v3/automation` 配置（enabled/keywords/strategy/maxRecoFailures/cooldownMs/enabledInstances）。命中关键词后默认**先发 `/reco`，连续失败 maxRecoFailures 次后自动重启实例**（strategy=restart 则直接重启）；冷却防循环；自动动作记入操作日志（user=`auto`）。
- **防 AFK**：面板级兜底，周期性向实例发送自定义命令（间隔/命令可配）。
- **开机自启组**：`/api/v3/autostart-groups` CRUD + `/trigger` 手动触发；面板启动后按组错峰启动（startDelayMs + 实例间 instanceDelayMs），运行中实例自动跳过。

### 3. MCC 客户端魔改（全部配置/脚本实现，不改 C# 源码）
- **可视化设置（手机设置风格）**：`/api/v3/mcc/settings` GET/PUT，按分组（账号与服务器/聊天与显示/传送请求/自动化/日志）读写 MinecraftClient.ini 常用项，只替换被修改键（lib/mcc-mod.js 的 setKey/parseSettings/applySettings，纯函数）。新版 MCC 段名：[ChatBot.AntiAFK] / [ChatBot.AutoRelog]（内嵌 Kick_Messages 列表）/ [ChatBot.RemoteControl] / [ChatFormat]；聊天类键在新版模板位于 Main.Advanced（旧版 Main.General，defs 双段 fallback）。
- **自定义聊天指令**：`/api/v3/mcc/commands`（GET 读/PUT 写 matches.ini）。指令 = AutoRespond 规则（trigger → action，如 `!home` → `send /home`），保存实时生效。
- **多服务器切换**：`/api/v3/mcc/servers`（servers.txt 管理）+ `/api/v3/mcc/switch-server`（更新 servers.txt + 改写 ini 的 `Server` 行 + 运行中发 `connect <别名>` 即时切换）。
- **传送请求（tpa）**：创建实例 body 可带 tpaRegex（默认 `mccMod.defaultTeleportRegex()`，兼容中英文插件提示）；写入 ChatFormat.TeleportRequest + RemoteControl.AutoTpaccept + matches.ini 兜底。设置页 `tp.regex` 可随时改。
- **原生功能一键注入**：`/api/v3/mcc/apply-mod`（AntiAFK / AutoRelog / ScriptScheduler 段注入到 MinecraftClient.ini，需重启实例生效）。
- **挂机脚本模板**：`/api/v3/mcc/templates` + `/api/v3/mcc/scripts`（生成 idle.txt / tasks.txt 到实例目录）。

### 前端交互要点（单页滚动章节布局）
- **布局结构（作品集式单页滚动）**：`<aside class="sidebar">` 左侧窄图标栏（76px hover 展开，编号锚点 01-05）+ `<div class="main-area">` 单页滚动容器，内容为编号章节：`#sec-hero`（全屏 Hero，YAYA/BOT PANEL 超大 mono 标题 clamp(56px,9vw,118px) + SCROLL 提示）、`#sec-instances`（01 实例：横向大行列表 inst-row + 批量 toolbar）、`#sec-overview`（02 数据）、`#sec-automation`（03 自动化）、`#sec-transfer`（04 导入导出）、`#sec-oplog`（05 操作日志，v3-view 包裹 02-05）。**不再有实例/增强 tab 切换**：侧栏按钮为锚点滚动（app.js scrollIntoView + IntersectionObserver 章节高亮），v3 面板全部同时可见（enterApp 时 v3.onShown 全量加载所有面板数据）。实例渲染为 inst-row 横向行（app.js renderCard，保留 instance-card 类与全部内部类）。
- **MCC 魔改已移入实例抽屉「魔改」tab**（index.html #tab-mod），v3.js 用 `modTarget()` 取目标实例（app.js 打开抽屉时调 `MccPanel.v3.setDrawerInstance`，切 tab 调 `loadDrawerMod`）；增强页不再有魔改 tab。
- 日志抽屉有 `log-filter`（全部/聊天/系统）chips。分类规则（app.js isChatLine，按生产真实格式）：`▌『频道』玩家 > 消息` / `<玩家> 消息` / 含中文行 = 聊天（游戏内消息）；`[MCC]` 开头、ASCII 画框、纯英文行 = 系统（MCC 命令提示与反馈）。
- 配置 tab 含 settings-groups 可视化面板（分组可折叠）+ 原表单 + JSON 编辑（功能并存）。
- **正版头像**：GET /api/avatar/<name>（lib/avatar.js 代理 Mojang），前端 fetchSkinFace 用 canvas 裁 40x40（脸部 (8,8)8x8 + 帽子层 (40,8)），localStorage 缓存 30 天；离线账号 fallback 占位。
- **背包图标**：assets/items/<物品id>.png（生产从 MC jar 提取 1600+ 贴图，本地 gitignore），前端 img 404 时隐藏露出文字名（app.js makeInvSlot）。
- **用户注册与权限分级**：GET/POST/PUT/DELETE /api/v3/users；「最早 admin」= config.users[0]（单口令模式=任何登录者），仅 owner 可注册；注册用户存 data/users.json（密码 sha256+盐），登录校验在 server.js verifyLogin 合并两源。角色三档：admin / user（普通用户）/ readonly。**user 角色实例级授权**：server.js 拦截层对 user 的实例级接口（/api/instance*、/api/files*、/api/v3/mcc/*）逐请求校验 body/query 的 daemonId+uuid 是否在授权清单（userCanAccessInstance）；全局管理接口（users/schedules/automation/autostart-groups/import/export/operation-logs/template/instance create-delete/clone）对 user 一律 403；GET /api/instances 与 /api/v3/health、/api/v3/overview 按授权过滤（v3-routes userAccessSet）。前端：v3.js setUser 给 body 挂 role-user class，v3.css 据此隐藏工具栏/操作日志/增强页管理tab/删除按钮；用户界面仅 admin 可见（注册表单仅 owner），授权配置走 grant 模态（勾选实例 → PUT users）。注意 issueSession 必须保留三档角色（曾归一成 admin 导致 user 权限失效）。
- **全站无 emoji**（用户要求去除），操作日志「发送命令/实例操作」后端附实例名（server.js getInstanceName + instanceNameCache，缓存 10 分钟）。

## API 约定

- 统一响应：`{ ok, status, data, error }`（与 v2 一致）；v3 写操作需 admin。
- 文件读写辅助（v3-routes 内）：`readFile` = `PUT /api/files/`（不带 text）；`writeFile` = PUT 失败时先 touch 再写。
- 实例键：`daemonId::uuid`。
- 状态码（MCSM）：`3`=运行中、`0`=已停止、`1`=停止中、`2`=启动中、`-1`=忙碌。

## 配置项（panel.config.json）

```json
{
  "host": "0.0.0.0", "port": 18082, "title": "...",
  "authToken": "", "users": [{ "username": "admin", "password": "...", "role": "admin" }],
  "mcsm": { "url": "http://...:23333", "apikey": "...", "timeoutMs": 15000, "daemonContainer": "" },
  "logPollIntervalMs": 2000, "listPollIntervalMs": 4000,
  "v3": { "enabled": true, "healthPollIntervalMs": 15000 },
  "ipWhitelistEnabled": false, "ipWhitelist": [], "trustProxy": false
}
```

## 验证方式（重要）

- 语法：`node --check <file>`（注意：注释中不要出现 `*/` 序列，会提前闭合块注释）。
- 单测：直接 `require` 模块 + fake mcsm 对象（参考 lib 各模块自测思路）；cron 用 `new Date(...)` 固定时间测 matches/nextRun。
- 端到端：写一个 fake MCSM HTTP 服务（原生 http，模拟 `/api/service/remote_services_list`、`/api/protected_instance/outputlog` 等）指向面板测试配置，可全量回归 v2+v3 接口。
- 生产冒烟：`curl /healthz`、登录后 `GET /api/v3/overview`（应返回真实实例数与健康数据）。

## 已知注意事项

- 引擎 tick 有重入保护；MCSM 不可用时只记录日志不崩溃（容错）。
- 掉线检测/防AFK 默认**关闭**，需在 v3 面板「自动化」开启。
- 消息统计为近似值（日志行含 `<玩家>` 即计一条消息）。
- 生产数据目录 `data/` 已 gitignore，勿提交；`panel.config.json` 含真实密钥，勿提交/勿外泄。
- 部署升级 = 覆盖 `server.js`/`lib/`/`public/`/`package.json`/`README.md`/`install.sh`，保留 `panel.config.json`/`templates/`/`data/`，`systemctl restart mcc-panel`。
