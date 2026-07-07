# agent-routes-demo

声明式 HTTP routes 的**多路由**范例——演示 `routes/` 子目录的**文件目录标准**(spec agent-declared-routes;标准见 [docs/product/07 · 声明式路由的文件组织](../../docs/product/07-agent-development.md#声明式路由的文件组织))。

## 目录结构

```
agent-routes-demo/
├── index.ts               # defineAgent;import { routes } from "./routes/index.js",无 handler 逻辑
├── routes/
│   ├── index.ts           # barrel:export const routes = [pingRoute, echoRoute, whoamiRoute]
│   ├── ping.ts            # pingHandler + pingRoute
│   ├── echo.ts            # echoHandler + echoRoute(GET·POST)
│   └── whoami.ts          # whoamiHandler + whoamiRoute
├── package.json
└── README.md
```

约定:**一路由一文件**,文件名 === 路由 `name`(kebab-case)=== URL 段;文件内 co-locate handler(单独 export 便于单测)+ `AgentRouteDecl`;`routes/index.ts` barrel 汇总;`index.ts` 只 import 不放逻辑。

## 试一下

以本目录为 agent source 启动会话后(`pi-web ./examples/agent-routes-demo`),直接 HTTP 调用(无需订阅 SSE):

```bash
# 探活
curl http://127.0.0.1:3000/api/sessions/<id>/agent-routes/ping
# → {"pong":true}

# 回显 query
curl "http://127.0.0.1:3000/api/sessions/<id>/agent-routes/echo?foo=bar"
# → {"method":"GET","query":{"foo":"bar"},"body":null}

# 回显 POST body
curl -X POST http://127.0.0.1:3000/api/sessions/<id>/agent-routes/echo \
  -H 'content-type: application/json' -d '{"hello":"world"}'
# → {"method":"POST","query":{},"body":{"hello":"world"}}

# 身份 + 路由清单
curl http://127.0.0.1:3000/api/sessions/<id>/agent-routes/whoami
# → {"agent":"agent-routes-demo","routes":["ping","echo","whoami"]}
```

调用不触发 LLM、不进对话历史、对话 UI 零变化。完整调用契约(错误码、env、超时/体积上限)见 [13 · HTTP API 参考](../../docs/product/13-http-api-reference.md)。
