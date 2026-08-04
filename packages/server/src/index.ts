// @blksails/pi-web-server — 聚合导出(各模块实现后在此 re-export)。
//
// 注意:不再从此主入口 re-export `./runner/index.js`。runner 模块在加载时即
// 静态导入完整 pi SDK(@earendil-works/pi-coding-agent / pi-ai)与 jiti——一旦
// 经此 barrel 进入 Next 服务端 bundle,会触发 webpack "Critical dependency" 告警
// 并把整套 SDK 打进路由。runner 仅由 cwd-无关的引导脚本(runner-bootstrap.mjs)
// 经 jiti 直接加载 `./runner/runner.ts` 在子进程中运行,App / Handler 从不直接
// 导入 runner。需要 runner 符号的(测试)请从 `./runner/index.js` 子路径导入。

// ───────── 内核转发面(spec: core-package-extraction,任务 5.2)─────────
// 原本这里是 25 条 `export * from "@blksails/pi-web-core/<模块>"`。模块搬完后它们的并集
// 就是内核主入口本身,故收敛成一条转发 —— 清单只此一份,不会两处漂移。
// ★ 主入口的**符号集合**由 `test/compat/main-entry-symbols.txt` 逐字守着(313 个)。
export * from "@blksails/pi-web-core";

export {};
// 内置 default-agent 入口解析(纯 node builtins,无 pi SDK 值导入,可安全 barrel 重导出)。
// trust 策略仍经子路径 `@blksails/pi-web-server/trust` 导出(消费方 pi-handler 据此导入)。
// 历史原因是 `project-trust-policy` 曾值导入 `@earendil-works/pi-coding-agent`(其 dist 拉入
// pi-ai 的 `node:fs/os/path` + 表达式 require),经 barrel `export *` 会令 Next external 失效、
// 把整套 pi SDK 打进路由 bundle。**该耦合已解除**:trust 现由本地 `FsProjectTrustStore`
// (node:fs only,见 `./trust/trust-store.ts`)直接读写 `<agentDir>/trust.json`,零 pi SDK 依赖。
// 子路径导出予以保留(稳定的显式信任面),但不再是 external 正确性的必要条件。
// attachment-store(L0+L1):门面 / 配置工厂 / 受认可的复用面(BlobStore / LocalFsBlobBackend /
// AttachmentRegistry / UrlSigner / BlobMeta / PutInput),供下游 attachment-tool-bridge 在子进程内
// 组合实例化。纯 node builtins(无 pi SDK 值导入),可安全经 barrel `export *` 重导出。
// attachment-tool-bridge(L2 投影 + 子进程 store + 闸门 + 回流 + 注入):本切片(task 1.1)
// 导出子进程 store 客户端工厂 createChildAttachmentStore + ChildAttachmentStore(上游门面别名)。
// 纯 node builtins + attachment-store 复用面(无 pi SDK 值导入),可安全经 barrel `export *` 重导出。
export { runnerBootstrapPath } from "./runner-bootstrap-path.js";
// sourceKey(地基 G3,spec source-settings-and-slots 任务 0.1):纯 node builtins(crypto),
// 面⑦ per-source 配置目录/DB 主键、面⑤ dist 寻址/源匹配复用的单一事实来源。
// session-list(sessions-list):GET /sessions 只读列表端点的注入路由工厂。
// 仅 node builtins + session-store/http 复用面(无 pi SDK 值导入),可安全经 barrel 重导出。
// agent-source-list(agent-sources-list):GET /agent-sources 只读源枚举端点的注入路由工厂。
// 仅 node builtins + agent-source 只读探测(probeEntry/identify),无 pi SDK 值导入,可安全经 barrel 重导出。
// aigc-settings(aigc-tool-settings):GET/PUT /aigc/settings —— AIGC 图像工具「被禁模型」持久设置读写。
// vision-settings(canvas-vision-readout):GET /vision/models —— 可用视觉模型只读清单。
// ⚠ 仅重导出薄路由与类型;取数(引 pi SDK)走子路径 `@blksails/pi-web-server/vision-model-options`。
// session-actions(session-list-item-actions):删除/重命名/收藏 写端点的注入路由工厂 + 会话收藏存储。
// 仅 node builtins + session-store 复用面(无 pi SDK 值导入),可安全经 barrel 重导出。
// sandbox 强制注入入口解析(仅 node builtins,无 pi SDK 值导入,可安全经 barrel 重导出)。
// model-catalog(model-catalog spec):chat/image 双命名空间目录组装服务
// (createModelCatalogService)。纯组装零 env 零 IO,依赖仅 config 纯过滤器 +
// tool-kit 主入口纯类型,无 pi SDK 值导入,可安全经 barrel 重导出。
// ⚠ 网关合并能力自 core-package-extraction 任务 3.1 起改为**注入**(mergeCatalog),
//   本模块不再值导入 ai-gateway —— 那曾是内核提取继承的最后一条跨层反向依赖。
// ⚠ 取数闭包(config/model-options.ts,含 pi SDK)不在此导出,由装配层注入。
// ───────── 宿主契约 v1(spec: host-contract-ports,任务 6.2;Req 9.1、10.1、10.4)─────────
// 契约 `docs/pi-web-host-contract-v1.md` 的四个端口 + 版本常量。五条均无 pi SDK 值导入,
// 论证逐条附在下面(**不是**「同属一个 spec 所以同理」——那正是本 spec 反复吃亏的同族外推)。
//
// host-contract-version:零 import 的纯常量 + 纯函数 + Error 子类。必须一并导出,否则
// Req 9.1「版本标识可被程序读取」在包主入口不成立(端口对象上的 contractVersion 是类型层的,
// 跨仓时类型已擦除)。
// workspace:除 barrel 外的五个实现文件(key/limit-config/local-workspace/merge/types),外部
// 导入仅 `node:crypto`/`node:fs`/`node:os`/`node:path`(均在 local-workspace.ts)+ 同仓纯常量
// 模块 host-contract-version,无 pi SDK 值导入。
// ⚠ 一致性套件(`./workspace/testing/`)不在此;它走 `./testing` 子路径(任务 6.3),
// 测试套件进主 barrel 会随之进入运行期产物。
// capability:**全部为类型**,零运行期导出;仅两条 `import type` —— `../host-contract-version.js`
// 与 `../auth/egress-model.js`(后者本身零 import,纯类型别名)。类型在编译期擦除,经 barrel
// 重导出后运行期无任何痕迹。
// ⚠ 值得单独记一笔:本模块的**类型面伸进了 `auth/` 子树**。auth 那条导出行上就挂着「引 pi SDK
// 值的 egress-model-source 不在此」的告警,而 `auth/egress-model.ts` 是与之同目录、不同文件的
// 纯类型别名——两者只差一个文件名。此处若含糊写成「零 import」,读者恰好会漏掉这条唯一需要
// 他警觉的边。
// ───────── adapters 转发面的**收窄**(spec: adapters-package-extraction,任务 5.1)─────────
// 原本这里有 8 条 `export * from "@blksails/pi-web-adapters/<模块>/index.js"`
// (extensions / tokens / auth / llm-gateway / ai-gateway / identity / sandbox-transport /
// session-store-postgres)。它们是任务 3.1 搬迁期为「每一步都可独立编译」而临时保留的转发,
// 现整体移除 —— 兼容层不再代理 adapters 的导出面。
//
// ★ 这是**有意的破坏性契约变更**(R3.1/R3.2),不是「不小心弄丢」。两者在 diff 上长得一样,
//   唯一的区别是留了痕:
//   · 被移除的 161 个符号(89 个运行期值 + 72 个纯类型)**逐一枚举**在
//     `test/compat/main-entry-symbols.removed-5.1.txt`,按模块分组、带 value/type-only 标注
//   · 收窄前的 313 值符号基准另存为 `test/compat/main-entry-symbols.before-adapters-extraction.txt`
//   · 新基准仍是 `test/compat/main-entry-symbols.txt`(224 个),守卫继续以「与之逐字相同」把关(R3.4)
// ⚠ 那份基准是 `Object.keys` 的产物,**只看得见值** —— 它记录的收窄是 313 → 224(89 个),
//   比真实契约损失少了 72 个纯类型。评估本次影响面须读移除清单,不能只读基准。
// ⇒ 消费方改从 `@blksails/pi-web-adapters/<模块>/index.js` 深路径导入(本仓消费方已随本任务改完)。
//
// ⚠ mcp-probe 一如既往**不在**导出面 —— 它在内核的 config barrel 里也从未出现。装配层经
//   `@blksails/pi-web-adapters/mcp-probe.js` 直接引入。

// 父进程守望(spec desktop-exit-orphan):壳死则 server 自尽,不留孤儿占端口。
// host-manifest:纯类型 + 纯常量名册 + 纯函数,零外部依赖(连 node builtins 也不用)。
// config-domain:外部依赖为 `zod`(仅 `import type { ZodTypeAny }`)与 `@blksails/pi-web-protocol`
// (`default-domains.ts` 值导入八个 zod/表单 schema,均为纯数据),无 pi SDK 值导入;zod 已是
// 既有依赖,不新增 dependencies。
// 另有一条**同仓内部边**:`registry.ts` **值导入** `../workspace/key.js` 的 validateWorkspaceKey
// (域 id 复用键空间校验,Req 7.5)。这是 design.md 的 Boundary Map 认定的**四模块间唯一内部边**,
// 故必须写出来而不能以「仅 zod 与 protocol」带过;workspace 已在上面那条论证为 pi-SDK-free,
// 这条边不引入新的 bundle 风险。
