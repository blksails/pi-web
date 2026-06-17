# Brief — app-shell

> 语言:zh。权威设计:`PLAN.md` §2(架构)、§5(目录结构)、§8(验收标准=MVP)、§6 里程碑。

## 问题
- **谁**:想直接部署、或想要一份参考实现的使用者。
- **现状**:各层(协议/引擎/HTTP/前端组件)就绪,但缺把它们装配成可运行整站、并验证端到端闭环。
- **改变**:Next.js 整站把 `createPiWebHandler` 挂到 api routes、用 `<PiChat>` 呈现,完成"选 agent 源 → prompt → 浏览器内流式回复"。

## 方法 / 范围
- **页面**:`app/layout.tsx`、`app/page.tsx`(agent 源选择 + 聊天)、`app/globals.css`(shadcn tokens)。
- **API 装配**:`app/api/sessions/**` 调用 `createPiWebHandler`(来自 http-api)。
- **配置**:`.env.local.example`(`ANTHROPIC_API_KEY` 等、默认 provider/model、默认 agent 源/工作区)。
- **示例 agent**:`examples/hello-agent/index.ts`(用 `defineAgent`)+ 一个 `.pi/` 资源样例,供 e2e 用。
- **承载全链路 e2e**(本项目最高价值验收点)。
- **范围外**:多 agent 管理/embed/远程 host(未来)。

## 依赖
- ui-components、http-api(及其传递依赖)。

## 测试 + e2e(硬性)
- **集成**:api routes 正确转发到 handler;页面渲染。
- **e2e(Playwright,MVP 验收)**:启动应用 → 选择含 `index.ts` 的 fixture agent 源 → 输入 prompt → 浏览器内看到**逐字流式**回复(Markdown);工具调用显示为卡片、思考为折叠块;abort/切模型/stats 可用;触发权限弹窗→选择→agent 继续。
- 另跑一遍**通用 CLI 模式**(无 index 目录)e2e,验证回退路径同样流式。

## 约束
- Node runtime;需可用 provider API key(e2e 可用录制/stub 或低成本模型);长驻服务(非 edge)。
