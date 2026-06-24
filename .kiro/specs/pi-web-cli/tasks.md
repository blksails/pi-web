# Implementation Plan — pi-web-cli

> 依赖方向：构建产物（Foundation）与 CLI 启动器（Core）文件域互不重叠，可并行；测试与 e2e 依赖二者就绪。
> 每个子任务在单一职责边界内；CLI 各职责同处 `bin/pi-web.mjs`，按职责拆分但顺序实现（同文件，不并行）。
>
> **实现状态（2026-06-24）：全部完成并 e2e 验证。** stub 冒烟与真实子进程会话(hello-agent)均通过，P0(runner/pi-cli 子进程依赖随 standalone 分发、runner-bootstrap 路径在重定位后正确解析)已实证。**增量 Req 8(`--watch`)亦完成**：watcher 监视 source + 文件变化触发 runner 重载，e2e 通过。证据见 `evidence/`。

- [x] 1. Foundation：自包含构建产物配置与收尾
- [x] 1.1 启用 standalone 输出并追踪运行时子进程依赖
  - 在构建配置中启用自包含输出，使产物可脱离 monorepo 源码树运行
  - 锚定 monorepo 追踪根，确保工作区包与嵌套依赖被纳入
  - 显式纳入运行时由子进程动态加载、但不在服务端 bundle 内的依赖：runner 引导脚本与其源码、被外置的 agent SDK（含 pi CLI 可执行）、运行用户 agent 入口所需的载入器、以及作者包与示例 agent
  - 仅新增构建期字段，开发态（`next dev`）行为不变
  - 观察完成：执行构建后产物目录内同时存在服务端 `server.js`、runner 引导脚本与被外置 agent SDK 的可执行入口
  - _Requirements: 4.1, 4.2, 7.1_
  - _Boundary: nextConfigTracing_

- [x] 1.2 (P) 构建后收尾脚本：装入静态与公共资源
  - 把构建生成的静态资源与公共资源复制进自包含产物对应位置
  - 校验产物的服务端入口存在，缺失则报错并以非零状态退出
  - 复制为覆盖式，可重复执行
  - 观察完成：运行该脚本后，自包含产物内含静态资源与公共资源目录，页面样式/脚本可正确加载
  - _Requirements: 4.1, 4.3_
  - _Boundary: packStandalone_

- [x] 1.3 (P) 注册 CLI 可执行入口与构建/启动脚本
  - 在包元数据中声明可执行入口，使其可被加入系统 PATH（`npm link` / 全局安装）
  - 新增「构建 + 收尾」一体脚本与「本地启动」脚本
  - 观察完成：在本机 `npm link` 后，`pi-web --help` 可在任意目录被调用并输出帮助文本
  - _Requirements: 1.1_
  - _Boundary: package metadata_

- [x] 2. Core：CLI 启动器
- [x] 2.1 参数解析与帮助/版本短路
  - 解析位置参数（agent source）与全部选项（端口、主机、工作目录、配置目录、打开浏览器、stub、帮助、版本）
  - `--help`/`-h` 输出含用法、位置参数与选项说明的帮助文本并零状态退出；`--version`/`-v` 输出版本号并零状态退出
  - 未知或非法选项取值时输出指明出错选项的可读错误，以非零状态退出且不进入启动流程
  - 观察完成：`pi-web --help`、`pi-web --version` 各自打印内容并 exit 0；传入未知选项时打印错误并 exit 非零
  - _Requirements: 1.2, 2.1, 2.3, 2.4, 2.5, 2.6, 5.1, 5.2, 5.3_
  - _Boundary: parseCliArgs_
  - _Depends: 1.3_

- [x] 2.2 选项到运行时配置映射（含相对路径绝对化）
  - 把解析结果映射为应用已识别的运行时配置入口（默认 source/工作目录、配置目录、监听端口与主机、stub 开关）
  - 位置参数省略时以当前调用目录作为默认 agent source；相对的 source 与工作目录以「调用 CLI 时的目录」为基准解析为绝对路径（因服务端进程工作目录会变）
  - 端口缺省为 3000、主机缺省为 127.0.0.1
  - 仅透传既有凭据类配置，绝不在任何输出中回显敏感值
  - 观察完成：作为纯函数，省略 source 时产出的默认 source 等于绝对化的调用目录；相对 source/工作目录被解析为绝对路径；端口/主机取到缺省值
  - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - _Boundary: buildEnv_
  - _Depends: 2.1_

- [x] 2.3 服务器启动、就绪检测与生命周期监管
  - 启动前校验自包含产物的服务端入口存在；缺失则提示需先执行构建并以非零状态退出
  - 以映射出的运行时配置启动内嵌服务器（子进程，标准输入输出继承）
  - 轮询直至服务器进入可接受请求的就绪状态，随后输出实际访问地址（含主机与端口）
  - 转发中断/终止信号给服务器并透传其退出码；端口被占用时从该端口起递增自动切换到首个空闲端口并告知用户，仅当连续一段范围全被占才报错退出
  - 观察完成：就绪后终端打印可访问地址；Ctrl+C 能停止服务器并退出；端口被占时打印「自动改用 N」并在新端口就绪
  - _Requirements: 1.4, 2.8, 3.1, 3.2, 3.3, 3.4, 4.4_
  - _Boundary: Launcher_
  - _Depends: 2.2_

- [x] 2.4 浏览器自动打开与主入口装配
  - 当提供打开选项时，于服务器就绪后用系统默认浏览器打开访问地址；未提供时仅输出地址
  - 打开失败时提示手动访问并保持服务器运行，不因此终止进程
  - 在可执行入口的主流程中按顺序串联解析、映射、启动、打开，并仅在作为程序入口执行时触发副作用
  - 观察完成：带打开选项启动会拉起浏览器到访问地址；不带则仅打印地址；打开失败时进程仍在运行
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: Opener_
  - _Depends: 2.3_

- [x] 3. 单元与集成验证
- [x] 3.1 (P) 参数解析与配置映射单元测试
  - 覆盖端口/主机/工作目录/配置目录选项、stub 与打开布尔开关、帮助/版本短路、未知参数报错
  - 覆盖：省略 source 时默认 source 等于绝对化调用目录；相对 source/工作目录被绝对化；端口/主机缺省值；stub 开关置位；凭据类配置原样透传且不被打印
  - 观察完成：测试套件运行通过，断言上述映射与短路/报错行为
  - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.6, 2.7, 5.1, 5.2, 5.3_
  - _Boundary: parseCliArgs, buildEnv_
  - _Depends: 2.2_

- [x] 3.2 自包含产物完整性集成校验
  - 执行「构建 + 收尾」后，断言产物内服务端入口、静态资源、公共资源、runner 引导脚本与被外置 agent SDK 的可执行入口均存在
  - 该校验直接守护「runner/pi-cli 子进程依赖须随产物分发」这一 P0 风险
  - 观察完成：集成测试在构建后通过，列出并确认上述关键文件存在
  - _Requirements: 4.1, 4.2, 4.3_
  - _Depends: 1.1, 1.2_

- [x] 4. Validation：端到端启动链路
- [x] 4.1 stub 模式启动链路 e2e 冒烟
  - 通过 CLI 以 stub 模式在随机端口启动自包含产物，等待就绪后用浏览器打开访问地址
  - 完成「页面加载 → 激活默认/选定 agent source → 发送消息 → 接收 stub 流式回包」闭环，结束后以信号停止进程
  - 同时覆盖参数/错误路径：帮助与版本零状态退出且有内容；未知参数非零退出且不启动服务器；产物缺失给出提示
  - 观察完成：e2e 跑出新鲜证据，stub 回包在页面可见，且参数/错误路径断言通过
  - _Requirements: 7.2, 1.3, 1.4, 3.1, 3.3, 4.4, 5.1, 5.2, 5.3, 6.1_
  - _Depends: 2.4, 3.2_

- [x] 4.2 真实子进程会话 e2e（凭据可用时）
  - 去除 stub，针对一个本地示例 agent 验证「选定 agent source → 发送 prompt → 接收真实子进程流式回复」闭环
  - 作为 runner/pi-cli 子进程依赖随产物分发（P0）的最终验证；无凭据/CI 环境可标记为条件跳过
  - 观察完成：在本机凭据可用时，真实会话流式回复在页面可见，证明自包含产物能拉起子进程运行时
  - _Requirements: 7.3, 4.2_
  - _Depends: 4.1_

- [x] 5. Watch 模式（增量）：agent source 变化时重载会话
- [x] 5.1 实现 --watch 选项与热重载门控放开
  - 解析 `--watch` 布尔选项
  - 当 source 为本地目录且提供 `--watch` 时，注入热重载启用信号与监视路径（指向绝对化的 source 目录）；source 为 git 来源时跳过并提示 watch 仅适用本地目录
  - 放开既有 runner 热重载门控，使该显式启用信号在 production standalone 下也生效；既有 dev 门控路径保持不变
  - 扩展单测：`--watch` 本地 source 注入正确 env；git source 跳过；无 `--watch` 不注入；门控在「显式信号 + production」下为真、二者皆缺省为假
  - 观察完成：单测通过；`pi-web <dir> --watch` 启动后 stderr 显示正在监视 source 目录
  - _Requirements: 8.1, 8.3, 8.4_
  - _Boundary: parseCliArgs, buildEnv, hotReloadGate_
  - _Depends: 2.2_

- [x] 5.2 watch 重载 e2e（凭据可用时）
  - `--watch` 非 stub 启动并激活真实会话，修改 agent source 的入口文件，断言出现 runner 热重载日志且会话续上对话，测试后还原被改文件
  - 观察完成：e2e 跑出新鲜证据——改文件后 runner 重启日志可见、会话上下文保留
  - _Requirements: 8.2_
  - _Depends: 5.1, 4.2_

- [x] 5.3 回合进行中重启安全（防流式/工具调用中断丢失）
  - 让热重载的「忙」判断覆盖回合进行中（agent_start..agent_end：流式 token / 工具调用 / 等待 extension_ui 应答），回合中请求重启延迟到回合结束，避免杀子进程致信息中断、丢失；仅靠待决命令判断不够（prompt 立即 ack、增量走 event 流）
  - 单测：回合中 requestRestart 不重启、回合结束后执行；空闲时立即重启；既有 rpc-channel 测试不回归
  - 观察完成：PiRpcProcess restart 单测通过（回合中延迟 + 空闲立即），dev 热重载同样受益
  - _Requirements: 8.2_
  - _Depends: 5.1_

- [x] 6. CLI 确定 source 直接进会话（autostart）
- [x] 6.1 autostart 信号链路与前端直接建会话
  - CLI 注入自动进会话信号；config 读取并暴露；首页透传给装配层；装配层在该信号下用默认 source 初始即创建会话（复用 resume 的「跳过选源直接进会话」机制），不显示选源页
  - 未设信号时仍显示选源页（默认不变）；自动进入的会话仍可经「切换源」返回选源页
  - 单测：CLI buildEnv 注入自动进会话信号
  - 观察完成：CLI 启动后页面不显示「Start a pi-web session」、直接进入会话（URL 落 `/session/:id`）；非 CLI 仍显示选源页
  - _Requirements: 9.1, 9.2, 9.3_
  - _Boundary: buildEnv, config.ts, page.tsx, chat-app.tsx_
  - _Depends: 2.2_
