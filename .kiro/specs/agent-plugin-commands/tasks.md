# Implementation Plan

## 1. 可安装来源枚举的端口化（基础）

- [x] 1.1 定义可安装来源枚举端口与记录类型 (P)
  - 新建端口模块，声明只读枚举契约：按「解析基准目录 + 前缀」返回候选记录，候选携带展示路径与可直接
    提交给安装命令的插入文本
  - 端口模块零 IO、零 pi-SDK 依赖，不引入对宿主状态端口、会话存储或 HTTP 类型的依赖
  - 在 extensions 子域的 barrel 中导出端口类型
  - 完成态：类型检查通过，端口模块可被服务端 barrel 重导出且不引入新的运行时依赖
  - _Requirements: 8.1, 8.6_
  - _Boundary: InstallSourceProvider_

- [x] 1.2 把现有按会话目录的浅层扫描迁为端口的本地实现
  - 将标志文件判定、扫描深度与条数上限、噪声目录跳过、符号链接越界防护整体搬入本地实现，行为逐条保持
  - 深度与条数上限暴露为可选构造参数，仅供测试覆盖，默认值与迁移前一致
  - 补单测对拍四项行为：标志文件命中、深度/条数上限、噪声目录跳过、realpath 越界不外泄
  - 完成态：本地实现的单测覆盖上述四项且全绿，扫描逻辑在路由文件中不再有第二份副本
  - _Requirements: 8.2_
  - _Boundary: ScanInstallSourceProvider_
  - _Depends: 1.1_

- [x] 1.3 来源枚举端点改为只经端口取数并支持注入
  - 端点保留会话查找与响应组装，去掉直接文件系统访问，改为调用注入的端口
  - 装配处在未注入自定义实现时默认构造本地实现，既有部署行为零变化
  - 端口调用失败或抛错时降级为空候选，不返回 5xx
  - 完成态：以桩实现注入的集成测试证明端点不触碰文件系统；桩实现抛错时端点返回空候选
  - _Requirements: 8.3, 8.4, 8.5_
  - _Boundary: install-sources 路由_
  - _Depends: 1.2_

## 2. host 命令层：由单一多态命令改为两条单态命令

- [x] 2.1 实现参数化命令工厂的解析层
  - 工厂以「承载类别」与其子动作集合为参数；agent 侧子动作为装/卸/列，plugin 侧另含更新
  - 裸命令、未知子动作、缺必需参数各自返回该命令专属用法文本，且不产生任何安装副作用
  - 出现类别覆盖选项时判为参数错误并给出「该选项已移除，请改用对应命令」的提示，不静默忽略
  - 用法文本点明直连来源在该命令下按命令名所指类别处理
  - 完成态：解析层单测覆盖两条命令的全部子动作与四类参数错误，且错误路径下 installer 零调用
  - _Requirements: 1.1, 1.5, 1.6, 2.1, 2.6, 3.4_
  - _Boundary: PackageHostCommandFactory_

- [x] 2.2 实现工厂的门控、执行与生效分道
  - 门控顺序固定为：参数校验 → 管理员判定（拒绝则失败结果 + 审计）→ 委托安装子域（白名单拒绝装饰为
    对应放行指引 + 审计）→ 结果组装
  - 调用安装子域时恒以命令自身的类别作为类别提示，运行期不可被 argv 改写
  - agent 通道成功恒产出面板刷新效果与选择器切换指引，不重载会话；plugin 通道在装/卸/更新成功时恰
    重载一次会话
  - 本地来源解析基准优先取会话工作目录，装配值仅兜底
  - 一切输出面（结果标识、审计事件、错误消息）使用脱敏副本，回归样本包含「带凭据的来源串作为输入本身」
  - 完成态：单测证明 agent 成功路径 reloadRunner 零调用、plugin 成功路径恰一次调用，且脱敏样本下
    结果与审计均不含凭据
  - _Requirements: 1.2, 1.3, 1.4, 1.7, 2.2, 2.3, 2.4, 2.5, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: PackageHostCommandFactory_
  - _Depends: 2.1_

- [x] 2.3 内置命令词条改为两条 (P)
  - 删除原单一安装词条，新增两条服务端动作型词条，均为仅用户可见，且都声明同一个安装结果数据部件名
  - 完成态：词条集合的快照/单测显示两条新词条存在、旧词条不存在，结果部件名保持不变
  - _Requirements: 1.1, 2.1, 3.1_
  - _Boundary: BuiltinCommands_

- [x] 2.4 装配层注册两条命令并摘除旧执行器
  - 装配层由工厂构造两个 handler 并一并注册；两者共用同一审计转发实例与同一安装子域实例
  - 删除旧的单一执行器文件及其在装配层的引用，确保命令面不再注册旧命令名
  - 完成态：服务端命令列表的集成测试显示两条新命令在列、旧命令不在列
  - _Requirements: 3.1, 3.2, 3.3_
  - _Boundary: pi-handler 装配层_
  - _Depends: 2.2, 2.3_

## 3. 命令面板的分道补全

- [x] 3.1 收敛参数类型取值域并引入子动作说明键 (P)
  - 参数类型由「遗留扩展项 / 本地来源 / 合并候选」改为域感知的「本地来源 / 已装 agent / 已装 plugin」
  - 子命令规格新增可选的说明文案键；命令面板渲染候选说明时优先取字典翻译，缺省回退既有占位符形态
  - 完成态：类型检查通过；面板在提供说明键时渲染中文说明、未提供时仍渲染占位符，二者各有单测
  - _Requirements: 4.6_
  - _Boundary: CommandArgSpec, PiCommandPalette_

- [x] 3.2 实现按域分道的参数补全 provider
  - 单个 provider 同时认两条命令，各自返回独立的子动作规格，候选集互不混入
  - 候选来源按设计的映射表分道：两条命令的装操作取本地来源；agent 卸载取已装 agent 源；plugin 卸载与
    更新取已装 plugin；列出为终态无候选
  - agent 候选的插入文本只含标识本身，删除历史遗留的类别参数拼接
  - 取数失败或非成功响应一律降级为空候选
  - 完成态：provider 单测证明两条命令各打对应端点、agent 候选插入文本不含类别参数、失败响应返回空数组
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7_
  - _Boundary: PackageArgProvider_
  - _Depends: 3.1_

- [x] 3.3 补齐两条命令的中英文案
  - 为两条命令的每个子动作各补一条中文说明与对应英文说明，中英字典同时补齐
  - 完成态：字典单测或类型约束证明两侧键集合一致，无单侧缺失
  - _Requirements: 4.6, 5.4_
  - _Boundary: i18n 字典_
  - _Depends: 3.1_

- [x] 3.4 前端装配接线切换到新 provider
  - 聊天容器改为构造新 provider；包 barrel 的导出名一并更新，删除旧工厂导出
  - 结果卡片渲染器与其数据部件注册保持不动，验证卡片仍能标明本次操作的类别与子动作
  - 完成态：容器层单测显示两条命令均能触发补全与结果卡片，且旧 provider 导出已不存在
  - _Requirements: 5.1, 5.2, 5.3_
  - _Boundary: PiChat 装配, packages/ui barrel_
  - _Depends: 3.2, 3.3_

## 4. 验证与迁移

- [x] 4.1 迁移并重组既有单测资产
  - 原 host 命令单测按两条命令重组；原 provider 单测改测新分道；新增一条断言旧命令名不在可用命令列表的
    回归用例
  - 完成态：迁移后的单测文件全绿，且不存在仍以旧命令名为主语的遗留用例
  - _Requirements: 7.1, 7.2, 7.3_
  - _Depends: 2.4, 3.4_

- [x] 4.2 迁移端到端用例
  - 原安装命令 e2e 与子命令补全 e2e 改以两条新命令覆盖：子动作候选带中文说明、装操作出现本地候选、
    提交后出现结果卡片且源选择器可见新源、plugin 侧含更新子动作、列出为终态
  - 新增一条 e2e 断言命令面板中不再出现旧命令候选
  - 完成态：两个 e2e 文件在浏览器套件中通过，且断言不依赖默认语言以外的假设
  - _Requirements: 7.4, 3.2_
  - _Depends: 4.1_

- [x] 4.3 全测试面复跑与收口
  - 按仓库的多测试面分别复跑：根测试面、服务端子包、UI 子包，以及浏览器 e2e 套件
  - 完成态：各测试面均给出通过计数的新鲜输出，无跳过项被当作通过
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Depends: 4.2_

- [x] 4.4 补 registry 取数的真实 HTTP e2e
  - 假 cloud + 假 registry 夹具收进 e2e 夹具目录:实现登录、capabilities、registry 三端点,
    并提供请求审计端点供用例断言链路真的走过
  - 新增第六套 webServer(pi-web + 假 cloud 两个进程)与专用 project;落盘隔离到空临时目录,
    使列表中出现的条目只可能来自 registry
  - 用例覆盖:登录后 REST 面并入 registry 源且 plugin 条目被过滤、`/agent list` 卡片列出远端源、
    未登录时 registry 条目不出现
  - 完成态:该 project 的 e2e 全绿,且相邻 project(fs/install/login)不受影响
  - _Requirements: 7.4_
  - _Depends: 4.2_

## Implementation Notes

- **`kindHint` 恒传的连锁反应**(任务 2.2 → 4.2):命令锁定类别后,一个本地 component 包会被
  `/agent install` 当 agent 装进源根,绕过既有的 component 拒绝门。修正落在
  `server/cli/install/installer.ts` 的 `determineKind()`:本地来源已读到的 `kind === "component"`
  压过 `kindHint`(真实判据优先于提示)。该改动超出 design 原先的 Out of Boundary,已在 design.md
  显式修订并在 research.md §7 记录成因。由 e2e 抓到,单测未覆盖——因为单测的 installer 是替身。
- **`/agent list` 的数据源**(任务 2.2):CLI 的 `AgentChannel` 只有装/卸,没有列举能力,故由装配层
  注入 `listAgentSources`,接既有的 agent 源枚举 provider(与 `GET /agent-sources` 同一实例)。
  未注入时如实返回 `AGENT_LIST_NOT_SUPPORTED`,不假装空列表。
- **registry 取数此前只有替身覆盖**(任务 4.4):`registry-http-provider` / `hybrid-agent-sources`
  两个单测都注入 fetch 替身,`desktop-cloud-login` e2e 又把 egress base 指向不可达占位地址 ——
  「登录之后真的能从 registry 取到源」这件事没有任何端到端证据。第六套 webServer 补上了这段。
  两个坑:①playwright 按 CJS 转译 config,`import.meta` 直接语法错,路径一律走 `process.cwd()`;
  ②host 命令的执行类动作**含只读的 list** 也过 adminGate,webServer env 漏 `PI_WEB_EXT_ADMIN_ALLOW_ANY`
  会得到 ADMIN_DENIED 卡片而不是列表。
- **worktree 缺 gitignored 产物**:`examples/*/.pi/web/dist` 是构建产物且被 gitignore,新 worktree
  首次跑根测试面会有 3 个 webext 用例失败;跑一次 playwright(其 globalSetup 幂等重建 dist)后即绿。
  定责手法:同一用例在主仓对照跑。
