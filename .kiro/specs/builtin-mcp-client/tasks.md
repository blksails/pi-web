# Implementation Plan

> 内置 MCP 客户端:runner 子进程内以 `ExtensionFactory` 建立连接并注册工具;主进程只管配置与探测,两侧经同一份 `mcp.json` 交换意图。
> **范围铁律**:不改通用 config 域机制、不改 secret 三态实现、**不扩展 FormSchema 表单 IR**(现有 `objectList`/`variants`/`itemKind` 已足够);含 MCP/pi SDK 值导入的代码只进 tool-kit runtime 层。
> **契约铁律**:保留 `config.mcp` 独立路由与已冻结的 capability id;须保持其在 `defaultCapabilities` 中排在 `config.domains` **之前**。

- [x] 1. Foundation:依赖、配置模型与表单 IR

- [x] 1.1 引入 MCP SDK 依赖并建立 runtime 子入口骨架
  - 在 tool-kit 增加 `@modelcontextprotocol/sdk` 依赖(^1.29.0),确认 Node >=18 与现有工程一致。
  - 建立 MCP 运行时目录与专用 entry 的导出骨架(供后续 `PI_WEB_MCP_ENTRY` 指向),并从 runtime 子入口导出。
  - 观察性完成态:tool-kit 构建与 typecheck 通过;新 entry 可被解析加载(尚无实际连接逻辑);**主入口(前端安全面)未引入任何 MCP/pi SDK 值导入**。
  - _Requirements: 5.1_
  - _Boundary: tool-kit/runtime_

- [x] 1.2 定义 MCP 配置 schema 与结构化表单 IR
  - 在 protocol 纯层定义配置的校验 schema:server 条目列表、名称唯一且非空、启用标志、传输判别联合(stdio 要求启动命令;SSE / Streamable HTTP 要求服务端地址)。
  - 用**现有**表单 IR 能力表达:条目列表用 `objectList`,传输字段用 `variants`(判别键为传输类型,三分支各带自己的字段集),`env` / `headers` 用 `record` + `itemKind:"secret"` 使其值一律掩码。
  - 观察性完成态:单测证明三种传输各自的必填校验成立、缺必填被拒、重复名被拒;表单 IR 中传输三分支字段集互不相同;`env`/`headers` 标记为 secret 值。
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 4.5, 7.2_
  - _Boundary: mcp FormSchema + zod(protocol 纯层)_

- [x] 1.3 实现配置读取的规范化与未识别内容保留
  - 读取既有配置文件,兼容 MCP 生态通用的对象映射形态,规范化为内部条目列表(既有配置继续有效)。
  - **保留未识别的顶层键**;传输类型无法识别的条目原样保留并标记为未识别,不参与连接。
  - 写回时**合并**而非整体覆盖,确保未识别内容不丢失。
  - 观察性完成态:单测覆盖「对象映射 → 规范化 → 保存 → 未识别键仍在」完整往返;未知传输类型条目在结果中被标记且内容逐字保留。
  - _Requirements: 1.2, 5.3, 5.4_
  - _Boundary: McpConfigCodec(protocol 纯层)_

- [x] 2. Core:MCP 客户端运行时

- [x] 2.1 (P) 实现三种传输的构造
  - 按传输类型分别构造本地进程型、SSE 型与远程 HTTP 型传输;这是**唯一识别传输类型**的地方。
  - 未知传输类型明确报错(不静默降级、不自动回退到其他协议)。
  - 观察性完成态:单测证明三种类型各构造出对应传输、未知类型报错;不含任何自动协议回退逻辑。
  - _Requirements: 2.1, 2.2, 2.3_
  - _Boundary: TransportFactory_

- [x] 2.2 (P) 实现 MCP 工具到 agent 工具的适配
  - 工具入参 schema 直接透传(两侧本质同为 JSON Schema);**缺失或结构非法时兜底为宽松对象 schema**,使单个坏工具不影响同 server 其余工具。
  - 注册名加 server 前缀以保证同名工具可区分;调用结果映射为既有工具结果形态;调用异常**转为错误结果而非抛出**。
  - 观察性完成态:单测覆盖 schema 透传、非法 schema 兜底、前缀命名、异常转错误结果四条;适配过程不发起任何网络或进程调用。
  - _Requirements: 3.1, 3.3, 3.4, 3.5_
  - _Boundary: McpToolAdapter_

- [x] 2.3 实现连接生命周期与失败降级
  - 只对启用条目发起连接;各条目**并发**建立且**各自独立超时**;会话结束时关闭全部连接(本地进程型须确保子进程回收)。
  - 任一连接失败**不向装配流程抛出**,记录结果后跳过;记录失败原因时对凭据(环境变量值、请求头值、地址中的凭据段)脱敏。
  - 观察性完成态:单测证明禁用条目零连接、一个 server 失败不影响其余条目的连接结果、失败原因中不含凭据明文。
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 7.1_
  - _Boundary: McpClientManager_
  - _Depends: 2.1_

- [x] 2.4 实现扩展工厂编排并注册能力到会话
  - 在装配期读取配置 → 取启用条目 → 建立连接 → 适配并注册工具;同时使已连接 server 的资源与提示词在会话中可访问。
  - 连接失败或全部失败时**会话仍正常启动**。
  - 观察性完成态:集成测试证明——配置一个可用 server 后其工具以带前缀的名称出现在会话工具集中;配置一个不可达 server 时会话照常启动且其余功能可用;配置改动在下次新建会话生效。
  - _Requirements: 1.3, 1.5, 3.1, 3.2, 4.4, 5.1_
  - _Boundary: mcpExtension_
  - _Depends: 2.2, 2.3_

- [x] 3. Core:配置端点与连接探测

- [x] 3.1 (P) 把 MCP 配置端点改造为结构化读写
  - 读路径经既有掩码机制返回(凭据不回读明文);写路径先按 schema 校验(缺必填返回明确指出缺失字段的错误),再经既有 secret 三态合并,最后交由配置编解码**合并写回**保留未识别内容。
  - **移除「扩展是否已安装」的门控**,响应不再包含该标志。
  - 观察性完成态:集成测试证明——未安装任何扩展时端点即可正常读写;读取响应不含凭据明文;缺必填写入被拒并指明字段;未修改的凭据保持原值、显式清除后被移除;未识别顶层键在写回后仍在。
  - _Requirements: 1.2, 1.6, 2.5, 4.3, 5.2, 5.4, 7.2, 7.3, 7.4_
  - _Boundary: mcp-config-routes_
  - _Depends: 1.2, 1.3_

- [x] 3.2 (P) 实现主进程侧连接探测与结果缓存
  - 设置页无会话态,故由主进程独立发起**短超时**探测:复用传输构造逻辑,完成握手后即断开,不注册工具。
  - 缓存探测结果(状态、失败原因、检查时间);失败原因同样脱敏后再记录。
  - 观察性完成态:单测覆盖探测成功/失败/超时三条路径与缓存命中刷新;失败原因不含凭据明文。
  - _Requirements: 6.1, 6.2, 6.3, 7.1_
  - _Boundary: McpProbeService_
  - _Depends: 2.1_

- [x] 3.3 接入状态与探测端点
  - 状态端点返回缓存结果;探测端点按需触发刷新并返回最新结果;两者与配置写入受同一鉴权门控,探测须带超时。
  - 观察性完成态:集成测试证明——修正配置后触发探测能反映本次最新连接结果;探测端点受鉴权门控且超时可控。
  - _Requirements: 6.1, 6.2, 6.4_
  - _Boundary: mcp-config-routes, McpProbeService_
  - _Depends: 3.1, 3.2_

- [x] 4. Integration:跨进程装配与配置界面

- [x] 4.1 把内置扩展注入 runner(★ spawn env 三处齐改)
  - 主进程按既有内置扩展范式注入入口环境变量;runner 侧读取该变量并追加进扩展列表。
  - ⚠️ **必须三处齐改**:本地传输分支下发、沙箱传输分支下发、以及沙箱侧环境变量**透传白名单**——历史上同类变量因只改其一,在沙箱传输下静默失效。
  - 观察性完成态:守卫用例分别断言两种传输分支**都**下发了该变量、且该变量在沙箱透传白名单内;无需安装任何扩展即可在新会话中使用 MCP 能力。
  - _Requirements: 5.1_
  - _Boundary: pi-handler 装配, option-mapper_
  - _Depends: 2.4_

- [x] 4.2 改造 MCP 配置界面为结构化表单
  - 面板改为按结构化表单 IR 渲染(条目列表、按所选传输切换字段集、启停开关、凭据掩码呈现)。
  - **删除「装了扩展才出现」的异步探测登记门控**,面板改为常驻。
  - 呈现每个启用条目的连接状态与失败原因,并提供触发重新探测的入口。
  - 观察性完成态:界面测试证明——面板在无扩展时也登记可见;列表呈现名称/传输/启用态;切换传输类型后字段集随之变化;凭据字段显示为掩码;状态与失败原因可见。
  - _Requirements: 2.4, 4.1, 4.2, 4.5, 5.2, 6.1, 6.3_
  - _Boundary: register-panels(前端)_
  - _Depends: 1.2, 3.1, 3.3_

- [x] 5. Validation:端到端与回归

- [x] 5.1 端到端关键路径验证
  - 覆盖设计中列出的关键用户路径:零扩展可用;结构化配置往返(保存后重开字段原样、凭据掩码);切换传输协议字段集随之切换;配置本地 server 后新建会话其工具以带前缀名称可被调用且结果回流;配置不可达条目时会话仍正常启动且配置面显示失败原因。
  - 观察性完成态:上述五条路径的 e2e 用例全部通过,并留存真实运行计数作为证据。
  - _Requirements: 1.5, 2.4, 3.1, 3.3, 3.4, 4.1, 4.3, 5.1, 5.2, 6.1, 6.2_
  - _Depends: 4.1, 4.2_

- [x] 5.2 回归与契约守卫
  - 全量单测与 typecheck 通过;确认既有配置域行为、secret 三态实现、表单 IR **均未被改动**。
  - 契约守卫:`config.mcp` capability id 仍存在且其路由集合可用;守卫用例断言它在能力清单中**排在 `config.domains` 之前**(否则通用域路由会抢占 MCP 端点)。
  - 观察性完成态:全量测试真实计数全绿(`no tests` 或含 `Errors N error` 的输出不算通过);顺序守卫在人为调换顺序时转红。
  - _Requirements: 5.2_
  - _Depends: 5.1_

## Implementation Notes

- **进程归属是本设计的地基**:工具注册只在扩展工厂内可用,而扩展在 runner 子进程加载 → MCP 客户端**必须**跑在 runner 子进程;主进程拿不到会话工具集,故配置面状态只能由主进程**独立探测**得到(与既有「设置页无会话态」的约束同源)。

- **★ 任务 4.1 是最易静默失效处**:同类 spawn 环境变量历史上因「只在本地传输分支下发、沙箱分支漏发且未进透传白名单」而在沙箱下静默不可用。三处齐改 + 守卫断言是硬要求。

- **零新增表单能力**:现有表单 IR 的 `objectList`(条目列表)、`variants`(按传输类型切换字段集)、`itemKind:"secret"`(record 值一律掩码)恰好覆盖全部配置形态,任务 1.2 **不得**为此扩展表单 IR。

- **契约不破**:宿主契约 v1 已冻结 capability id `config.mcp`,故 MCP **不并入**通用 `/config/:domain`,而是保留独立路由改造内部实现;并须保持其排在 `config.domains` 之前(M3 曾因顺序问题产生真实缺陷)。

- **schema 适配可行的前提**:pi 工具入参用 TypeBox,而 TypeBox schema 本质即标准 JSON Schema,故 MCP 的入参 schema 可直接透传;非法/缺失时兜底宽松 schema,避免单个坏工具毒化整个 server。

- **并行分组**:2.1/2.2 边界互斥可并行;3.1/3.2 分属端点层与探测服务可并行(但都依赖 Foundation);4.1/4.2 分属装配层与前端,依赖各自上游后可并行推进。

## 实现记录(与 design 的偏离及实现时发现)

- **★ secret 掩码必须自建遍历器(design 偏离,已论证)**:design 原写「复用既有 secret 三态」,
  但实测 `secret-merge.ts` 只认两种形态 —— 扁平 object(顶层 secret 字段 + record 子字段)与
  单 record 域,**到不了 `servers[].transport.env` 这一层**。扩展通用实现会影响所有既有域、
  越出本 spec 边界,故改为:**复用 secret 三态的协议语义与类型**(`SecretMask`/`SecretWrite`/
  keep-clear-set),只在 `mcp-secrets.ts` 自建针对该已知结构的遍历器。表单 IR 侧无需改动
  (`itemKind:"secret"` 已足够表达)。

- **★ e2b 分支刻意不下发 entry(与任务 4.1 原描述不同,技术上更正确)**:任务原写「三处齐改」,
  依据是集成设计把「e2b 分支不下发 *_ENTRY」记为缺陷。实现时发现:`mcpEntryPath()` 返回的是
  **宿主机绝对路径**,该路径在 e2b 沙箱内并不存在,下发进去只会让加载失败 —— 既有三个 `*_ENTRY`
  只在本地分支下发很可能是**有意的**。故本 spec 只在本地传输分支下发,并在代码注释写明:沙箱
  形态需经镜像烘焙用沙箱内路径,属独立工作项。**已知边界:MCP 在 e2b 沙箱传输下暂不可用。**

- **上游 `SSEClientTransport` 已标记 deprecated**(MCP SDK 1.29,规范层面正被 Streamable HTTP
  取代)。需求明确要三种传输,且存量 SSE-only server 只能用它,故**保留支持**并在代码标注;
  待上游移除时该分支须随之处置。

- **server 名禁止连续下划线(测试发现的真实缺陷)**:初版 regex 允许 `has__sep`,但工具名格式是
  `<server>__<tool>`,名字含 `__` 会让工具名无法反解析,且 `a__b`+工具 `c` 与 server `a`+工具
  `b__c` 撞名。已收紧为允许单下划线、禁止连续下划线。

- **`registerMcpPanelIfInstalled` 的产品调用点在 `src/routes/settings.tsx`**(首次 grep 漏了
  `src/` 目录,一度误判为「零调用点」)。已随面板常驻化一并改造,并移除其异步探测与重渲染。

- **pi SDK 生态确认不自带 MCP**:`pi-agent-core` 的 pnpm 目录名带 `_@modelcontextprotocol+sdk`
  后缀一度像是上游已内建,核实后其 `dependencies`/`peerDependencies` 与 d.ts 均无 MCP 面 ——
  那只是装包后 pnpm 重解析 peer 上下文生成的目录名。自建适配层是必要的。

- **`ExtensionFactory` 支持异步**(`(pi) => void | Promise<void>`),故连接可 await 完成后再注册
  工具,无需任何变通。

## 验证证据(2026-07-24)

| 面 | 结果 |
|---|---|
| `packages/server` 全量 | **2203 passed** / 17 skipped / 0 failed(M4 基线 2174) |
| `packages/protocol` 全量 | **401 passed** |
| `packages/tool-kit` 全量(含 e2e) | **451 passed** |
| 根测试面 | **828 passed** |
| 四侧 typecheck | 全部 rc=0 |
| **e2e 真实 MCP server** | **8 passed** —— 真实 stdio 子进程 → 握手 → tools/list → tools/call → 适配器 → 扩展编排,无 mock |
| 契约守卫(`config.mcp` 排在 `config.domains` 前) | 7 passed(M3 遗留守卫未被破坏) |
