#!/bin/bash
# sandbox-credentials-v2 真沙箱 live 验证:LLM 网关端到端(openrouter provider)
set -e
cd /Users/hysios/Projects/BlackSail/agents/pi-web/.claude/worktrees/sandbox-credentials-v2
# 宿主网关侧需真实 OPENROUTER_API_KEY(换钥);当前 shell 已 export
[ -z "$OPENROUTER_API_KEY" ] && { echo "FATAL: OPENROUTER_API_KEY 未设"; exit 1; }
# LLM 网关配置(宿主起网关 + 沙箱注入 token)
export PI_WEB_LLM_GATEWAY_PUBLIC_BASE="http://host.docker.internal:3020"
export PI_WEB_LLM_GATEWAY_SECRET="llm-gw-dev-secret-stable-0123456789abcdef"
export PI_WEB_LLM_GATEWAY_SERVE="1"
# 真 pi + 网关形态测试镜像(entrypoint 见 PI_LLM_GATEWAY_BASE 生成网关 models.json)
export PI_WEB_E2B_BASE_IMAGE="pi-clouds/agent-runner:pi-gw-test"
export PI_WEB_E2B_BAKE_SOURCE="examples/hello-agent"
export PI_WEB_ATTACHMENT_SECRET="${PI_WEB_ATTACHMENT_SECRET:-attach-dev-secret-stable-0123456789}"
# 服务端日志:抓网关换钥
export PI_WEB_LOG_ENABLED=true
export PI_WEB_LOG_LEVEL=info
export PI_WEB_LOG_NAMESPACES="server:llm-gateway,app:llm-gateway"
echo "[launch] base=pi-gw-test bake=hello-agent gateway=host.docker.internal:3020/api/llm-gateway serve=1 provider=openrouter"
exec pnpm dev:e2b:local
