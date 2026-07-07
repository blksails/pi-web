# Implementation Plan — pi-web 桌面版(M1)

> 复用既有 standalone 产物与 CLI 启动原语;后端仅一处向后兼容改动。
> Foundation(1)先建接缝 → Core(2)并行实现主进程模块 → Integration(3)串联 + 打包 → Validation(4)e2e。

- [ ] 1. Foundation:后端注入接缝、复用原语、桌面工程脚手架

- [x] 1.1 runner spawn 支持注入的 Node 二进制
  - 让 spawn 装配从其已构造的 env 读取 Node 二进制路径,存在则用作子进程可执行文件,缺省回退现有默认 `node`;custom 与 cli 两条分支一致处理
  - 保持「不直接读取进程全局环境」的不变式(只读入参 env)
  - 新增单测:注入该变量时 spawnSpec 的可执行文件等于注入值(custom/cli 各一条);未注入时等于 `node`(证明 CLI/dev 零回归)
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: assemble()_

- [x] 1.2 补导出 CLI 复用原语
  - 把 CLI 启动器里已有的就绪探针与产物入口定位两个内部函数补为导出(供桌面壳复用),不改其行为
  - 观察完成:桌面包可从 CLI 启动器 import 到就绪探针与产物入口定位函数;CLI 既有命令行行为不变(现有 CLI e2e 仍绿)
  - _Requirements: 1.4, 3.3_
  - _Boundary: bin/pi-web.mjs 导出_

- [x] 1.3 桌面 workspace 脚手架
  - 新建顶层 `desktop/` 工作区包(依赖 Electron ≥39 与 electron-builder;TS 编译到 dist;dev/build/dist 脚本),并把该目录注册进 workspace 使 `pnpm install` 纳入
  - 观察完成:`pnpm install` 后 desktop 包被识别、Electron 就位;`desktop` 的 typecheck/build 脚本可跑通空骨架
  - _Requirements: 9.1_
  - _Boundary: desktop 工程配置_

- [ ] 2. Core:主进程模块(脚手架就绪后并行)

- [x] 2.1 (P) 运行模式判定与产物入口定位
  - 以「是否打包态」为主判据、叠加显式开发开关判定 dev / packaged 模式(不猜测);packaged 态从随包资源目录定位 standalone server 入口,dev 态返回空并交由壳改指开发服务器地址
  - 观察完成:单测证明打包态解析出资源目录下的 server 入口、dev 态返回空并带开发地址;免打包即可进入 dev 分支
  - _Requirements: 3.3, 8.1, 8.2, 8.3_
  - _Boundary: resolveRuntimeMode, resolveServerEntry_
  - _Depends: 1.3_

- [x] 2.2 (P) 安全主窗口、外链拦截与加载页
  - 建窗口时以隔离渲染上下文加载(不授予 Node/系统集成),经最小 preload 桥;启动即显示本地加载页避免空白窗口;拦截应用内新窗口,校验 scheme 后把外部链接交系统默认浏览器打开
  - 观察完成:窗口以隔离上下文加载本地加载页;单测证明外链决策对 http/https 交系统浏览器、对本地回环 UI 与非法 scheme 一律阻止应用内导航
  - _Requirements: 1.3, 5.3, 5.4_
  - _Boundary: createMainWindow, preload_
  - _Depends: 1.3_

- [x] 2.3 (P) server 受监管拉起与就绪探针
  - 选空闲回环端口、组装 server 环境(复用 CLI 的端口选择与 env 组装原语,叠加注入的 Node 二进制路径与「以 Node 方式运行」标记);以进程组组长方式拉起 standalone server 并捕获其错误输出;复用就绪探针等待可用;返回 url/端口或判别式启动错误(无端口/早退/超时),失败时先收尾已拉起的进程
  - 观察完成:指向一个最小可就绪 server 脚本时返回就绪 url 与端口;env 里带注入的 Node 二进制路径与运行标记,而主进程自身不带该运行标记
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 4.4, 5.1, 5.2_
  - _Boundary: ServerSupervisor_
  - _Depends: 1.2, 1.3_

- [ ] 2.4 退出进程树收尾
  - 停止时对 server 进程组做整组终止(POSIX 负 pid 优雅信号 + 宽限期后强制;Windows 强制树终止),触达 runner 孙进程,释放端口;幂等
  - 观察完成:集成层可断言 stop 后进程组不存活、端口被释放
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: ServerSupervisor_
  - _Depends: 2.3_

- [ ] 2.5 (P) 启动失败可见呈现
  - 把三类启动错误(无空闲端口 / server 早退并附错误输出线索 / 就绪超时)呈现为可读提示,并提供退出与重试途径
  - 观察完成:给定任一启动错误,窗口显示对应可读提示且提供退出/重试,不停在空白或无限等待
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - _Boundary: showStartupError_
  - _Depends: 1.3_

- [ ] 3. Integration:主进程编排与打包

- [ ] 3.1 主进程编排入口
  - 串联启动链:判定模式 → 定位产物入口(dev 分支直接加载开发地址,不拉起)→ 受监管拉起 server → 就绪后窗口加载本地回环 UI;失败走可见错误呈现并收尾;app 退出(before-quit)触发进程树收尾;不注入 agent 配置目录覆盖,使会话默认落 `~/.pi/agent` 与 CLI 共享
  - 观察完成:打包/未打包均能从双击(或 `_electron` 启动)进入本地 UI;dev 模式免打包直接加载开发地址;创建的会话写入共享数据目录、CLI 入口可见
  - _Requirements: 1.1, 1.2, 1.4, 6.1, 7.1, 7.2, 7.3, 8.1_
  - _Boundary: main 入口(集成)_
  - _Depends: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 3.2 打包配置与 macOS dmg 产出
  - 配置把 standalone 产物经资源目录(asar 之外)整目录嵌入,产出可分发的 macOS dmg(本地未签名可运行);dist 脚本前置依赖 standalone 产物构建;资源落点与产物入口定位的打包态路径对齐
  - 观察完成:`pnpm build:cli` 后跑 desktop dist 产出一个 dmg,安装后应用内可定位到资源目录下的 server 入口
  - _Requirements: 3.1, 3.2, 9.1_
  - _Boundary: electron-builder 配置_
  - _Depends: 1.3, 3.1_

- [ ] 4. Validation:集成与端到端

- [ ] 4.1 (P) ServerSupervisor 集成测试(真实子进程)
  - 覆盖:就绪返回 url/端口;server 立即退出 → 早退错误且无遗留子进程;env 透传断言(子进程 env 含注入的 Node 二进制路径与运行标记、主进程 env 不含运行标记);stop 后进程组不存活、端口释放
  - 观察完成:上述集成用例以新鲜运行输出全绿
  - _Requirements: 2.2, 4.4, 6.2, 6.3, 6.4_
  - _Boundary: ServerSupervisor 测试_
  - _Depends: 2.3, 2.4_

- [ ] 4.2 桌面启动闭环与真实会话 e2e
  - 用 Playwright 的 Electron 驱动启动桌面壳(指向预构建产物 + mock provider):断言窗口加载了本地回环 UI(非空白/非加载页);选 agent source → 发消息 → 收到流式回复(证明 server→runner 链在「Electron 充当 Node」下可用,含 runner 动态加载用户代码)
  - 观察完成:e2e 以新鲜输出证明启动进入本地 UI 且真实会话得到流式回复
  - _Requirements: 1.1, 1.4, 3.4, 9.3_
  - _Boundary: 桌面 e2e_
  - _Depends: 3.1, 3.2_

- [ ] 4.3 干净无 Node 验证、退出收尾 e2e 与证据记录
  - 沿用 CLI 重定位测试「藏起系统 node」的思路:在 PATH 无系统 node 的条件下启动打包/产物形态并跑通真实会话(证明 runner 用注入的二进制);关闭应用后断言端口释放、无残留 runner 进程;归档启动成功 + 真实会话的新鲜运行证据
  - 观察完成:无系统 node 条件下会话跑通、退出后无残留进程与占用端口,验证记录随交付归档
  - _Requirements: 4.2, 6.1, 9.2, 9.4_
  - _Boundary: 桌面 e2e_
  - _Depends: 3.2, 4.2_
