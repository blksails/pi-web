# Feature Validation Report — pi-web-desktop (M1)

## Validation Report
- DECISION: **GO**
- MECHANICAL_RESULTS:
  - Tests: PASS — desktop 50 tests(7 files)+ CLI cli-args 26 + server assemble-spawn(mode-trust)32,均 exit 0;新鲜运行输出。
  - TBD/TODO grep: CLEAN(feature 边界文件无 TBD/TODO/FIXME/HACK/XXX)。
  - Secrets grep: CLEAN(仅 mock-key/env 引用,无硬编码密钥)。
  - Smoke boot: PASS — 两条真实 Electron e2e 均独立跑通(见下)。
- E2E(runtime liveness,真实产物):
  - `e2e/desktop/desktop-real.mjs`:exit 0,4/4 ✓(reviewer 独立复跑亦 exit 0)——真实 Electron 壳 → Electron-as-Node spawn standalone → BrowserWindow 加载本地回环 UI → 真实 runner(runner-bootstrap→jiti→用户 agent)→ mock provider 流式回包;`mock.getCalls()≥1` 硬证据。
  - `e2e/desktop/desktop-no-node.mjs`:exit 0,5/5 ✓——**PATH 剥除系统 node** 后真实会话仍跑通(证明 runner 用注入的 Electron-as-Node 二进制,Req 9.2/4.2);关闭应用后端口释放(进程树收尾无残留,Req 6.1)。
  - 打包:electron-builder 产出 `pi-web-0.1.0-arm64.dmg`;standalone 落 `Resources/standalone/server.js`(asar 外,与 resolveServerEntry 打包态路径对齐),runner-bootstrap 已打包(Req 3.1/3.2/9.1)。
- INTEGRATION:
  - Cross-task contracts: OK — supervisor `ServerStartError` 判别联合被 showStartupError(2.5)穷尽消费;main(3.1)注入 CLI 原语(findFreePort/waitForReady/standaloneServerJs/buildEnv)与 resolveServerEntry deps、supervisor deps 一致;env 注入链(main→supervisor→server→runner)经 e2e 端到端验证。
  - Shared state consistency: OK — 数据目录沿用 `~/.pi/agent`(main 不覆盖 agentDir),与 CLI 共享;附件/会话语义未改。
  - Boundary audit: OK — 后端仅 `assemble-spawn.ts` 单点读 `env["PI_WEB_NODE_BIN"]`(缺省回退 node,向后兼容);`bin/pi-web.mjs` 仅补两导出 + 一行向后兼容入口守卫(CLI 26 测试 + --help 绿);无跨任务责任外溢;DI 保持模块解耦。
- COVERAGE:
  - Requirements mapped: 9/9 顶层需求全覆盖。
    - 1(启动)→2.3/3.1/4.2;2(失败可见)→2.5/4.1;3(自包含产物)→2.1/3.2/4.2;4(runner 无系统 node)→1.1/2.3/4.3;5(安全)→2.2/2.3;6(进程树收尾)→2.4/4.1/4.3;7(共享数据目录)→3.1;8(dev 模式)→2.1/3.1;9(dmg+干净机)→3.2/4.3。
  - Coverage gaps: 无。
- DESIGN:
  - Architecture drift: 无实质漂移。两处已复核细化:RuntimeMode 增 `unpackaged` 第三态(覆盖 e2e/本地直跑);resolveServerEntry/supervisor 采注入 deps(可测性)。design.md 已同步。
  - Dependency direction: OK — desktop 壳 → 内联 CLI 原语 + electron;无向上导入;bundle 外部依赖仅 electron + node 内建(自包含)。
  - File Structure Plan vs actual: MATCH — desktop/src 九模块 + build.mjs + electron-builder.yml + static/loading.html;新增 external-link.ts(抽纯函数)、bin-pi-web.d.ts(环境类型)均已复核接受。
- OWNERSHIP: LOCAL
- UPSTREAM_SPEC: N/A
- BLOCKED_TASKS: 无(13/13 子任务 `[x]`)。
- 关键坑(Implementation Notes 已记):esbuild CJS 内联 `import.meta` 空对象致加载崩溃 → banner+define shim;内联 CLI 入口守卫误触发 → `globalThis.__PI_WEB_CLI_EMBEDDED__` 标记;`node --check` 不执行漏加载期崩溃 → stub electron 验证;start() 失败分支须 stop 前捕获 exited 以正确分类 ready-timeout。

## 结论
M1(最小可用壳)端到端达标:干净无 Node 的 macOS 机器上桌面壳可启动、跑通真实会话、退出无残留,并产出可分发 dmg,均以新鲜运行证据佐证。GO。

M2(托盘/多窗口/菜单快捷键/休眠唤醒/原生目录选源)、M3(多平台 CI/签名公证/自动更新)按边界声明顺延,不在本次范围。
