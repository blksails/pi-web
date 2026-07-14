#!/usr/bin/env bash
#
# e2e-readiness.sh — 一键跑会话就绪握手的浏览器 e2e(spec session-readiness-handshake)。
#
# 自动完成:构建自包含产物 → 起 stub 服务器 → 等就绪 → 外置模式跑 playwright → 清理。
#
# 注:本脚本原先存在的两条理由已随 Next 一并消失(spec vite-spa-migration):
#   1) `next start` 不兼容 output:standalone → 曾需 PI_WEB_DISABLE_STANDALONE=1;
#   2) playwright 自管 webServer 在 standalone 配置下超时 → 曾需外置服务器模式。
# 现在 `node dist/server.mjs` 就是生产入口;外置模式保留只为复用同一个服务器进程。
#
# 用法:
#   bash scripts/e2e-readiness.sh                 # 跑就绪 spec
#   bash scripts/e2e-readiness.sh --all           # 就绪 + custom-agent 全闭环(回归)
#   PORT=3200 bash scripts/e2e-readiness.sh        # 换端口
#   SKIP_BUILD=1 bash scripts/e2e-readiness.sh     # 复用上次 dist 构建,跳过 build
#
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3100}"
DIST="${PI_WEB_DIST_DIR:-dist}"
SPECS=("session-readiness.e2e.ts")
[[ "${1:-}" == "--all" ]] && SPECS+=("custom-agent.e2e.ts")

# 端口占用预检:避免孤儿服务器致 playwright 连到错误/旧构建。
if lsof -ti "tcp:${PORT}" >/dev/null 2>&1; then
  echo "✗ 端口 ${PORT} 已被占用(PID $(lsof -ti tcp:${PORT} | tr '\n' ' '))。先释放或换 PORT=。" >&2
  exit 1
fi

FS_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pi-e2e-fs-XXXXXX")"
AGENT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pi-e2e-agent-XXXXXX")"
SERVER_PID=""

cleanup() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  local held; held="$(lsof -ti tcp:${PORT} 2>/dev/null || true)"
  [[ -n "$held" ]] && kill -9 $held 2>/dev/null || true
  rm -rf "$FS_ROOT" "$AGENT_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# (1) 自包含产物构建(前端 + 服务端入口 + 依赖收集)。
if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  echo "▸ 构建自包含产物(${DIST}/)…"
  PI_WEB_DIST_DIR="${DIST}" pnpm build:dist >/tmp/e2e-readiness-build.log 2>&1 \
    || { echo "✗ 构建失败,见 /tmp/e2e-readiness-build.log"; tail -20 /tmp/e2e-readiness-build.log; exit 1; }
fi

# (2) 起 stub 服务器(就绪握手默认开)。
# 以仓库根为 cwd 启动(PI_WEB_DEFAULT_SOURCE 是相对路径),故须显式指出前端目录。
echo "▸ 启动 stub 服务器 :${PORT}…"
PORT="${PORT}" \
PI_WEB_STUB_AGENT=1 \
PI_WEB_DEFAULT_SOURCE=./examples/hello-agent \
PI_WEB_DEFAULT_MODEL=stub-model \
PI_WEB_AGENT_DIR="${AGENT_DIR}" \
PI_WEB_CLIENT_DIR="$(pwd)/${DIST}/client" \
SESSION_STORE=fs SESSION_STORE_ROOT="${FS_ROOT}" \
  node "${DIST}/server.mjs" >/tmp/e2e-readiness-server.log 2>&1 &
SERVER_PID=$!

# 等健康(最长 60s)。
echo -n "▸ 等待就绪"
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then ready=1; break; fi
  echo -n "."; sleep 1
done
echo
[[ "${ready:-}" == "1" ]] || { echo "✗ 服务器未就绪,见 /tmp/e2e-readiness-server.log"; tail -20 /tmp/e2e-readiness-server.log; exit 1; }

# (3) 外置模式跑 playwright。
echo "▸ 运行 e2e: ${SPECS[*]}"
PI_WEB_E2E_EXTERNAL_SERVER=1 PI_WEB_E2E_PORT="${PORT}" PI_WEB_DIST_DIR="${DIST}" \
PI_WEB_E2E_FS_ROOT="${FS_ROOT}" PI_WEB_E2E_AGENT_DIR="${AGENT_DIR}" \
  pnpm exec playwright test "${SPECS[@]}" --project=fs
echo "✓ 完成"
