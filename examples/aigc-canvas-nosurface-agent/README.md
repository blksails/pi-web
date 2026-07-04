# aigc-canvas-nosurface-agent

降级验证 fixture:**贡献 Canvas 面板,但 agent 未注册 canvas surface**。

与 [`aigc-canvas-agent`](../aigc-canvas-agent) 唯一差异是 `index.ts` 不装载
`canvasSurfaceExtension`,因此不注册 `surface:canvas` 探针命令。前端
`WebExtSurfaceAccess.hasCommand("surface:canvas")` 求值为假,Canvas 面板挂载后
退化为「只读图库(该 source 未提供 canvas surface)」(`data-canvas-available="false"` +
`data-canvas-degraded` 横幅),同时 pi-web 对话等本地功能照常可用、不崩溃。

用途:`e2e/browser/aigc-canvas-degrade.e2e.ts` 的降级端到端场景(Req 8.6 / 8.7)。
`.pi/web/web.config.tsx` 的 slot 贡献经 `lib/app/webext-registry.ts` 构建期集成车道注册。
