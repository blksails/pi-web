# 真沙箱 LLM 网关验证夹具(手动,任务 4.4)

模拟 **pi-clouds 未来要加的镜像 entrypoint 网关分支**,在本地 kind e2b 真沙箱端到端验证
「沙箱内 pi 主对话经 LLM 网关换钥、真实 provider key 不进沙箱」。不改任何仓的生产代码。

## 前置
- 本地 kind 集群 + `agent-sandbox` Deployment 已跑
- 本地有真 pi 基础镜像 `pi-clouds/agent-runner:pi`
- 宿主 shell 有真实 `OPENROUTER_API_KEY`(网关换钥用)

## 步骤
1. 造测试镜像(网关 entrypoint:见 `PI_LLM_GATEWAY_BASE` 即把 models.json 每 provider
   改为 `baseUrl=$base/<id>`、`apiKey=$PI_LLM_TOKEN_<ID>`、`authHeader:true`):
   `docker build -t pi-clouds/agent-runner:pi-gw-test .`
2. 起 dev(bake hello-agent 于测试镜像 + 网关 serve):`bash launch-gw-dev.sh`
3. Chrome 开 hello-agent 会话,发任意对话
4. 验证:
   - `kubectl exec -n agent-sandbox <pod> -- env | grep OPENROUTER` → 只有
     `PI_LLM_TOKEN_OPENROUTER=pw2.llm:openrouter.<sessionId>.…`,**无 `OPENROUTER_API_KEY` 真实值**
   - dev 日志 `server:llm-gateway` → openrouter status 200(换钥成立;token 打 openrouter 必 401)
   - 页面主对话成功回复

## 已知发现
dashscope 端点分叉**已修**:登记表 upstreamBase 改为 compatible-mode/v1(主对话),
(`token-plan…/compatible-mode/v1`);主对话/AIGC 端点分叉的 provider 需登记表区分用途。
