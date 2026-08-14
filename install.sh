#!/usr/bin/env bash
#
# MCC Bot Panel 一键安装脚本（Ubuntu / Debian + systemd）
#
# 用法：
#   sudo bash install.sh
#
# 支持通过环境变量非交互安装：
#   MCSM_URL=http://1.2.3.4:23333 \
#   MCSM_APIKEY=你的apikey \
#   PANEL_PORT=18082 \
#   PANEL_AUTH_TOKEN=你的口令 \
#   INSTALL_DIR=/opt/mcc-panel \
#   sudo -E bash install.sh
#
set -euo pipefail

APP_NAME="mcc-panel"
SERVICE_NAME="mcc-panel"
INSTALL_DIR="${INSTALL_DIR:-/opt/mcc-panel}"
PANEL_PORT="${PANEL_PORT:-18082}"

log()  { echo -e "\033[1;32m[install]\033[0m $*"; }
warn() { echo -e "\033[1;33m[install]\033[0m $*"; }
err()  { echo -e "\033[1;31m[install]\033[0m $*" >&2; }

if [[ $EUID -ne 0 ]]; then
  err "请使用 root 运行：sudo bash install.sh"
  exit 1
fi

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
for f in server.js package.json; do
  if [[ ! -f "$SRC_DIR/$f" ]]; then
    err "未在 $SRC_DIR 找到 $f，请从 mcc-panel 项目目录内运行本脚本。"
    exit 1
  fi
done

# ---------- 1. 收集配置 ----------
read_text() {
  local prompt="$1" var="$2"
  local val="${!var}"
  if [[ -z "$val" ]]; then
    read -r -p "$prompt: " val
  fi
  eval "$var=\"$val\""
}

read_secret() {
  local prompt="$1" var="$2"
  local val="${!var}"
  if [[ -z "$val" ]]; then
    read -r -s -p "$prompt: " val
    echo
  fi
  eval "$var=\"$val\""
}

gen_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 16
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

read_text "MCSM 面板地址(如 http://1.2.3.4:23333)" MCSM_URL
read_secret "MCSM API Key(建议管理员权限)" MCSM_APIKEY
read_text "面板监听端口" PANEL_PORT
if [[ -z "${PANEL_AUTH_TOKEN:-}" ]]; then
  read -r -p "面板访问口令(回车自动生成强口令): " PANEL_AUTH_TOKEN
  if [[ -z "$PANEL_AUTH_TOKEN" ]]; then
    PANEL_AUTH_TOKEN="$(gen_token)"
  fi
fi

if [[ -z "$MCSM_URL" || -z "$MCSM_APIKEY" ]]; then
  err "MCSM_URL 与 MCSM_APIKEY 不能为空"
  exit 1
fi

# ---------- 2. 安装 Node.js ----------
install_node() {
  if command -v node >/dev/null 2>&1; then
    local v; v="$(node -v)"
    log "检测到已安装 Node.js $v"
    return 0
  fi
  log "安装 Node.js 20 LTS (NodeSource)..."
  apt-get update -y
  apt-get install -y curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  log "Node.js 安装完成: $(node -v)"
}

install_node

# ---------- 3. 部署文件 ----------
log "部署文件到 $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
cp -r "$SRC_DIR/server.js" \
      "$SRC_DIR/lib" \
      "$SRC_DIR/public" \
      "$SRC_DIR/package.json" \
      "$SRC_DIR/README.md" \
      "$INSTALL_DIR/"

# ---------- 4. 生成配置（用 node 做 JSON 转义，避免特殊字符问题） ----------
log "写入配置 ..."
CFG_PATH="$INSTALL_DIR/panel.config.json" \
MCSM_URL="$MCSM_URL" \
MCSM_APIKEY="$MCSM_APIKEY" \
PANEL_PORT="$PANEL_PORT" \
PANEL_AUTH_TOKEN="$PANEL_AUTH_TOKEN" \
node -e '
const fs = require("fs");
const cfg = {
  host: "0.0.0.0",
  port: Number(process.env.PANEL_PORT || 18082),
  title: "MCC Bot Panel",
  authToken: process.env.PANEL_AUTH_TOKEN || "",
  mcsm: {
    url: String(process.env.MCSM_URL || "").replace(/\/+$/, ""),
    apikey: process.env.MCSM_APIKEY || "",
    timeoutMs: 15000
  },
  logPollIntervalMs: 2000,
  listPollIntervalMs: 4000
};
fs.writeFileSync(process.env.CFG_PATH, JSON.stringify(cfg, null, 2) + "\n");
'
chmod 600 "$INSTALL_DIR/panel.config.json"
log "配置文件已写入 $INSTALL_DIR/panel.config.json"

# ---------- 5. 注册 systemd 服务 ----------
NODE_BIN="$(command -v node)"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
log "注册 systemd 服务 $SERVICE_NAME ..."
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=MCC Bot Panel (MCSM MCC bot control panel)
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_BIN} ${INSTALL_DIR}/server.js ${INSTALL_DIR}/panel.config.json
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# ---------- 6. 启动并自检 ----------
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME" >/dev/null
sleep 2

if systemctl is-active --quiet "$SERVICE_NAME"; then
  log "服务已启动 (active)"
else
  err "服务未正常启动，请查看日志：journalctl -u ${SERVICE_NAME} -n 50"
  exit 1
fi

if curl -fsS "http://127.0.0.1:${PANEL_PORT}/healthz" >/dev/null 2>&1; then
  echo
  log "=============================================="
  log " 安装完成！"
  log " 面板地址:   http://<服务器IP>:${PANEL_PORT}"
  log " 访问口令:   ${PANEL_AUTH_TOKEN}"
  log " MCSM 地址:  ${MCSM_URL}"
  log "=============================================="
  echo
  log "常用命令："
  log "  查看状态: systemctl status ${SERVICE_NAME}"
  log "  查看日志: journalctl -u ${SERVICE_NAME} -f"
  log "  重启:     systemctl restart ${SERVICE_NAME}"
  log "  卸载:     systemctl disable --now ${SERVICE_NAME} && rm -rf ${INSTALL_DIR} ${UNIT_FILE}"
  echo
  warn "如服务器开启了 ufw 防火墙，请放行端口：ufw allow ${PANEL_PORT}/tcp"
else
  warn "服务已启动，但 healthz 未响应。请检查：journalctl -u ${SERVICE_NAME} -n 50"
fi
