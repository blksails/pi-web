# Brief — http-api

> 语言:zh。权威设计:`PLAN.md` §3.3(API 路由)、§13.2(createPiWebHandler/协议)、§11.5(SSE 反代)、§14.1③(控制/数据面)。

## 问题
- **谁**:浏览器前端与第三方语言无关客户端。
- **现状**:会话引擎只是 Node 内的对象,缺对外 HTTP/SSE 接口与框架无关的挂载方式。
- **改变**:暴露稳定的 REST + SSE 契约,并提供框架无关的 `createPiWebHandler`。

## 方法 / 范围
- **REST + SSE 端点**(全部 Node runtime):
  `POST /sessions`(建会话→spawn)、`GET /sessions/:id/stream`(SSE)、
  `POST /sessions/:id/{messages,steer,follow_up,abort,model,thinking,ui-response}`、
  `GET /sessions/:id/{state,stats,messages,commands}`、`DELETE /sessions/:id`。
- **SSE 帧**:UIMessage chunks + 旁路 control 事件;heartbeat 注释帧防断;`X-Accel-Buffering: no`。
- **`createPiWebHandler(opts)`**:返回标准 Web Fetch `(req:Request)=>Promise<Response>`,可挂 Next.js Route Handler / Hono / Express(adapter)。
- **可插拔点(留接口,默认放行)**:`authResolver`、`authorizeSession`(§13.4);不在此 spec 落地完整鉴权。
- **范围外**:UI;扩展安装(extension-management);沙箱 provider 落地(留接口)。

## 依赖
- session-engine、protocol-contract。

## 测试 + e2e(硬性)
- **单元**:每个 handler 的请求校验(用 protocol DTO)、错误码;SSE 帧编码。
- **集成**:对真实 engine(stub agent)起 handler,POST 命令 + 订阅 SSE。
- **e2e**:HTTP `POST /sessions` → `GET /stream` → `POST /messages` 后在 SSE 上拿到逐字 text-delta 直至 finish;abort 生效;断线重连续流。

## 约束
- 不能 Edge/Serverless(子进程驻留);SSE 长连接 + Node runtime;契约带 `protocolVersion`。
