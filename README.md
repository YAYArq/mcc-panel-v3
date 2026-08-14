# MCC-panel-v3
依旧写点史
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D16-brightgreen.svg)](package.json)

一个通过 **MCSManager (MCSM)** 控制 **MCC (Minecraft Console Client)** bot 实例的网页面板，可部署在服务器上。UI 风格与交互设计参考并感谢 [APRme/MULTIBOT_PANEL](https://github.com/APRme/MULTIBOT_PANEL)，UI 风格融合明日方舟 × 女神异闻录 3/4。

**v3 增强版**：在 v2 全部功能之上，叠加了实例健康监控、自动化（定时任务/掉线自动重连/防 AFK/开机自启组）、MCC 客户端"魔改"（自定义聊天指令/多服务器切换/原生功能注入）、批量导入导出与克隆、操作日志筛选导出、权限分级与 IP 白名单。

**零第三方依赖**：只需 Node.js（≥16），无需 `npm install`。

## 功能

### v2 基础功能（全部保留）

- 实例列表与实时状态（运行中 / 启动中 / 停止中 / 已停止 / 忙碌），按 MCSM 远程节点(daemon)切换
- 启动 / 停止 / 重启 / 强杀（单实例与批量操作）、名称搜索、多选批量控制
- 实例详情抽屉：**日志**（实时轮询/暂停/自动滚动）、**命令**（历史+快捷命令）、**配置**（表单+JSON）、**文件**（浏览/编辑/复制/粘贴/重命名/删除）、**背包**（解析渲染/丢弃/InventoryHandling 开关）、**脚本**（新建/编辑/运行）
- 节点文件管理器、内置 MCC 模板管理（上传/删除/从容器初始化）、操作日志审计
- 深色/日间主题、UUID 头像、healthz

### v3 增强功能（顶栏「🚀 增强」主页标签页进入，不单独开视图）

1. **实例健康监控面板**：在线时长（当前/累计/最长）、重启次数、掉线次数、消息统计（今日/累计/近 30 天柱状图），列表显示实例名
2. **自动化**：
   - **定时任务**（cron 风格，5 字段）：定时重启 / 停止 / 启动 / 发送命令或聊天消息；含运行历史与失败提示
   - **掉线检测自动重连**：轮询实例日志，命中关键词后默认**先发送 `/reco` 重连，连续失败 N 次自动重启实例**（可切换为直接重启；带冷却时间防循环）
   - **防 AFK**：面板级周期性发送自定义命令（可配合 MCC 原生 AntiAFK 使用）
   - **开机自启组**：面板启动后按组错峰启动实例（组内实例间隔可调），支持手动触发
3. **MCC 客户端"魔改"**（已移入实例抽屉「魔改」tab，针对当前实例直接操作，无需全局页选实例）：
   - **可视化设置（手机设置风格）**：实例配置 tab 内按分组（账号与服务器/聊天与显示/传送请求/自动化/日志）用开关与输入框直接编辑 MinecraftClient.ini 常用项，同时保留原有表单与 JSON 编辑；参考 MCC 官方配置说明（新版段名 [ChatBot.AntiAFK]/[ChatBot.AutoRelog]/[ChatBot.RemoteControl]）
   - **自定义聊天指令**：编辑 matches.ini（AutoRespond），如聊天出现 `!home` 自动执行 `send /home`
   - **多服务器切换**：管理 servers.txt 服务器列表，一键切换（运行中即时 `connect`，未运行则改配置下次启动生效）
   - **传送请求（tpa）**：创建实例与设置页均可配置 tpa 触发正则（按服务器插件提示文本修改），自动写入 MCC 原生 RemoteControl.AutoTpaccept + ChatFormat.TeleportRequest + matches.ini 兜底
   - **原生功能注入**：AntiAFK（防挂机）、AutoRelog（MCC 原生掉线自动重连）、ScriptScheduler（脚本调度，含 tasks.txt 模板）
   - **挂机脚本模板**：一键生成 idle.txt / tasks.txt 到实例目录
4. **实例配置批量导入导出（JSON）**：导出全部节点实例（可选含 ini），粘贴 JSON 批量创建；**实例克隆**（复制配置+文件）；删除实例自动先停后删（MCSM 10 要求已停止实例才可删除）
5. **日志拆分**：实例日志抽屉支持「全部 / 聊天 / 系统」过滤——聊天页只显示游戏内消息（玩家发言/服务器事件），系统页只显示 MCC 命令提示与反馈（按生产真实日志格式分类，适配中文服务器插件 `▌『频道』玩家 > 消息` 格式）
6. **操作日志筛选/导出**：按用户 / 操作 / 时间范围筛选，导出 CSV / JSON（日志已持久化到 `data/logs.jsonl`，保留 10000 条）；发送命令/实例操作记录显示实例名
7. **正版头像**：实例卡片显示正版玩家皮肤头像（后端代理 Mojang API + 前端 canvas 裁脸，绕过浏览器 CSP 对外部头像源的拦截；离线账号显示占位）
8. **背包游戏图标**：背包格子显示原版物品贴图（从 MC 客户端 jar 提取到 `public/assets/items/`，共 1600+ 物品；无图标的物品自动回退显示文字名）
9. **用户注册**：顶栏「用户」入口（仅最早的 admin 用户可见）——`config.users[0]` 是初始管理员，只有它可以注册其他用户（admin/readonly 角色）；注册用户存 `data/users.json`（密码 sha256+盐 哈希），重启面板后依然有效
10. **权限分级**：`config.users[].role` 支持 `admin` / `readonly`；只读用户仅可查看（前端隐藏写按钮 + 后端 403 双重拦截）
11. **IP 白名单**：`ipWhitelistEnabled` + `ipWhitelist`，非白名单 IP 一律 403（含静态资源与 healthz）；反向代理场景用 `trustProxy` 读取 X-Forwarded-For
12. **手机端优化**：响应式布局与触控友好的设置开关；全站无 emoji 装饰、粒子特效已移除（性能）

## 目录结构

```
mcc-panel/
├── server.js            # 零依赖 Node 服务器：静态文件 + 会话 + MCSM API 代理 + v3 路由挂载
├── install.sh           # Ubuntu/Debian 一键安装脚本（含 systemd、升级保留配置）
├── lib/
│   ├── config.js        # 配置加载（含 v3 / IP 白名单配置项）
│   ├── mcsm-client.js   # MCSM API 客户端（自动附加 apikey 与请求头）
│   ├── store.js         # v3 数据持久化（data/*.json 原子写、JSONL 日志）
│   ├── cron.js          # v3 标准 5 字段 cron 解析/匹配
│   ├── health.js        # v3 实例健康监控与消息统计
│   ├── automation.js    # v3 自动化引擎（定时任务/掉线检测/防AFK/自启组）
│   ├── mcc-mod.js       # v3 MCC 魔改配置生成与解析（matches.ini/servers.txt/段注入）
│   └── v3-routes.js     # v3 API 路由（/api/v3/*）
├── data/                # v3 数据目录（自动创建）：health.json / schedules.json / automation.json / logs.jsonl
├── public/
│   ├── index.html       # 页面结构（含 v3 增强面板）
│   ├── app.css          # 样式（深色主题）
│   ├── api.js           # 前端 API 封装（含 v3 API）
│   ├── app.js           # 前端交互逻辑（含 v3 视图切换与权限）
│   ├── v3.css           # v3 面板样式
│   └── v3.js            # v3 面板交互逻辑
├── panel.config.json    # 配置文件（含真实密钥，已被 .gitignore 排除，提交的是占位符）
├── LICENSE              # MIT 许可证
└── package.json
```

## 快速开始

### 一键安装（Ubuntu / Debian + systemd）

```bash
sudo bash install.sh
```

交互式填写 MCSM 地址、API Key、端口、访问口令即可；脚本会自动安装 Node.js、生成配置、注册 systemd 服务并启动。也支持环境变量非交互安装：

```bash
MCSM_URL=http://1.2.3.4:23333 \
MCSM_APIKEY=你的apikey \
PANEL_PORT=18082 \
PANEL_AUTH_TOKEN=你的口令 \
INSTALL_DIR=/opt/mcc-panel \
sudo -E bash install.sh
```

> **v2 → v3 升级**：直接覆盖代码即可（`server.js`、`lib/`、`public/`、`package.json`、`README.md`）。
> `panel.config.json`、`templates/`、`data/` 会被保留，升级无需重配；重启服务即生效：
> ```bash
> sudo systemctl restart mcc-panel
> ```
> 新版首次启动会自动创建 `data/` 目录并开始采集健康数据（默认 15 秒轮询一次）。

### 手动启动

1. 编辑 `panel.config.json`：

```json
{
  "host": "0.0.0.0",
  "port": 18082,
  "title": "MCC Bot Panel",
  "authToken": "设置一个强口令",
  "mcsm": {
    "url": "http://127.0.0.1:23333",
    "apikey": "MCSM 面板里生成的 API Key"
  },
  "v3": { "enabled": true, "healthPollIntervalMs": 15000 },
  "ipWhitelistEnabled": false,
  "ipWhitelist": []
}
```

2. 启动：

```bash
node server.js
# 或指定配置文件路径
node server.js /path/to/panel.config.json
```

3. 浏览器打开 `http://<服务器地址>:18082`，输入访问口令即可。点顶栏「🚀 v3 增强」进入 v3 面板。

> `apikey` 获取方式：MCSM 面板 → 右上角头像 → 「API Key」生成。管理员账号的 apikey 拥有完整权限，请勿泄露，只写入后端配置文件。
>
> 注意：**配置编辑**（修改 `startCommand` 等）走 MCSM 的 `PUT /api/instance` 接口，需要**管理员**权限的 apikey；仅启停/命令/日志/文件等操作普通账号也可用。

## 配置项

| 字段 | 说明 |
| --- | --- |
| `host` | 监听地址，`0.0.0.0` 表示对外可访问 |
| `port` | 监听端口 |
| `title` | 面板标题 |
| `authToken` | 访问口令；留空则**不启用认证（不安全）** |
| `users` | 多用户列表，`[{ "username": "...", "password": "...", "role": "admin" \| "readonly" }]`；缺省 role 视为 admin |
| `mcsm.url` | MCSM 面板地址（不带尾部 `/`） |
| `mcsm.apikey` | MCSM API Key |
| `mcsm.timeoutMs` | 请求 MCSM 的超时（毫秒） |
| `mcsm.daemonContainer` | 本机 daemon 的 docker 容器名（创建实例时 docker cp 模板用） |
| `logPollIntervalMs` | 日志轮询间隔 |
| `listPollIntervalMs` | 实例列表刷新间隔 |
| `v3.enabled` | v3 自动化引擎总开关（默认 `true`；关闭后不轮询健康/掉线/防AFK，但定时任务与 API 仍可用） |
| `v3.healthPollIntervalMs` | 健康/掉线检测轮询间隔（默认 `15000` 毫秒，可调大降低 MCSM 请求压力） |
| `ipWhitelistEnabled` | 启用 IP 白名单（默认 `false`） |
| `ipWhitelist` | 允许访问的 IP 数组，如 `["127.0.0.1", "1.2.3.4"]`；启用但为空 = 拒绝所有 |
| `trustProxy` | 面板位于反向代理后时置 `true`（取 X-Forwarded-For 首个 IP 做白名单判断） |

## 定时任务 cron 语法

5 字段，空格分隔，**AND 语义**（所有字段同时满足才触发），使用服务器本地时间：

```
┌──────────── 分 (0-59)
│ ┌────────── 时 (0-23)
│ │ ┌──────── 日 (1-31)
│ │ │ ┌────── 月 (1-12)
│ │ │ │ ┌──── 周 (0-7，0 与 7 均为周日)
│ │ │ │ │
* * * * *
```

字段支持 `*`、`*/n`、`a-b`、`a,b`、`a-b/n`。示例：

| cron | 含义 |
| --- | --- |
| `0 3 * * *` | 每天 03:00 |
| `*/30 * * * *` | 每 30 分钟 |
| `0 9 * * 1-5` | 工作日 09:00 |
| `30 4 * * 0` | 每周日 04:30 |

## v3 API 清单（`/api/v3/*`，均为面板后端代理，apikey 不出后端）

| 方法与路径 | 说明 | 权限 |
| --- | --- | --- |
| `GET /api/v3/me` | 当前用户与角色（含 isOwner：是否为最早 admin） | 登录即可 |
| `GET /api/v3/users` | 用户列表（配置用户 + 注册用户，不含密码） | 登录即可 |
| `POST /api/v3/users` | 注册新用户（仅最早 admin = `users[0]` 可调用；密码哈希存 data/users.json） | 最早 admin |
| `GET /api/avatar/<游戏名>` | 正版玩家皮肤 PNG 代理（Mojang API，前端裁脸） | 登录即可 |
| `GET /api/v3/overview` | 总览（实例数/统计/任务数） | 登录即可 |
| `GET /api/v3/health` | 实例健康监控列表 | 登录即可 |
| `POST /api/v3/health/reset` | 重置健康统计 | admin |
| `GET /api/v3/stats` | 消息统计（按天） | 登录即可 |
| `GET/POST/PUT/DELETE /api/v3/schedules` | 定时任务 CRUD | 写=admin |
| `GET/PUT /api/v3/automation` | 掉线检测/防AFK 配置 | 写=admin |
| `GET/POST/PUT/DELETE /api/v3/autostart-groups` | 开机自启组 CRUD | 写=admin |
| `POST /api/v3/autostart-groups/trigger` | 手动触发自启组 | admin |
| `GET /api/v3/operation-logs` | 操作日志筛选（user/action/from/to/limit） | 登录即可 |
| `GET /api/v3/operation-logs/export` | 导出 CSV/JSON（format=csv\|json） | 登录即可 |
| `GET /api/v3/instances/export` | 导出全部实例配置（可带 includeIni=true） | 登录即可 |
| `POST /api/v3/instances/import` | 批量导入创建实例 | admin |
| `POST /api/v3/instance/clone` | 克隆实例 | admin |
| `GET/PUT /api/v3/mcc/commands` | 自定义聊天指令（matches.ini） | 写=admin |
| `GET/PUT /api/v3/mcc/servers` | 多服务器列表（servers.txt） | 写=admin |
| `POST /api/v3/mcc/switch-server` | 切换服务器 | admin |
| `GET /api/v3/mcc/mod` | 读取 AntiAFK/AutoRelog 当前配置 | 登录即可 |
| `POST /api/v3/mcc/apply-mod` | 应用原生功能注入（需重启实例生效） | admin |
| `GET /api/v3/mcc/settings` | 读取 MinecraftClient.ini 可视化设置（分组+配置项+当前值） | 登录即可 |
| `PUT /api/v3/mcc/settings` | 保存可视化设置（只改被修改的键，其余保留，多数需重启实例生效） | admin |
| `GET /api/v3/mcc/templates` | 脚本模板（idle/tasks） | 登录即可 |
| `POST /api/v3/mcc/scripts` | 生成脚本文件到实例目录 | admin |

> v2 的所有 API（`/api/daemons`、`/api/instances`、`/api/instance/*`、`/api/files/*`、`/api/template/*`、`/api/operation-logs` 等）保持原样不变。
> readonly 用户对任何 POST/PUT/DELETE（含 v2 接口）都会收到 403。

## 权限分级与 IP 白名单

- **角色**：多用户模式下在 `users` 里给每个账号配 `"role": "admin"` 或 `"readonly"`；单口令模式登录者一律为 admin。
- readonly 用户：可以查看实例/日志/健康监控/操作日志，不能启停实例、改配置、发命令、删文件、执行任何 v3 写操作。
- **IP 白名单**：开启后仅白名单内 IP 能访问面板（对静态资源同样生效）。若面板在 Nginx/Caddy 反代后面，记得设 `trustProxy: true`，否则会看到反代机的 IP（如 `127.0.0.1`）。

## 安全建议

- 务必设置强 `authToken` / 强密码，按需给普通用户配置 readonly 角色。
- 生产环境建议在反向代理（Nginx / Caddy）后启用 HTTPS。
- 面板暴露公网时，建议开启 IP 白名单或加访问控制。
- 用最小权限的 MCSM 账号生成 `apikey`（仅授权相关实例）。

## 致谢

- **[APRme/MULTIBOT_PANEL](https://github.com/APRme/MULTIBOT_PANEL)** — 本项目的 UI 风格与交互设计参考（感谢其提供灵感）。后续的**头像获取**（玩家头像）与**材质获取**（皮肤材质）功能亦将参考该项目的实现思路。
- **[MCSManager](https://github.com/MCSManager/MCSManager)**（Apache-2.0）— 提供节点/实例管理 API，本面板经其 daemon 控制 MCC 实例。
- **[Minecraft Console Client](https://github.com/MCCTeam/Minecraft-Console-Client)**（CDDL-1.0）— 被本面板控制与配置的机器人客户端。

## 许可证

[MIT](LICENSE)
