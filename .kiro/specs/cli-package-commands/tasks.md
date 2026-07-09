# Implementation Plan

> **两个波次**：任务 1–6 为 **Wave 1**，不依赖注册表，可独立实现与验证。
> 任务 7–10 为 **Wave 2**，阻塞于 pi-clouds 仓 `specs/registry-package-kind/` 的三处加法
> （`kind` 判别式放宽 `entry` 必需、`npm` origin、`public` visibility）与其决策 9
> （`registry-client` 分发形态）。
>
> **跨仓前置条件（任务图无法表达，实施前须人工确认）**：
> - 任务 1.1 登记的跨仓类型解析路径、任务 8.2 的签名与规范化纯函数、任务 7.1 与 10.2 的
>   进程内契约夹具，**均要求 `@pi-clouds/registry-client` 的源码或包在本机可解析**。
>   若该兄弟仓未 checkout 且分发形态未定，Wave 2 全组无法编译——这不是"编译逻辑不阻塞"。
> - Wave 1（任务 1–6）不触碰上述任何一项，可在跨仓事项悬而未决时全程推进。

---

- [ ] 1. Foundation：构建接缝与共享装配

- [x] 1.1 建立子命令实现的第二构建产物与动态加载接缝
  - 复用现有 esbuild 配置的别名插件、banner 与 external 列表，新增一次构建产出子命令实现入口
  - 产物必须落在产物根，与既有服务器入口同级（路径解析在打包器内联后回退当前工作目录）
  - 打包脚本在产物校验阶段断言该产物存在，与既有服务器入口的校验同处
  - 本任务不引入任何跨仓依赖；注册表客户端的解析路径登记归 7.1（Wave 2）
  - 观察态：`pnpm build:dist` 后产物根同时存在服务器入口与子命令入口两个文件；CLI 壳可动态加载后者并调用其导出函数
  - _Requirements: 10.6_

- [x] 1.2 实现共享的运行上下文与进度报告器
  - 运行上下文集中解析工作目录、pi 配置目录、agent 源根，供各子命令注入而非各自读取环境变量
  - 进度报告器以阶段性事件（开始 / 完成 / 失败）输出可读进度
  - 错误渲染统一走脱敏路径：不输出凭据、令牌或完整环境变量内容
  - 向子进程传递环境变量时只传该子进程所需变量，不透传调用者完整环境
  - 观察态：单测注入一个含伪造凭据的环境后触发失败路径，捕获的输出中不含该凭据
  - _Requirements: 3.10, 3.11, 10.2, 10.3_

---

- [ ] 2. 子命令分发层

- [x] 2.1 扩展参数解析为子命令判别，并保持既有启动路径不变
  - 判别首个位置参数是否为已知子命令名；不是则产出既有启动意图
  - 各子命令拥有独立选项表，一个子命令的专属选项不被其他子命令接受
  - 顶层帮助列出全部子命令及一句话说明；子命令帮助输出其专属用法并以零退出码结束
  - 非法选项抛出用法错误，打印选项名与查看帮助的提示，以非零退出码结束且无任何文件系统或网络副作用
  - 解析全过程为纯函数，可在不触碰文件系统与网络的前提下被单测覆盖
  - 观察态：对不以子命令名开头的参数，解析结果与本特性引入前逐字段一致（由既有 CLI 单测继续通过佐证）
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 10.1_

---

- [ ] 3. create：骨架创建

- [x] 3.1 (P) 实现模板目录枚举
  - 从随包分发的示例目录枚举可用模板，读取其展示元数据（标题、描述、图标）
  - 模板来源是打包脚本既有的示例目录拷贝行为（`scripts/pack-dist.mjs` 已将 `examples/` 拷入产物），本任务只消费该产物，不新增拷贝步骤
  - 列出模板时以零退出码结束且不创建任何文件
  - 指定的模板名不存在时，报错并附可用模板名清单
  - 观察态：`pi-web create --list` 输出的模板条数与示例目录中带展示元数据的目录数一致
  - _Requirements: 2.4, 2.5, 2.6_
  - _Boundary: TemplateCatalog_

- [x] 3.2 实现骨架写入与身份重写
  - 按包类型生成骨架；未指定包类型时以 agent 为默认
  - 写出的包清单**显式**包含包类型字段，不依赖清单格式的缺省值
  - 重写包名为用户提供的名称，移除模板自带的私有包标记，补齐 pi 生态用于发现包的关键字
  - 目标目录已存在且非空时拒绝写入，不修改其中任何既有文件
  - 完成后输出生成物绝对路径与下一步命令提示
  - 观察态：生成目录中的包清单可被清单格式校验通过，且其包类型字段为显式写出的字面值
  - _Requirements: 2.1, 2.2, 2.3, 2.7, 2.8, 2.9, 2.11_
  - _Depends: 3.1_
  - _Boundary: ScaffoldWriter_

- [x] 3.3 验证生成物可直接运行
  - 以生成的目录作为 agent 源启动本地实例，确认无需在骨架内额外安装依赖
  - 观察态：启动后实例就绪并可进入会话；骨架目录中不存在依赖安装产物
  - _Requirements: 2.10_
  - _Depends: 3.2_

---

- [ ] 4. 安装通道

- [x] 4.1 (P) 实现本地来源登记表的写入
  - 读改写既有的来源登记文件，登记与除名扫描根之外的本地目录
  - 只拥有写入语义；读取与列表呈现归既有的来源提供者，不改动其行为
  - 不放宽既有的实路径安全门控
  - 写入保留文件中的未知字段；重复登记同一来源不产生重复条目
  - 登记前校验目标存在且为有效包目录，否则报错并以非零退出码结束
  - 观察态：登记后再次读取该文件，条目存在且原有未知字段完好；重复登记后条目数不变
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - _Boundary: LocalSourceRegistry_

- [x] 4.2 (P) 实现来源形态判别与直连来源校验
  - 依据实参形态判别其为直接来源还是注册表包标识；判别规则在子命令帮助中说明
  - 直接来源经既有的来源白名单纯函数校验；来源类型不被允许或版本/引用未固定时拒绝
  - 拒绝时不下载或执行任何第三方代码
  - 观察态：带前缀、协议头、路径形态的实参判别为直接来源，裸标识判别为注册表标识；白名单拒绝路径下无任何网络请求发生
  - _Requirements: 3.4, 8.1, 8.2_
  - _Boundary: SourceResolver_

- [x] 4.3 (P) 实现 plugin 通道的安装、卸载与列出
  - 复用既有的 pi 子进程适配器与参数装配，以非交互方式执行安装，不自动信任项目本地配置文件
  - 安装成功后包被记入 pi 的来源台账；卸载时从台账除名并输出被移除的包标识
  - 卸载一个未安装的包时输出未安装提示并以非零退出码结束
  - 观察态：注入子进程替身后断言安装调用的参数为 pi 的非交互安装形态；卸载后台账中不再含该标识
  - _Requirements: 3.5, 3.7, 3.8, 3.9_
  - _Boundary: PluginInstaller_

- [x] 4.4 实现 agent 通道的自建落盘
  - pi 的包管理只能落到其自身配置目录或项目目录，无法落到 agent 源根，故本通道自建落盘
  - git 来源浅克隆到不可变引用；npm 来源获取发布产物后本地解包
  - 两种来源均只解包，不执行包内任何安装脚本
  - 本地路径来源委托本地来源登记表登记，不拷贝目录
  - 落盘失败时回滚已写入内容，不留半成品目录
  - 观察态：安装一个 agent 后其目录出现在 agent 源根之下；安装一个本地路径 agent 后源根之下无新目录而登记文件新增一条
  - _Requirements: 3.6, 3.12_
  - _Depends: 4.1_
  - _Boundary: AgentInstaller_

- [ ] 4.5 集成：按包类型分派安装通道并落实作用域语义
  - 两条通道实现同一安装端口，由包类型选择，调用方不感知通道差异
  - 未指定作用域时以用户级作用域安装；显式指定时以项目级作用域安装
  - 项目级作用域下项目未被信任时，输出含信任指引的可操作错误并以非零退出码结束，不安装任何内容
  - **必须把 `PI_WEB_EXT_ALLOW_NPM` 接进传给 `resolveSource` 的白名单配置**（映射为 `allowAnyNpm`）。
    否则 `DEFAULT_ALLOWLIST.npmScopes` 只含 `@pi-web`/`@earendil-works`，CLI **装不了任何第三方 npm 包**。
    4.2 只放开了 `allowLocal` —— 本地路径信任（读一个你已控制的目录）与供应链信任（按名字从网络抓包）
    是两类风险，不可用同一条「CLI 用户即 admin」的理由一并放开
  - **npm/git 来源的 `kind` 在下载前是占位值 `"agent"`**（4.2 无从得知真实值），分派前必须由通道在解包后
    重新判定，**不得直接信任 `ResolvedSource.kind`**；只有本地路径来源的 `kind` 是真实读自 `pi-web.json`
  - 观察态：同一条安装命令对 agent 与 plugin 两类包分别落到各自目标位置，且调用方代码路径相同
  - _Requirements: 3.1, 3.2, 3.3_
  - _Depends: 4.3, 4.4_
  - _Boundary: Installer, AgentInstaller, PluginInstaller_

---

- [ ] 5. list 与 update

- [ ] 5.1 实现已安装包的列出
  - 输出已安装包的标识、版本或引用、作用域与包类型
  - 无任何已安装包时输出明确提示并以零退出码结束
  - 支持只列出存在可用更新的包，并对每一项标明当前版本与可用版本
  - 与 4.3 同属 plugin 通道组件，二者串行推进，不并行（避免同一组件的并发改写）
  - 观察态：在无已安装包的干净配置目录下命令以零退出码结束且输出明确的空状态提示
  - _Depends: 4.3_
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: PluginInstaller_

- [ ] 5.2 实现包更新与部分失败汇总
  - 未指定包名时更新全部可更新的包；指定包名时只更新该包
  - 不更新被固定到精确版本或不可变引用的包，并在输出中标明跳过原因
  - 某个包失败时继续处理其余包，结束时汇总列出失败项及原因并以非零退出码结束
  - 观察态：构造一个含固定版本包与一个会失败包的场景，命令处理完全部包、输出跳过原因与失败汇总，且退出码非零
  - _Requirements: 4.4, 4.5, 4.6, 4.7_
  - _Depends: 5.1_
  - _Boundary: PluginInstaller_

---

- [ ] 6. Wave 1 集成与离线验证

- [ ] 6.1 集成：将全部 Wave 1 子命令接入分发层
  - create、install、uninstall、list、update 经分发层可被调用并返回统一的退出码语义
  - 任一子命令成功以零退出码结束，失败以非零退出码结束
  - 观察态：逐个子命令的成功与失败路径各触发一次，退出码与预期一致
  - _Depends: 2.1, 3.2, 4.5, 5.2_
  - _Requirements: 1.7_

- [ ] 6.2 编写离线端到端验证：创建、安装本地目录、源列表可见、卸载
  - 在无网络、无注册表的条件下完成：创建 agent 骨架 → 以其为源启动实例 → 安装该本地目录 → 源列表包含它 → 卸载 → 源列表不再包含
  - 沿用既有 CLI 端到端脚本的启动与断言范式
  - 观察态：脚本以零退出码结束，且其中「源列表包含该目录」与「卸载后不再包含」两条断言均基于真实端点响应
  - _Depends: 6.1_
  - _Requirements: 9.3, 9.4, 10.4_

- [ ] 6.3 回归护栏：既有 CLI 端到端与可重定位验证继续通过
  - 既有的 CLI 冒烟脚本继续通过，佐证既有启动路径逐字节不变
  - 既有的可重定位脚本继续通过，佐证新增产物在包被安装到任意路径后仍可被动态加载
  - 观察态：两个既有脚本在本特性改动后均以零退出码结束
  - _Depends: 6.1_
  - _Requirements: 1.1, 10.6_

---

- [ ] 7. Wave 2 基座：注册表端口

> 本组及其后的任务，其真实注册表交互阻塞于 pi-clouds 仓 `specs/registry-package-kind/`。
> 接口与编译逻辑不阻塞，可先以注册表侧交付的进程内契约夹具驱动。

- [ ] 7.1 登记跨仓依赖并定义注册表端口，接入契约夹具
  - 为注册表客户端登记类型解析路径、单测别名与打包器别名，使类型检查、单测与构建可解析其源码（Wave 2 全组的前置条件）
  - 端口接口在本仓定义，不向上层泄漏注册表客户端的具体类型
  - 解析、取发布者公钥、提交版本、移动发布通道四类操作以判别联合表达错误
  - 优先复用注册表侧交付的进程内契约夹具作为测试实现，而非自写替身
  - 观察态：以契约夹具为实现时，端口的四类操作均可在无网络条件下被单测调用并返回预期的成功与错误分支
  - _Depends: 1.1_
  - _Requirements: 10.5_
  - _Boundary: RegistryPort_

- [ ] 7.2 实现端口的 HTTP 适配器
  - 经注册表客户端实现端口；该客户端在构建期被内联进子命令产物，运行时零依赖
  - 注册表不可达或响应超时时，输出连接失败原因与所用注册表地址并以非零退出码结束
  - 注册表拒绝版本时，透出其返回的失败原因
  - 观察态：以一个不可达地址调用端口，得到携带该地址的不可达错误而非未捕获异常
  - _Depends: 7.1_
  - _Requirements: 7.5, 7.7_
  - _Boundary: HttpRegistryAdapter_

---

- [ ] 8. publish：编译、校验与提交

- [ ] 8.1 (P) 实现手写清单到发布清单的编译
  - 读取包根手写清单作为唯一事实来源；清单缺失或格式非法时逐条输出字段路径与原因并以非零退出码结束
  - 展开通配与排除模式，使发布清单只含确定文件列表、不含任何通配语法
  - 为每个被声明的产物文件计算内容完整性摘要
  - 声明的资源路径在磁盘不存在时输出缺失路径并以非零退出码结束，不生成发布清单
  - **显式写出**包类型字段，不依赖手写清单或注册表任一侧的缺省值
  - 编译产物不写入包的源码目录
  - 观察态：对一个声明了排除模式的包，编译产出的文件列表中不含被排除文件，且列表中无任何通配字符
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.11_
  - _Boundary: ManifestCompiler_

- [ ] 8.2 实现发布清单签名与私钥读取
  - 以用户显式指定位置的私钥签名，签名覆盖除签名字段自身外的全部规范化内容
  - 签名与规范化必须调用注册表侧提供的纯函数，不得自实现（字节漂移会导致服务端验签失败）
  - 私钥缺失、不可读或格式非法时，输出如何提供私钥的指引并以非零退出码结束，不生成发布清单、不发起任何外部写操作
  - 任何输出中不回显私钥内容
  - 观察态：以一把测试私钥签名后，用注册表侧的验签纯函数对同一清单验签通过
  - _Requirements: 5.8, 5.9, 5.10_
  - _Depends: 8.1_
  - _Boundary: ManifestCompiler_

- [ ] 8.3 (P) 实现打包硬约束校验
  - pi 运行时自带的核心包必须声明为对等依赖且版本范围为任意版本；出现在普通依赖中即违规
  - 核心包被列入随包分发的依赖即违规
  - 其他 pi 生态包未被列入随包分发的依赖即违规
  - 手写清单声明了 web 扩展产物目录而该目录不存在或为空时报错
  - 消费 8.1 产出的编译结果类型（单次磁盘遍历的产物），故需其类型先落地；与 8.4 边界不重叠，可并行
  - 观察态：对四种违规各构造一个包，校验器分别返回对应的违规码；对合规包返回空违规列表
  - _Depends: 8.1_
  - _Requirements: 6.3, 6.4, 6.5, 6.6_
  - _Boundary: DependencyRuleChecker_

- [ ] 8.4 (P) 实现资源入口投影与关键字补齐
  - 将手写清单声明的 pi 资源入口投影进包的依赖清单文件，使 pi 的包管理无需读取本仓专属清单即可发现这些资源
  - 确保包的关键字包含 pi 生态用于发现包的关键字
  - 观察态：投影后，包的依赖清单文件中出现与手写清单一致的资源入口声明，且关键字已补齐
  - _Requirements: 6.1, 6.2_
  - _Boundary: PackageProjector_

- [ ] 8.5 集成：编排编译、校验与提交
  - 依次执行编译、硬约束校验、投影、签名；任一校验失败必须在发起任何外部写操作之前终止，不留部分完成的发布状态
  - 演练模式下走完全部编译与校验、打印将被发布的清单与文件列表，且不向任何外部服务发起写操作，全部通过时以零退出码结束
  - 正式发布时提交版本，随后将发布通道指向新版本；通道名可指定，未指定时使用稳定通道
  - 用户指定只提交不移动通道时，提交成功后停止，不改变任何通道指向
  - 包身份不存在时输出创建指引；同一版本已存在时输出提示且不产生副作用；来源引用可变时拒绝提交并说明须使用不可变引用
  - 观察态：演练模式下以契约夹具断言端口的写操作方法零次被调用；正式模式下提交与移动通道各一次
  - _Depends: 7.1, 8.2, 8.3, 8.4_
  - _Requirements: 6.7, 6.8, 7.1, 7.2, 7.3, 7.4, 7.6, 7.8_
  - _Boundary: PublishOrchestrator_

---

- [ ] 9. 经注册表安装与完整性复核

- [ ] 9.1 扩展来源解析以支持注册表标识与本地验签
  - 判别为注册表包标识时，先解析得到其来源与已签名的发布清单
  - 用该包发布者的启用公钥在本地验证清单签名，通过后方可继续安装
  - 验签失败时拒绝安装、输出签名不可信的错误并以非零退出码结束，且不下载或执行任何第三方代码
  - 验签通过后将注册表返回的来源转换为安装所需的来源表示，交由既有安装路径落盘
  - 观察态：篡改夹具返回的清单一个字节后，安装在下载发生之前即被拒绝
  - _Depends: 4.2, 7.1_
  - _Requirements: 8.3, 8.4, 8.5, 8.6_
  - _Boundary: SourceResolver_

- [ ] 9.2 实现安装后完整性复核与回滚
  - 落盘完成后按发布清单逐项复核已安装文件的内容完整性摘要
  - 任一文件与清单不一致时输出不一致的文件路径、移除本次安装的落盘内容并以非零退出码结束
  - 观察态：在落盘后人为改写一个文件再触发复核，安装被回滚且目标目录恢复到安装前状态
  - _Depends: 9.1_
  - _Requirements: 8.7, 8.8_
  - _Boundary: IntegrityVerifier_

- [ ] 9.3 验证注册表不可达时的直连降级
  - 注册表不可达时，直接来源形态的安装、卸载、列出与更新保持可用
  - 观察态：将注册表地址指向不可达端点后，一条直连安装命令仍以零退出码成功完成
  - _Depends: 9.1_
  - _Requirements: 8.9_

---

- [ ] 10. Wave 2 集成与端到端验证

- [ ] 10.1 集成：将 publish 接入分发层
  - 6.1 只把 Wave 1 的五个子命令布线到分发层，publish 是全新子命令，其分发接缝尚不存在
  - 分发层识别 publish 并路由到发布编排器，解析其专属选项（私钥位置、演练模式、通道名、只提交不移动通道）
  - publish 的成功与失败遵循与其余子命令一致的退出码语义
  - 观察态：`pi-web publish --help` 输出其专属选项并零退出码结束；`pi-web publish --dry-run` 可被真实调用并抵达编排器
  - _Depends: 2.1, 8.5_
  - _Requirements: 1.2, 1.4, 1.7_
  - _Boundary: SubcommandRouter, PublishOrchestrator_

- [ ] 10.2 编写基于契约夹具的发布端到端验证
  - 借注册表侧交付的进程内契约夹具，在无真实注册表服务的条件下完成验证
  - 覆盖：演练模式打印清单且无写操作；正式发布经提交版本与移动通道两步；重复版本时报已存在且无副作用
  - 观察态：脚本以零退出码结束，且演练模式分支下夹具记录的写操作次数为零
  - _Depends: 10.1, 9.2_
  - _Requirements: 6.7, 7.6, 10.5_

- [ ] 10.3* 补充真实注册表的发布链路验证
  - 待 pi-clouds 侧注册表部署后补齐；标注为真机验证，不阻塞单测绿灯
  - 观察态：对真实注册表完成一次提交版本与移动通道，并能以该包标识安装回来
  - _Depends: 10.2_
  - _Requirements: 7.1, 7.2_

---

## Rules & Tips

- **`childEnv()` / `redact()`(`packages/server/src/extensions/cli/pi-cli.ts`）未导出**（模块私有），
  `server/cli` 层不能直接 import 复用。后续任务若需要子进程最小环境透传或脱敏，优先复用
  任务 1.2 已落地的 `server/cli/context.ts:buildChildEnv()` 与 `server/cli/reporter.ts:redactSecrets()`
  （同策略：白名单 `PATH`/`HOME` + `GIT_TERMINAL_PROMPT=0`/`CI=1`；脱敏正则同款），不要重复造轮子，
  也不要为了复用而扩大 `pi-cli.ts` 的导出面（超出各任务边界）。
- `CliContext.sourcesRoot` 是**单个写入目标目录**，与 `lib/app/pi-handler.ts` 的
  `resolveSourcesScanRoots()`（多根扫描语义）不是同一回事——`PI_WEB_SOURCES_ROOT` 在两处的语义
  不同（写入目标 vs 扫描列表），后续任务引用时注意别混淆。
- 全仓 vitest 默认 `jsdom` 环境；`test/cli/**` 涉及 `node:*` 内置（os/path/fs）的测试文件一律
  用 `// @vitest-environment node` per-file pragma，已有先例（`cli-commands-build.test.ts`、
  本任务新增的 `cli-context-reporter.test.ts`）。
- **脱敏覆盖面**：`redactSecrets()` 覆盖四类形态（URL 内联凭据 / 敏感键赋值（键值可带引号）/
  `Bearer`·`Basic` 令牌 / 已知前缀令牌字面量兜底）。基线 `pi-cli.ts:redact()` 只覆盖前两类，
  `Authorization: Bearer …`、JSON `"apiKey":"sk-…"` 与裸 `sk-…` 会漏网 —— 这三种恰是子进程与
  HTTP 客户端错误信息里最常见的泄漏形态，任务 1.2 的复核发现并已补齐。后续任务输出错误信息时
  一律经 `ProgressReporter.fail()`，不要自行 `console.error` 原始错误。
- **`parseCliArgs` 的判别字段是 `intent` 而非 design 初稿的 `kind`**，`run` 分支选项**扁平**而非嵌套
  `options`。design.md 已按实现修订。任务 6.1 接线时按 `intent` 写。
- **不要给 `bin/pi-web.mjs` 的 `parseCliArgs` 加精确的 `@returns` 联合类型**。`bin/` 不在 tsconfig 的
  `include` 内，该模块对 `test/**` 呈现为 `any`；一旦标注精确联合，既有 26 项 `cli-args.test.ts`
  断言必须先 narrow 才能访问 `.source`/`.port` —— 实测会新增 14 处 tsc 错误，且迫使改动那些断言，
  而「既有测试零改动且仍通过」正是需求 1.1 的证据本身。已在该函数 docstring 里写明缘由。
- `main()` 中 `intent === "subcommand"` 的分支当前打印「尚未接入」并返回 1，**那个 `if` 块就是任务 6.1
  接线 `dist/cli-commands.mjs` 的接缝**，其余部分无需改动。
- `bin/pi-web.mjs` 的 `SUBCOMMAND_SPECS` 选项表是面向 UX 的，与后续 `server/cli` 各子命令实际解析的
  选项是**两处**。3.x–9.x 任务若新增选项，必须同步更新该表，否则帮助文本与选项隔离行为会漂移。
- **路径推断一律外提为纯函数**：`TemplateCatalog` 的 `listTemplates(examplesRoot)` 只吃已解析好的目录；
  dev（仓库 `examples/`）与分发后（`dist/examples/`）的差异收敛到 `resolveExamplesRoot(candidates, exists)`。
  **候选列表的构造（`[join(distRoot,"examples"), join(repoRoot,"examples")]`）尚未落地**，归 create 接线任务
  （3.2 或 6.1）。这样做是因为 `import.meta.url` 会被 esbuild 内联后回退 `process.cwd()`（见任务 1.1）。
- 模板枚举对**坏 `package.json` / 非对象 `pi-web` 字段静默跳过**，不抛错也不报告。故 `create --template <坏目录>`
  只会表现为「模板不存在」，不会暴露解析错误 —— 接线任务若需区分二者，得另加诊断。
- 当前 29 个 examples **全部**带完整 `pi-web.title/avatar/description`，故缺字段回退路径（title→目录名、
  avatar→📦、description→""）只被合成 fixture 覆盖，真实模板树走不到。
- **复核者做 mutation 测试时不得用 `git checkout -- <file>`**：本 spec 的实现文件多为未提交的新文件，
  checkout 会连实现一起抹掉（已发生过一次）。正确做法是 `cp` 到临时处备份、验完 `cp` 回来。
- **`tsconfig.base.json` 没开 `noUnusedLocals`/`noUnusedParameters`**，死 import／未用变量**不会被 tsc 拦住**。
  只有 IDE 的 LSP 会报。提交前留意（3.2 就混进过一个未使用的 `PiWebManifestSchema` import）。
- `@blksails/pi-web-protocol` 可用**裸包名 import**，tsc 与 vitest 都能解析，无需新增 tsconfig paths 或
  vitest alias（它已 pnpm 符号链接进 `node_modules` 且有规范 exports）。这与 `tool-kit`／`canvas-kit`
  的子路径 exports 不同，后者必须显式登记 alias。
- `scaffold()` 与 `listTemplates()` 均把 `examplesRoot` 作为**入参**（调用方解析后注入）。dev（仓库
  `examples/`）与分发后（`dist/examples/`）的候选构造归 6.1 的 create 接线。
- **可选加固（未做）**：`scaffold()` 写盘前可用 `PiWebManifestSchema` 自校验合成的清单以 fail-fast。
  需求未要求，且会引入新错误码扩大 `ScaffoldError` 联合，故 3.2 未做。若模板自带的 `pi-web.json` 被改坏，
  当前会原样拷出而不报错。
- `template-catalog` 认定一个目录是模板的**必要条件是其 `package.json` 含 `pi-web` 字段**。写 fixture 时
  覆盖 `package.json` 若丢了该字段，`resolveTemplate` 会静默报 `TEMPLATE_NOT_FOUND`。
- **验证 e2e 退出码时不要用管道**：`node script.mjs | tail -5` 之后的 `$?` 是 `tail` 的退出码，
  不是脚本的。会把失败的脚本读成 EXIT=0。改用重定向到文件再 `echo $?`（或 `PIPESTATUS`）。
- **`dist/` 可能是「部分构建」**：只跑过 `build:server` 时只有 `server.mjs`+`cli-commands.mjs`，
  缺 `dist/client/`（`/` 路由会 500）与 `dist/examples/`。CLI e2e 前要校验**四件产物**齐全，
  不能只看 `server.mjs`。
- **e2e 判「实例就绪」不能只靠 `waitForReady()`**：它把任何 HTTP 响应都当就绪，**500 也算**。
  用 `GET /api/bootstrap` 断言 `200` + JSON 可解析（纯后端路由，不依赖前端产物）。
  已用 mutation 验过：把该断言指向不存在的路由，脚本正确失败并 exit 1。
- **`packages/server` 主入口(`@blksails/pi-web-server`)重导出 `probeEntry` / `EntryOverrideError`**
  （经 `src/index.ts` → `export * from "./agent-source/index.js"`，注释已明确标注该子模块只含
  node builtins + 只读探测、不含 pi SDK 值导入，可安全经 barrel 导入）。`server/cli` 层需要判定
  「某本地目录是否为一个能被 resolver/scan-provider 接纳的 agent 来源」时，直接从
  `@blksails/pi-web-server` 裸包名 import 这两个符号即可，不需要新增 tsconfig path/alias，也
  不算修改 `packages/server/**`（只读该文件、不改）。
- **「有效包目录」不等于「有 `package.json`」**：`probeEntry()`（`scan-provider`/`resolver` 共享
  的入口探测，也是 4.1 `LocalSourceRegistry` 复用的判据）对完全没有 `package.json` 的纯目录
  一样接纳（`kind: "none"` → cli 模式），只有 `package.json#pi-web.entry` 显式声明了一个不存在
  的入口文件时才抛 `EntryOverrideError`。这与 `TemplateCatalog`（`resolveTemplate`，要求
  `package.json` 含 `pi-web` 字段）是两种不同粒度的「有效」标准，后续任务凡涉及「这是否是一个
  可用的 agent 来源目录」都应对齐 `probeEntry` 这条线，而非误用模板判据。
- **写路径遇到坏 JSON 时的裁决**：既有只读 `RegistrySourceProvider` 对 `sources.json` 解析失败
  静默返回 `[]`（读操作，无副作用，安全）。但任何**写路径**（4.1 `LocalSourceRegistry` 起，后续
  任务若也要改写该文件）都不应照搬这个「静默」策略 —— 覆盖一份当前恰好损坏、但可能是用户或其他
  工具手写的文件会造成不可逆数据丢失。写路径应统一裁决为：解析失败即报错、不动原文件，把修复
  留给用户。
- **从 `@blksails/pi-web-server` barrel import `probeEntry` 是安全的，但脆弱**：`packages/server/src/index.ts:40`
  有明确承诺「agent-source-list 仅 node builtins + 只读探测，无 pi SDK 值导入，可安全经 barrel 重导出」。
  实测把 `local-source-registry` re-export 进产物后，`dist/cli-commands.mjs` 仅 +6KB 且 `@earendil-works`
  出现 **0 次**（esbuild tree-shake 只拉 `probeEntry` 依赖链）。⚠️ 该安全性依赖那条承诺持续成立 ——
  若日后 `agent-source/` 可达图谱里新增 pi SDK 值导入，pi SDK 会被打进 CLI 产物且**本 spec 的测试抓不到**。
  真正把它接线进 `server/cli/index.ts` 的任务（4.4/6.1）应补一次产物体积 + `grep -c @earendil-works` 回归门。
  注：`packages/server` 的 `exports` 只有 `.` / `./trust` / `./model-options` / `./vision-model-options`，
  **没有 `./agent-source` 子路径**，所以走 barrel 是当前唯一选择（加子路径要改 `packages/server/**`）。
- **「有效包目录」= scan-provider 会接纳的目录，不是「有 package.json」**：`probeEntry` 对**空目录**返回
  `{kind:"none"}` → scan-provider 判为 `cli` 模式并接纳。故 `registerLocalSource(<空目录>)` 返回 `ok:true`。
  这与既有语义一致（有意为之），但面向用户的文案不要把这类目录叫「无效包目录」。只有 `EntryOverrideError`
  才走错误分支。
- **坏 JSON 的读写不对称是有意的**：只读 provider 对坏 `sources.json` 静默返回 `[]`（无副作用）；
  写路径报 `REGISTRY_FILE_CORRUPT` 且**不覆盖**（避免不可逆地毁掉用户手写的文件）。后果是文件损坏时
  源列表静默变空、而登记被拒——接线任务的错误文案应把这层关系讲清楚。
- **`checkAllowlist()` 不识别无前缀的路径/host 简写语法**：它只解析 `npm:`/`git:`/`local:` 前缀、
  URI 协议头（`scheme://`）、scp 简写（`user@host:path`）——裸文件系统路径（`./x`、`/abs`、`~/x`）
  与裸 git host 简写（`github.com/u/r`，无前缀）都不在其解析范围内，会落入"unrecognized source scheme"
  拒绝分支。任务 4.2 的 `SourceResolver` 在调用它之前，对文件系统路径形态的直连实参做了一层归一化
  （展开 `~`、相对路径相对 `cwd` 绝对化、包一层 `local:<绝对路径>` 前缀）；但对裸 host 简写形态
  （命中 8.1 判别规则第 5 条、却没有 `git:`/协议头前缀）目前**原样传入**，会被 `checkAllowlist`
  拒绝——这是已知覆盖缺口而非 bug，后续任务若要支持这种形态，需在 `SourceResolver` 里再补一层到
  `git:<host>/<repoPath>@<ref>` 的归一化，而不是修改 `checkAllowlist` 本身（它是只读的既有纯函数，
  不在本任务边界内）。
- **`DEFAULT_ALLOWLIST.allowLocal` 是 Web 多用户面的默认值（`false`），CLI 场景需要另一份配置**：
  CLI 单用户本地进程的信任模型与之不同（调用者本就等价于本机管理员，与 design.md「本地 CLI 用户
  本就是 admin」一致）。任务 4.2 新增 `server/cli/install/source-resolver.ts` 导出的 `CLI_ALLOWLIST
  = { ...DEFAULT_ALLOWLIST, allowLocal: true }` 作为 `resolveSource()` 的默认配置——只放开本地路径
  这一项，不放宽 npm scope / git host 白名单或版本固定。后续任务（4.3/4.4/6.1 接线 `install` 子命令）
  应复用这份 `CLI_ALLOWLIST`，不要重新构造一份或改用 `DEFAULT_ALLOWLIST`（否则本地 agent 目录安装
  会被无声拒绝）。
- **`ResolvedSource.kind`（design.md 的 `via: "direct"` 分支）在 npm/git 来源未下载前无法确定**——
  design 对此没有说明，是一个缺口。任务 4.2 的裁断：本地路径读取目标目录的 `pi-web.json#kind`
  （用 `PiWebManifestSchema` 校验，缺失/非法时默认 `"agent"`）；npm/git 来源暂以 `"agent"` 占位，
  真实值须在下载解包后由 `AgentInstaller`/`PluginInstaller`（任务 4.3/4.4）重新判定并覆盖，
  不能把 `SourceResolver` 对 npm/git 给出的 `kind` 当最终依据。
- **`resolveSource()` 的注册表分支只是占位**：判别为「注册表包标识」的实参返回
  `{ code: "REGISTRY_NOT_IMPLEMENTED", spec }`，不是 design.md 描述的 `via: "registry"` 成功分支
  （那个分支依赖 `RegistryPort`/`@pi-clouds/*`，归任务 9.1、Wave 2，阻塞跨仓）。任务 9.1 接线时
  应替换这个占位分支，同时补齐 `ResolveError` 联合里 design.md 已定义、本任务未用到的
  `SIGNATURE_UNTRUSTED`/`REGISTRY_UNREACHABLE`/`SOURCE_NOT_FOUND` 三个错误码。
- **8.1 判别规则的「host 简写 vs 裸标识」区分点是首段含 `.`**：`github.com/u/r`（首段 `github.com`
  含点，判直连）与 `org/name`（首段 `org` 不含点，判注册表标识）都含 `/`，仅靠"含不含 `/`"无法
  区分——`classifySourceForm()` 用「首个 `/` 之前的片段是否含 `.`」这条启发式规则。后续新增判别
  分支（如支持更多 VCS host）时应保持这条规则的位置（在文件系统路径判定之后，兜底判注册表标识之前）。
- **★ `pi list` 的 id 不含版本号**：`parseListLine`（`packages/server/src/extensions/cli/pi-cli.ts:266`）
  按**最后一个 `@`** 切分（`at > 0` 才切，故 `@scope/pkg` 不会被误切），版本落进单独的 `.version` 字段。
  而 `assembleInstallArgs` 传给 pi 的来源串**含**版本。二者**不可直接比较**。
  4.3 已导出纯函数 `normalizeExtSourceId()`（复刻同一规则），5.x/4.5 一律复用它，别再各自推导。
  面向用户的「包标识」（uninstall/update 的实参）应是**不含版本**的形态。
- **`PiCli.listExtensions()` 会抛异常**（`PiListError`），不返回 `Result`。`server/cli` 的约定是判别联合、
  不抛异常，故 `PluginInstaller` 绕过它，直接 `runPiCommand(["list"])` + `parsePiList`。
- **`PiCliNotFoundError` 由 `ChildProcessPiCli` 的构造器同步抛出**（其中调 `resolvePiCliEntry()` 探磁盘）。
  测这条分支不需要 `vi.mock`，注入一个会抛的 `piCliFactory` 即可。构造必须**惰性**（只在未注入时才 new），
  否则单测会真的去磁盘找 pi。
- **`assembleInstallArgs`/`assembleRemoveArgs` 没有 scope 参数**，不产出 `-l`。plugin 通道的 project 作用域
  在 4.5 落实（扩展该纯函数，或在 Installer 分派层后处理 `InstallArgs.args`）。
- **别把「知道有坑」写进测试注释然后绕开它**：4.3 初版的测试注释承认了 id 形态不对称，却只测了安全的一半，
  把一个「刚装好的包卸载不掉」的缺陷藏了起来，被复核 REJECT。有不对称就写 round-trip 测试去撞它。
- **取 npm tarball 用 `npm view <spec> dist.tarball --json` + 直接下载 + `tar -xzf`，绝不用 `npm pack`**：
  `npm view` 是纯注册表元数据查询，不碰包代码；而 `npm pack` 对 git 型 spec 可能触发 `prepare`/`prepack`。
  这是需求 3.12「不执行包内任何安装脚本」的实现依据。
- **git 浅克隆到不可变 ref 的正确序列**：`git clone --depth 1 --branch <ref>` 对**裸 commit SHA 不适用**
  （只对服务端公告的具名 ref 有效）。改用 `git init` → `git remote add` → `git fetch --depth 1 origin <ref>`
  → `git checkout FETCH_HEAD`，对 SHA 与 `vX.Y.Z` tag 通用。checkout 后删 `.git` 得到不可变文件快照。
  ⚠️ 该方案对裸 SHA 的可用性**依赖服务端开启 `uploadpack.allowReachableSHA1InWant`**。github.com 已开，
  而 `DEFAULT_ALLOWLIST.gitHosts` 当前只有 `github.com`，故成立。**放开 git host 白名单前必须重新验证**
  （GitLab CE 默认不开）。
- **落盘用 staging + 原子 rename**：先 `mkdtemp(<sourcesRoot>/.staging-*)`（同文件系统，保证 rename 原子），
  全部成功才 rename 到最终目录；任一步失败即递归删除 staging。因 rename 是唯一发布点，目标目录存在
  ⇒ 必然是此前一次完整安装，故重复安装同 ref 幂等短路、不覆盖。
- **本地路径 agent 只登记不拷贝**：走 4.1 的 `registerLocalSource`，源根之下不新增任何目录
  （软链会被 realpath 门控静默剔除，拷贝则丢失「边改边试」的意义）。
- **★ 让断言承担拦截责任，别让替身替它拦**：4.4 初版的 npm 替身对非 `view` 子命令直接 fail，
  导致「不得执行包脚本」的白名单断言**永远触达不到** —— 违规在更早的「调用失败」层就被拦下，断言沦为摆设。
  改成替身一路放行（任何子命令都返回成功且返回合法输出），白名单断言才成为真防线：
  实测把 `npm view` 换成 `npm install` / `npm pack`，两次 mutation 都直接撞在断言上。
- **`tar` 走系统二进制**（Windows 10 1803+ 自带 bsdtar，CI 三平台矩阵已在用）。Node 内置 `zlib` 只能
  gunzip，不能展开 tar 归档层，故不加第三方 tar 依赖。⚠️ 现有 CI 的 `e2e:cli*` 跑的是 stub/mock，
  **从未真实执行过 npm/tar 解包路径**，跨平台集成证据缺失 —— 归 6.2/6.3。
