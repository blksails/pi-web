# Implementation Plan

## 1. Foundation：分发链可用性（Phase 0 前置修复）

- [ ] 1. 打通分发形态下的子命令与工具链
- [x] 1.1 为分发形态补上守卫测试
  - 在重定位 e2e 中新增一条检查：在只含 `bin/` + `payload/` 的解包形态下，**经壳层**调用一个既有子命令
  - 该检查必须在修复前失败——现有检查直接 `import()` 解包产物、绕过壳层，因此对本缺陷零判别力
  - 完成态：新检查在当前代码上稳定报红，报错指向「未找到子命令实现产物」；截取该红作为后续转绿的对照
  - _Requirements: 1.7_
  - _Boundary: CLI e2e — `e2e/cli/cli-reloc.mjs`_

- [x] 1.2 让子命令实现产物在解包形态下可解析
  - 使子命令产物路径解析在包根缺失时回落到解包出的运行时根
  - 保持既有环境变量覆盖行为与纯函数可测性不变
  - 完成态：1.1 的检查由红转绿，既有 CLI 单测全部保持通过
  - _Depends: 1.1_
  - _Requirements: 1.7_
  - _Boundary: CLI 壳与构建接缝 — `bin/pi-web.mjs`, `test/cli/cli-commands-build.test.ts`_

- [x] 1.3 使构建工具链随包分发
  - 将样式管线相关依赖由开发依赖提升为运行依赖
  - 将构建器与样式管线加入服务端产物的外置清单与运行时包收集清单，避免原生二进制被静态内联
  - 完成态：在解包出的运行时目录下可解析到构建器与样式管线；构建接缝单测的外置清单断言同步更新并通过
  - _Depends: 1.2_
  - _Requirements: 4.2, 4.4_
  - _Boundary: 分发打包 — `scripts/build-server.mjs`, `scripts/pack-dist.mjs`, `package.json`, `test/cli/cli-commands-build.test.ts`_

- [x] 1.4 使样式预设进入分发树
  - 为界面包新增该预设的子路径出口，取代物理路径引用
  - 使工作区打包流程额外拷贝包根散装文件，令预设文件进入分发树
  - 完成态：解包形态下该预设文件存在且可经包出口解析；单测断言打包流程的拷贝清单含该类文件
  - _Depends: 1.3_
  - _Requirements: 4.5_
  - _Boundary: 预设分发 — `packages/ui/package.json`, `scripts/pack-dist.mjs`, `test/cli/cli-commands-build.test.ts`_

- [x] 1.5 集成任务：把预设与工具链候选路径注入子命令实现层
  - 由壳层构造候选路径数组并注入，沿用既有 examples 候选路径的同构模式
  - 提供纯函数从候选数组中取第一个存在者，使其可在不落盘的前提下单测
  - 完成态：注入的候选路径可被子命令实现层读取；纯函数对「首个存在」「全部缺失」两种输入分别返回路径与未定义
  - _Depends: 1.4_
  - _Requirements: 4.2, 4.5, 1.7_
  - _Boundary: 候选路径注入（跨壳层与实现层的集成点）— `bin/pi-web.mjs`, `server/cli/index.ts`, `test/cli/cli-args.test.ts`_

## 2. Core：打包原语层能力补齐

- [ ] 2. 补齐通用打包原语缺失的能力
- [x] 2.1 (P) 扩展通用 pane 文档层的构建能力
  - 使 pane 打包接受插件、编译期常量注入与外置清单三类参数
  - 使 pane 入口同时接受路径字符串与 URL 两种形态
  - 使内容安全策略可按形态定制，并新增可寻址 URL 形态的文档渲染出口
  - 完成态：同一入口分别以内联形态与 URL 形态构建，两份文档均可独立打开且脚本可执行；URL 形态的策略含自身来源许可
  - _Requirements: 2.2, 4.3, 6.4_
  - _Boundary: web-kit pane 原语 — `packages/web-kit/build/pane-document.ts`, `packages/web-kit/test/pane-document.test.ts`_

- [x] 2.2 (P) 新增运行时库单副本断言
  - 新增一条与既有「不得内联」方向相反的计数断言：目标库在产物中必须恰好出现一次
  - 完成态：对零次、一次、多次三种构造的产物分别断言，只有恰好一次通过；零次与多次各给出可区分的错误
  - _Requirements: 4.3_
  - _Boundary: web-kit externals 守卫 — `packages/web-kit/build/externals-guard.ts`, `packages/web-kit/test/externals-guard.test.ts`_

- [x] 2.3 (P) 重构画布样式层
  - 移除对宿主仓库物理路径的拼接，改为消费注入的预设候选路径
  - 把样式编译拆为「一次解析、多 pane 复用」，取代每个 pane 重跑完整样式管线
  - 使样式内容扫描基准显式为声明模块所在包根，而非入口文件所在目录
  - 完成态：构建含多个画布 pane 的输入时样式管线只执行一次，各 pane 拿到相同样式内容；入口位于依赖目录深处时扫描范围不扩散到依赖树
  - _Depends: 1.4_
  - _Requirements: 4.5_
  - _Boundary: canvas-ui 样式层 — `packages/canvas-ui/build/pane-document.ts`, `packages/canvas-ui/test/pane-document.test.ts`_

## 3. Core：构建命令实现

- [ ] 3. 实现构建命令的各阶段能力
- [x] 3.1 实现来源定位与构建错误联合
  - 定位 agent source 根与产物目录，探测可识别的 web 扩展源；两种既有源目录约定都要能识别
  - 定义构建错误的判别联合与阶段划分，供后续各阶段共用
  - 完成态：对「有源」「无源」两种输入分别得到成功定位与带期望源位置的明确报错
  - _Requirements: 1.3, 4.1, 5.1, 7.1_
  - _Boundary: 构建来源 — `server/cli/build/agent-source.ts`, `server/cli/build/errors.ts`, `test/cli/build/agent-source.test.ts`_

- [x] 3.2 实现工具链与预设解析
  - 消费注入的候选路径解析构建器与样式预设；任一缺失即以明确错误终止且不产出任何产物
  - 完成态：候选路径全缺失时以列出缺失项的错误终止，且产物目录保持为空
  - _Depends: 1.5, 3.1_
  - _Requirements: 4.2, 4.4_
  - _Boundary: 工具链解析 — `server/cli/build/toolchain.ts`, `test/cli/build/toolchain.test.ts`_

- [x] 3.3 (P) 实现 pane 声明的约定发现与求值
  - 按「显式指定 > 包根汇总声明 > 逐目录声明」的顺序发现声明，全不命中时返回空集且不报错
  - 以 TS 运行时导入并求值声明模块，使计算属性名与相对模块自身解析的入口都能正确得到
  - 入口归一：URL 形态直接转路径，字符串形态相对声明模块自身解析；非本地文件协议显式拒绝
  - 结构不合法时终止并指出具体声明文件路径与字段
  - 完成态：三种发现顺序各命中一次、空集分支不抛错、畸形声明报出准确文件路径，均有测试覆盖
  - _Depends: 3.1_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_
  - _Boundary: pane 发现 — `server/cli/build/pane-discovery.ts`, `test/cli/build/pane-discovery.test.ts`_

- [x] 3.4 (P) 实现运行时库单例解析插件
  - 提供构建插件，强制运行时库从 **agent source 根**解析，而非从命令自身所在位置解析
  - 完成态：在 agent 与宿主各存一份运行时库的构造下，产出的 pane 产物经 2.2 的计数断言判定为恰好一份
  - _Depends: 2.2, 3.1_
  - _Requirements: 4.3_
  - _Boundary: 单例插件 — `server/cli/build/react-singleton.ts`, `test/cli/build/react-singleton.test.ts`_

- [x] 3.5 (P) 实现 pane 双形态产物生成
  - 为每个 pane 产出内联文档与可独立寻址的脚本、文档两类产物
  - 打包时注入单例插件；按声明的样式开关决定是否叠加画布样式，样式来自 2.3 的一次性解析结果
  - 完成态：三个 pane 的输入产出六个可寻址文件与一份内联文档映射，且两次构建产物字节一致（顺序稳定可复现）
  - _Depends: 2.1, 2.3, 3.3, 3.4_
  - _Requirements: 2.2, 4.3_
  - _Boundary: pane 产物 — `server/cli/build/pane-build.ts`, `test/cli/build/pane-build.test.ts`_

- [x] 3.6 (P) 实现 pane 静态清单与形态校验
  - 组装描述全部 pane 能力与面板配置的清单产物，条目顺序稳定
  - 清单组装后经既有结构校验入口走一遍完整校验，不自建校验
  - 完成态：构造一个两层包装的畸形声明，断言其在**构建期**被拒绝并给出违反的结构约束（这正是本 spec 起因的那类漂移）
  - _Depends: 3.3_
  - _Requirements: 2.3, 3.5_
  - _Boundary: pane 清单 — `server/cli/build/panes-manifest.ts`, `test/cli/build/panes-manifest.test.ts`_

- [x] 3.7 (P) 实现隔离入口与运行时分派入口
  - 产出自包含入口产物；产出可在运行时判别宿主形态并分派的统一入口
  - 统一入口字节被改写后同步重算其完整性校验值
  - 完成态：以可注入的形态探测桩替代真实宿主，断言分派入口在两种探测结果下分别解析到自包含产物与同源产物；清单中记录的校验值与统一入口最终字节逐字节一致
  - _Depends: 3.4_
  - _Requirements: 2.4, 2.5_
  - _Boundary: 隔离入口 — `server/cli/build/isolated-entry.ts`, `test/cli/build/isolated-entry.test.ts`_

- [x] 3.8 实现构建编排与错误呈现
  - 解析子命令参数；构建前清空产物目录以保证覆盖而非增量
  - 串接各阶段并保持失败即止；保留既有签名选项的语义
  - 全部输出经统一进度与错误通道，敏感值沿用既有脱敏；成功时输出产出文件清单与关键校验值
  - 完成态：成功路径打印文件清单与校验值并退 0；任一阶段失败以非零码退出且产物目录不残留部分产物
  - _Depends: 3.2, 3.5, 3.6, 3.7_
  - _Requirements: 1.5, 5.3, 5.4, 7.2, 7.3, 7.4_
  - _Boundary: 构建编排 — `server/cli/build/index.ts`, `test/cli/build/run-build.test.ts`_

## 4. Integration：CLI 接入与单入口收敛

- [ ] 4. 把构建能力接入命令面
- [x] 4.1 将构建子命令接入主 CLI
  - 在壳层子命令清单与规格表中注册，使其出现在总帮助列表并支持子命令级帮助
  - 在子命令派发处接入实现；非法选项以非零码结束且不产生任何文件系统或网络副作用
  - 完成态：总帮助列出该子命令、子命令帮助退 0、非法选项退非零且无副作用，三者均有测试覆盖
  - _Depends: 3.8_
  - _Requirements: 1.1, 1.2, 1.4_
  - _Boundary: CLI 接入 — `bin/pi-web.mjs`, `server/cli/index.ts`, `test/cli/subcommand-dispatch.test.ts`, `test/cli/cli-args.test.ts`_

- [x] 4.2 (P) 收敛为单一可执行入口
  - 移除打包支撑包中与主 CLI 同名的可执行声明及其薄命令实现
  - 完成态：工作区中不再存在第二个同名可执行入口声明；依赖签名选项的既有流程改经主 CLI 后行为不变
  - _Depends: 4.1_
  - _Requirements: 1.6_
  - _Boundary: web-kit 入口收敛 — `packages/web-kit/package.json`, `packages/web-kit/build/cli.ts`_

- [x] 4.3 (P) 集成任务：使三处发布提示指向本构建命令
  - 产物缺失、产物陈旧、发布预览缺产物提示三处文案统一改为引导执行本构建命令
  - 不改变发布流程「不自动构建」的既有行为
  - 完成态：三处文案均含可直接复制执行的构建命令；发布路径仍不触发任何构建动作，且既有发布单测保持通过
  - _Depends: 4.1_
  - _Requirements: 5.5, 5.6, 7.5_
  - _Boundary: 发布提示文案（跨 CLI、发布编译器与预览三个消费面的集成点）— `server/cli/index.ts`, `server/cli/publish/manifest-compiler.ts`, `lib/app/publish-preview.ts`, `test/cli/publish-manifest-compiler.test.ts`_

## 5. Integration：示例迁移与实现收敛

- [ ] 5. 让仓内示例与内置构建走统一路径
- [x] 5.1 (P) 迁移仓内示例到统一构建命令
  - 为四个 pane 清单硬编码在构建脚本里的示例新建 pane 声明模块；其中跨目录复用兄弟示例入口的那个用 URL 形态声明
  - 两个已有包根汇总声明的示例改经显式声明路径参数传入
  - 使示例构建流水线统一经本命令编排，去掉对各示例构建入口函数的静态引用，并删除各示例自带的构建脚本
  - 完成态：既有示例构建回归测试的三条断言（清单合法、校验值一致、运行时库未内联）在迁移后继续全部通过
  - _Depends: 4.1_
  - _Requirements: 6.1, 6.2, 6.3, 2.7_
  - _Boundary: 示例迁移 — `scripts/build-webext-examples.ts`, `examples/panes-agent/build.ts`, `examples/aigc-canvas-agent/build.ts`, `examples/aigc-canvas-nosurface-agent/build.ts`, `examples/canvas-plugin-stickers/build.ts`, `examples/state-bridge-agent/build.ts`, `examples/surface-demo-agent/build.ts`, `examples/aigc-canvas-nosurface-agent/panes-modules.ts`, `examples/canvas-plugin-stickers/panes-modules.ts`, `examples/state-bridge-agent/panes-modules.ts`, `examples/surface-demo-agent/panes-modules.ts`, `packages/web-kit/test/examples-build.test.ts`_

- [x] 5.2 (P) 收敛内置 pane 构建到通用原语
  - 删除内置 pane 构建脚本中与通用层重复的文档渲染与基线样式实现，改为消费通用层
  - 完成态（**判据已澄清**）：在**同一 esbuild 版本**下，收敛前后产出字节等价；仓内不再存在
    同一文档渲染逻辑的第三份副本
  - ⚠ 复查首轮 REJECT，实测收敛前后差 100 字节。根因**不是收敛逻辑**：收敛前调用点在仓库根
    （解析到 esbuild 0.28.1），收敛后经 web-kit（解析到 0.24.2），两个大版本 tree-shaking 行为
    不同。对照实验：同配置同入口，0.28.1 产 9015 字节、0.24.2 产 9111 字节（后者多出两个
    Tauri host adapter 符号）。**已把 web-kit 的 esbuild 统一到 ^0.28.1**，统一后两侧同为 9015 字节。
    这顺带修掉一个既存不一致：此前开发形态用 0.28.1、分发形态用 0.24.2，同一份源码产出不同产物。
  - _Depends: 2.1_
  - _Requirements: 6.4_
  - _Boundary: 内置 pane 构建 — `scripts/build-builtin-panes.ts`_

- [x] 5.3 (P) 确立产物不入库约定
  - 核实并补齐忽略规则，使各示例的产物目录与构建中间产物一并被版本控制忽略
  - 为六份构建中间产物各自保留类型垫片，使全新检出下类型检查不依赖构建产物
  - 完成态（**判据已改写**，原表述无判别力）：
    - `git check-ignore` 对六份中间产物与产物目录逐一返回 IGNORED；一次完整构建后 `git status` 不出现任何产物文件
    - 对每个示例的 pane 声明文件单独跑 `tsc --noEmit`，**因缺失中间产物而产生的 TS2307 计数为 0**；
      移走垫片后同一命令该计数变为 1（转红对照，证明判据确有判别力）
  - ⚠ 原完成态写的是「全新检出后执行类型检查通过」，但根 `tsconfig.json` 的 `exclude` 含 `examples`，
    移走垫片后 `pnpm typecheck` 照样 0 错误 —— 那个绿完全不能证明垫片起作用。见 gaps.md G13
  - _Depends: 4.1_
  - _Requirements: 5.2_
  - _Boundary: 产物忽略约定 — `.gitignore`, `examples/aigc-canvas-agent/web/pane-documents.generated.d.ts`, `examples/aigc-canvas-nosurface-agent/web/pane-documents.generated.d.ts`, `examples/canvas-plugin-stickers/web/pane-documents.generated.d.ts`, `examples/panes-agent/web/pane-documents.generated.d.ts`, `examples/state-bridge-agent/web/pane-documents.generated.d.ts`, `examples/surface-demo-agent/web/pane-documents.generated.d.ts`_

## 6. Core：双入口协议（Phase 2）

- [ ] 6. 让清单静态表达双入口
- [x] 6.1 扩展扩展清单以表达双入口
  - 新增可选的入口集合结构，每个成员含路径、完整性校验值与所属宿主形态
  - 扩展既有校验规则使集合内每个成员各自成对；保持单入口字段语义不变
  - 规范化字节的键集合**保持不变**，以免既有已发布包的签名失效
  - 完成态：新旧互读兼容——旧结构在新校验下通过、新结构在旧校验下不报错；既有签名样本在扩展后仍验签通过
  - _Requirements: 2.6_
  - _Boundary: 协议清单 — `packages/protocol/src/web-ext/manifest.ts`, `packages/protocol/test/web-ext/manifest.test.ts`_

- [x] 6.2 (P) 使清单产出支持逐入口完整性
  - 使清单产出流程可为多个入口分别写出完整性校验值
  - **守住向后兼容**：单入口字段必须继续指向分派入口产物，不得改指隔离入口
  - 完成态：双入口构建产出的清单中两个入口校验值各自与其字节一致；另有一条断言证明剥离入口集合后（模拟旧宿主的字段剥离）单入口字段仍指向可加载的分派产物
  - _Depends: 6.1, 3.7_
  - _Requirements: 2.5, 2.6_
  - _Boundary: 清单产出 — `packages/web-kit/build/manifest-emit.ts`, `packages/web-kit/test/manifest-emit.test.ts`_

- [x] 6.3 (P) 使消费方按形态选择入口
  - 使加载与校验路径优先按宿主形态从入口集合中选择，集合缺失时回落既有单入口字段
  - 完成态：含双入口的清单下同源与隔离宿主分别取到各自入口；仅含单入口的旧清单下行为与改动前逐字节一致
  - _Depends: 6.1_
  - _Requirements: 2.6_
  - _Boundary: 清单消费方 — `packages/react/src/web-ext/extension-loader.ts`, `packages/react/src/web-ext/extension-gate.ts`, `lib/app/webext-load-client.ts`, `packages/react/test/web-ext/extension-gate.test.ts`_

## 7. Validation

- [ ] 7. 端到端验证
- [x] 7.1 在分发形态下端到端验证构建命令
  - 扩展重定位 e2e：在解包形态下**经壳层**对一个临时 agent 目录执行真实构建
  - 这是唯一能暴露「工具链是否在分发树中存在、预设能否解析、原生二进制能否加载」的路径——仓库形态因依赖完整会百分之百假阳性
  - 完成态：解包形态下构建成功并产出完整产物集合；刻意移除工具链后该检查转红（证明判据有判别力）
  - _Depends: 4.1, 1.3, 1.5_
  - _Requirements: 1.7, 4.2, 4.4_
  - _Boundary: 分发形态 e2e — `e2e/cli/cli-reloc.mjs`_

- [x] 7.2 补齐构建命令的集成测试
  - 最小 agent source（含一个 pane）跑通，断言产物集合完整
  - 同一输入去掉全部 pane 声明，断言只产 web 扩展产物且成功退出
  - 先构建、塞入伪造的旧产物文件、再构建，断言旧文件不残留
  - 完成态：上述三条断言全部通过，构成产物完整性、无 pane 分支与覆盖语义的回归防线
  - _Depends: 3.8_
  - _Requirements: 2.1, 2.2, 2.3, 3.3, 5.3, 5.4_
  - _Boundary: 构建集成测试 — `test/cli/build/integration.test.ts`_

- [x] 7.3 独立仓真机验证
  - 在仓库外的真实 agent source 上执行本命令，重建其全部产物
  - 核验重建后产物导出的 pane 声明结构与宿主消费侧一致
  - 完成态：重建成功，且该 agent 在宿主中加载后 pane 面板可正常打开——即验证 requirements 边界中「漂移随重建自然消解」这一判断成立
  - _Depends: 7.1, 5.1_
  - _Requirements: 4.1, 4.3, 3.5_
  - _Boundary: 真机验证 — `e2e/cli/cli-agent-build-real.local.mjs`_

## Implementation Notes

### 第一轮 workflow（wf_e9fe8181-160，中断于 Phase 2）

**已完成并通过三视角复查**：1.1–1.5、2.1、2.2
**2.3 = UNREVIEWED**：实现已落盘，复查未跑完，待补。

**跨任务经验（多个 agent 独立撞到，已据此重构验证命令）**：

1. `pnpm typecheck` 在本仓会因 `desktop/src-tauri` 的**既存** Rust 错误（`WebviewBuilder::transparent`，E0599）整体标红，在干净 main 上同样复现，与 TS 改动无关。验证 TS 侧改动须用 `npx tsc -p tsconfig.json --noEmit`（根，实测 3.8s、退出码 0）＋ 逐包 `pnpm --filter <pkg> typecheck`。
2. 根 `vitest.config.ts` 的 include 仅 `test/**/*.test.ts(x)`，**不含 `packages/`** —— `npx vitest run packages/**/x.test.ts` 会 "No test files found" 退 1。定向测试须按路径切到对应包目录跑。
3. 并发同树编辑时，根级全量套件的红**有一半来自兄弟任务的半成品**。归因前必须 `git status` / import grep 溯源，不要认领不属于自己的红。
4. `bin/pi-web.mjs` 既有 DI 范式 `scheduleRuntimeGc(runtime, load = loadUnpacker)`；新增异步解析辅助函数应沿用 `deps = { fn = realFn }` 注入形状，否则单测无法区分「回落分支跑了」与「压根没跑」。
5. `resolveRuntime()` 的 ① 层（`PI_WEB_DIST_DIR` 覆盖）**盲信 env、不做 existsSync**，所以把它指向不存在的路径**不能**区分回落是否执行——真正的判别只能靠 DI 或 `cli-reloc.mjs` 的子进程改名把戏。
6. esbuild 的 IIFE/CJS 打包会给被打包 CJS 包的**每个内部文件**各套一个 `__commonJS({"<path>": ...})`，单份 react 通常产生 2+ 个包裹。任何单例计数逻辑必须按**安装目录前缀**去重，否则会把合法单副本误判为重复。
7. `bundlePaneEntry` 采用**重载签名**（裸 string/URL 或 options 对象）而非直接换成 options，使未迁移的消费方在其被迁移前继续可编译。后续传 plugins/define/external 时用对象形态。
8. `packages/canvas-ui/tsconfig.json` 原先漏了 `build/**/*.ts`，其 `build/pane-document.ts` 从未被类型检查覆盖（已补）。
9. 任务 2.3 的 boundary 只列了 pane-document.ts + 测试，但移除 `repoRoot` 的 API 变更**必然**破坏 3 个仓内调用方（examples 的 build.ts），实现者据实扩展了范围——boundary 窄于 API 影响面时应在设计阶段就发现。
10. **2.3 复查补记（PASS）**：验收点 2「一次解析多 pane 复用」的强证据是**结构性**的——`buildCanvasPaneDocument` 的入参类型只有 `entry/title/css`，物理上不含 `presetPath`/`packageRoot`，函数体内也无 postcss/tailwind 调用，类型层面即杜绝重算；测试里「产出逐字节相同」「多 pane 结果一致」属等值/幂等断言，判别力弱，不能单独作为该条的证据。
11. `design.md` 中 `resolveCanvasCss(presetPath: string)` 的单参签名与实现 `resolveCanvasCss(options: CanvasCssOptions)` 不一致（已回改 design）。下游若照抄设计文档签名会踩坑。
