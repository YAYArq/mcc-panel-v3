# YAYAbot (mcc-panel-v2)

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D16-brightgreen.svg)](package.json)

一个通过 **MCSManager (MCSM)** 控制 **MCC (Minecraft Console Client)** bot 实例的网页面板，可部署在服务器上。界面与交互参考 [APRme/MULTIBOT_PANEL](https://github.com/APRme/MULTIBOT_PANEL)，UI 风格融合明日方舟 × 女神异闻录 3/4。

**零第三方依赖**：只需 Node.js（≥16），无需 `npm install`。

## 功能

- 实例列表与实时状态（运行中 / 启动中 / 停止中 / 已停止 / 忙碌），按 MCSM 远程节点(daemon)切换
- 启动 / 停止 / 重启 / 强杀（单实例与批量操作）
- 名称搜索、多选批量控制
- 实例详情抽屉：
  - **日志**：实时轮询 MCC 控制台输出（可暂停、自动滚动、清空）
  - **命令**：向 MCC stdin 发送指令（带命令历史）
  - **配置**：查看/编辑实例 MCSM 配置（`startCommand`、`stopCommand`、`cwd`、`eventTask` 等）
  - **文件**：浏览实例目录，查看/编辑 MCC 配置文件（`MinecraftClient.json`、`servers.txt` 等）
- 访问口令保护：MCSM 的 `apikey` 只存在后端，绝不暴露给浏览器

## 目录结构

```
mcc-panel/
├── server.js            # 零依赖 Node 服务器：静态文件 + 访问口令 + MCSM API 代理
├── install.sh           # Ubuntu/Debian 一键安装脚本（含 systemd 服务）
├── lib/
│   ├── config.js        # 配置加载
│   └── mcsm-client.js   # MCSM API 客户端（自动附加 apikey 与请求头）
├── public/
│   ├── index.html       # 页面结构
│   ├── app.css          # 样式（深色主题）
│   ├── api.js           # 前端 API 封装
│   └── app.js           # 前端交互逻辑
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
  }
}
```

2. 启动：

```bash
node server.js
# 或指定配置文件路径
node server.js /path/to/panel.config.json
```

3. 浏览器打开 `http://<服务器地址>:18082`，输入访问口令即可。

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
| `mcsm.url` | MCSM 面板地址（不带尾部 `/`） |
| `mcsm.apikey` | MCSM API Key |
| `mcsm.timeoutMs` | 请求 MCSM 的超时（毫秒） |
| `logPollIntervalMs` | 日志轮询间隔 |
| `listPollIntervalMs` | 实例列表刷新间隔 |

## MCSM API 端点（后端代理）

面板后端对 MCSM 的以下接口做代理并隐藏 `apikey`：

- `GET /api/service/remote_services_list` — 节点列表
- `GET /api/service/remote_service_instances` — 实例列表
- `GET /api/instance` — 实例详情
- `POST /api/protected_instance/{open,stop,restart,kill}` — 启停控制
- `POST /api/protected_instance/command` — 发送命令
- `GET /api/protected_instance/outputlog` — 控制台日志
- `PUT /api/instance` — 更新实例配置
- `GET /api/files/list` / `PUT /api/files/` — 文件浏览与读写

## 安全建议

- 务必设置强 `authToken`。
- 生产环境建议在反向代理（Nginx / Caddy）后启用 HTTPS。
- 用最小权限的 MCSM 账号生成 `apikey`（仅授权相关实例）。
- 面板服务本身没有限流/审计，请勿直接暴露到公网而不加防护。

## 许可证

[MIT](LICENSE)
