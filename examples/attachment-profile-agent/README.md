# attachment-profile-agent

agent 具名附件 profile 的端到端范例(spec `agent-attachment-profile`,叠加在多后端拓扑 spec `attachment-backend-pluggable` 之上)——演示 **agent 用一个名字把本会话产物定向到宿主注册的具名后端**,以及白名单失败与运维关断两条控制路径。

核心事实:

- agent 定义只声明 `attachmentProfile: "archive"`(纯名字);凭据/端点/后端种类全在宿主拓扑里,agent 面**不存在**声明它们的通道。
- 名字必须命中宿主 `PI_WEB_ATTACHMENT_BACKENDS` 注册的后端集合,未命中 → **会话创建失败**(白名单,防外泄/SSRF)。
- profile 只决定**新写入落哪**(前端上传 + 子进程工具产物两条路径);读取/签名分发按附件描述符固化的 `backend` 字段权威路由,与会话/agent 进程生死无关。

## 目录结构

```
attachment-profile-agent/
├── index.ts        # defineAgent:attachmentProfile 声明 + 两条观察用 route(put-output / list-session)
├── package.json
└── README.md
```

## 试一下

### 1. 准备双后端拓扑(纯本地,零外部依赖)

```bash
export PI_WEB_ATTACHMENT_BACKENDS='{
  "backends": [
    { "name": "primary", "kind": "local-fs", "dir": "/tmp/pi-attach/primary" },
    { "name": "archive", "kind": "local-fs", "dir": "/tmp/pi-attach/archive" }
  ],
  "write": "primary"
}'
export PI_WEB_ATTACHMENT_SECRET=demo-secret
```

宿主默认写入目标是 `primary`;本 agent 声明的 profile 是 `archive`。

### 2. 启动并观察写路由

以本目录为 agent source 启动会话(`pi-web ./examples/attachment-profile-agent`),然后:

```bash
# 子进程工具产物路径:落一个附件(应进 archive)
curl -X POST http://127.0.0.1:3000/api/sessions/<id>/agent-routes/put-output
# → {"ok":true,"attachmentId":"att_…"}

# 观察本会话附件的后端绑定
curl http://127.0.0.1:3000/api/sessions/<id>/agent-routes/list-session
# → {"ok":true,"count":1,"items":[{"id":"att_…","origin":"tool-output","backend":"archive"}]}
```

前端上传路径同理:在会话里上传任意文件,再调 `list-session`,上传件的 `backend` 同样是 `archive`。盘上验证:字节文件出现在 `/tmp/pi-attach/archive/`,描述符 `<id>.att.json` 里含 `"backend":"archive"`。

### 3. 白名单失败(把名字改错)

把 `index.ts` 的 `attachmentProfile` 改成任何未注册的名字(如 `"nope"`)再开会话——会话创建失败(子进程装配期校验,错误信息含该名字与已注册集合)。宿主完全未设 `PI_WEB_ATTACHMENT_BACKENDS` 时同理:白名单为空,任何声明都失败。

### 4. 运维关断

```bash
export PI_WEB_AGENT_ATTACHMENT_PROFILE_DISABLED=1
```

重启后再开会话:声明被忽略、会话**正常创建**,新写入回落宿主默认目标 `primary`(`list-session` 可见 `backend: "primary"`)。

## 相关

- 声明面契约:`AgentDefinition.attachmentProfile`(`@blksails/pi-web-agent-kit`)
- 宿主拓扑与多后端(UnionBlobStore/描述符 backend 权威路由):spec `attachment-backend-pluggable`
- 附件工具桥(`putOutput`/`resolve` 完整范式):[attachment-tool-agent](../attachment-tool-agent/)
- 声明式 routes(本例的观察通道):[agent-routes-demo](../agent-routes-demo/)
