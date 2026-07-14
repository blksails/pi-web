# Implementation Plan

- [x] 1. Foundation:端口与协议底座
- [x] 1.1 协议层描述符新增可选后端绑定字段
  - AttachmentSchema 增加 optional backend 字段;带/不带该字段的描述符均通过 zod 校验(单测断言两态)
  - 存量消费方(REST/SSE DTO)零改动,protocol 版本按 minor 语义记录
  - _Requirements: 1.3_
- [x] 1.2 字节端口回执化与既有实现适配
  - BlobStore.put 签名改为返回 PutReceipt(backendName 可选);LocalFsBlobBackend 返回空回执,行为不变
  - 全仓受影响的实现与测试 mock 同步适配;完成态 = pnpm typecheck 与 attachment 相关既有测试全绿
  - _Requirements: 3.1_
- [x] 1.3 描述符注册表提取端口并更名本地实现
  - 提取 AttachmentRegistryPort 接口(save/get/listBySession);类更名 LocalFsAttachmentRegistry
  - barrel 保留 AttachmentRegistry 兼容别名;完成态 = 存量 import 全部不破(typecheck 绿)
  - _Requirements: 1.1_

- [x] 2. Core:门面写路径绑定持久化
- [x] 2.1 门面 put 固化后端绑定并保持回滚不变式
  - put 将回执中的后端名条件展开进描述符;回执无后端名时描述符形状与现状一致
  - 描述符写失败时回滚已落字节后抛错——门面自身契约:以 fake blob 断言 delete(id) 被调用且最终抛错,不涉 union 语义
  - 完成态 = 门面单测覆盖回执有/无、回滚路径,全部通过
  - _Requirements: 3.1, 3.2, 1.2_

- [x] 3. Core:UnionBlobStore 组合后端
- [x] 3.1 (P) 组合后端构造与写路由
  - 空后端集合/重名 → 构造抛错;写策略缺省恒选首个后端;策略返回未注册名 → put 抛错
  - put 委托选中后端并返回含后端名的回执(单测断言)
  - _Requirements: 3.1, 2.2_
  - _Boundary: UnionBlobStore_
- [x] 3.2 组合后端读路由、探测链与删除双路径
  - 读路径:绑定命中仅走绑定后端;未命中抛既有 BlobNotFoundError;无绑定按声明顺序探测(BlobNotFoundError 穿透续试、其他错误直抛、全空抛)
  - 绑定指向未注册后端 → 抛出含后端名的配置错误,不静默探测
  - 删除:有绑定删绑定后端;无绑定全后端幂等删
  - 完成态 = 上述全部分支有单测且通过
  - _Requirements: 4.1, 4.2, 4.3, 7.1, 7.2_
  - _Boundary: UnionBlobStore_

- [x] 4. Core:S3 兼容后端(字节与描述符双层)
- [x] 4.1 (P) SigV4 签名纯函数
  - canonical request/string-to-sign/签名键派生/header 签名/query presign 五段纯函数,零 IO
  - 完成态 = AWS 官方签名测试向量单测全绿
  - _Requirements: 5.1, 5.4_
  - _Boundary: sigv4_
- [x] 4.2 最小 S3 HTTP 客户端
  - PUT/GET/HEAD/DELETE/ListObjectsV2 五操作,fetch + SigV4 header 签名
  - 404/NoSuchKey → 类型化未找到语义;其余非 2xx → 含 status 与 code 的类型化错误(单测用注入 fetch 断言)
  - _Requirements: 5.1_
- [x] 4.3 S3 字节后端
  - BlobStore 五方法实现;meta 经对象头存取;presignUrl = query presign 且时效语义与既有一致
  - env 门控集成测试(未配置真实 S3 兼容服务时 skip):blob 五操作真实互通 + 双实例字节互读
  - 完成态 = 注入 fetch 的单测覆盖五方法与未找到映射;门控集成测试在配置环境下通过
  - _Requirements: 5.1, 5.3, 5.4_
  - _Boundary: S3BlobBackend_
- [x] 4.4 (P) S3 描述符注册表
  - att/<id>.json 描述符 + by-session/<sessionId>/<id> 索引;save 先描述符后索引且幂等;listBySession = 前缀枚举 + 并发取回;get 未找到返回 undefined
  - env 门控集成测试(未配置真实 S3 服务时 skip):双实例描述符互读断言
  - _Requirements: 5.2, 5.3_
  - _Depends: 4.2_
  - _Boundary: S3AttachmentRegistry_

- [x] 5. Core:拓扑配置与构建工厂
- [x] 5.1 (P) 拓扑 env 解析与装配期校验
  - zod 判别联合 schema;未设置返回 undefined;JSON 不可解析/schema 不符/后端空集/重名/写目标失配/registry 引用失配/未知 kind → 类型化配置错误且 message 指出错误项
  - 凭据经 *Env 间接引用,解引用缺失 → 报缺失变量名
  - 完成态 = 合法样例 + 七类非法输入单测全绿
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - _Boundary: backends-config_
- [x] 5.2 后端/注册表构建工厂与透传清单
  - buildBackends 按 kind 实例化(local-fs/s3);buildRegistry 支持 local-fs 与 s3(绑定既有具名后端的客户端配置);computePassthroughEnv 产出拓扑 env 原文 + 全部被引用凭据变量
  - 完成态 = 工厂单测断言实例种类与透传清单完整性
  - _Requirements: 2.1, 6.1_
  - _Depends: 4.3, 4.4, 1.3_

- [x] 6. Integration:装配接线
- [x] 6.1 config 工厂分支接线
  - 未设拓扑 env → 原单后端路径,产物(目录/签名/描述符形状)与现状逐项一致(回归断言)
  - 设拓扑 env → union + registry 组装,读路由权威接 registry 的 backend 字段,首个本地后端作 localPath 委托;返回值扩 passthroughEnv
  - _Requirements: 1.1, 1.2, 2.1_
  - _Depends: 2.1, 3.2, 5.2_
- [x] 6.2 子进程门控与 spawn env 透传
  - child-store 能力门控扩为「附件目录或拓扑 env 任一下发即可用」;均未下发维持既有类型化降级
  - pi-handler spawn env 合入 passthroughEnv;完成态 = 单测断言下发变量集合
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 7. Validation:集成与端到端
- [x] 7.1 双本地后端 union 全链集成测试
  - 拓扑 = 两个 local-fs 后端;落库 → 描述符含绑定 → 读/签发/删除仅作用选中后端;预置无绑定对象 → 探测命中次后端
  - 模拟描述符写失败:断言 union 对全部后端执行幂等删(回滚闭环)
  - 完成态 = 集成测试覆盖对应断言并通过
  - _Requirements: 3.2, 3.3, 4.1, 4.2, 7.1, 7.2_
- [x] 7.2 主/子进程真实子进程集成测试
  - 拓扑生效下子进程工具落库 → 主进程按 id 完成描述符读取与签名分发;env 不下发 → 既有降级语义
  - _Requirements: 6.1, 6.2, 6.3_
  - _Depends: 6.1, 6.2_
- [x] 7.3 端到端重启分发旅程
  - e2e:node(stub agent + 双 local-fs 拓扑):上传 → 会话引用 → 重启 server 进程 → 历史附件签名分发仍返回 200
  - _Requirements: 4.4_
- [x] 7.4 全仓回归
  - pnpm typecheck + 全仓测试全绿;完成态 = 新鲜运行输出证明
  - _Requirements: 1.1, 1.2_

## Rules & Tips

- **`AttachmentRegistryPort` 比 design.md 草稿多两个方法**:`getMeta`/`setMeta`(不透明扩展 meta,
  Canvas 血缘等下游依赖)必须也进端口,否则 `attachment-store.ts` 既有委托调用编译不过。S3 侧实现
  与本地实现同语义(整体覆盖 `ext` 字段,读写原样往返)。
- **`parseBackendsEnv(raw)` 不接收 env 参数**(design.md 签名如此):凭据 `*Env` 变量名解引用
  (Req 2.4「缺失报变量名」)因此放进 `buildBackends`/`buildRegistry`(持有 `env` 的构建工厂),
  不在 schema 解析层做。七类非法输入单测只覆盖 schema/引用一致性,凭据缺失单测在
  `backends-config-factory.test.ts`。
- **`BlobStore.put` 的 body 类型对 `fetch` 的 `RequestInit["body"]` 有 lib 依赖差异**:根 tsconfig
  (含 DOM lib)与 `packages/server` 自身 tsconfig(无 DOM lib)对 `Uint8Array` 是否满足 `BodyInit`
  判定不同;用 `RequestInit["body"]` 做 cast(而非裸 `BodyInit`,后者在无 DOM lib 的 tsconfig 下
  是未定义全局名)两边都过。
- **SigV4 单测的「AWS 官方向量」不可凭记忆手敲长十六进制常量**:曾出现打字错误(多一位/少一位)。
  改用 `WebFetch` 拉取 AWS 官方 `aws-sig-v4-test-suite`(经 `mongodb/libmongocrypt` 镜像)的
  `.creq` 原文钉死 canonical request 文本(短、结构化、易人工核验),`stringToSign`/签名值改用
  `node:crypto` 独立于被测模块直算(差分校验),不依赖对任何长哈希串的转录记忆——`WebFetch` 的
  摘要模型本身也会在长十六进制串上引入类似错误(实测同一 `.sts`/`.authz` 文件两次抓取得到不同
  哈希),不能盲信抓取结果的数值,只信可读文本 + 独立计算。
- **e2e:node 没有「真实进程 kill+restart」基础设施**:既有 `_session-persistence-suite.ts` 走
  in-process route 组合,不过真实 OS 进程边界。任务 7.3 改为直接 `spawn` 仓库根 `server/index.ts`
  两次(`SIGTERM` 杀第一个、以同一拓扑 env 起第二个),验证历史附件签名分发跨真实重启仍 200。
  **spawn cwd 必须是 `packages/server`**(不能是仓库根)——`jiti` 是 `@blksails/pi-web-server` 的
  devDependency,pnpm 不提升到根 `node_modules`,`--import jiti/register` 用裸 specifier 解析,
  从根 cwd 解析不到会直接 `ERR_MODULE_NOT_FOUND`。`server/index.ts` 自身的相对 import 不受 cwd
  影响(基于文件自身路径解析);`source: "."` 在该 cwd 下依然被 stub agent 正确处理(未观察到
  异常),故未额外传绝对 source 路径。
- **主/子进程真实子进程测试(7.2)不需要真实 LLM/runner 装配**:写了一个独立 fixture 脚本
  (`test/attachment-bridge/fixtures/child-put-tool-output.ts`),只调用
  `createChildAttachmentStore(process.env)` 后 `put(origin:"tool-output")`,经
  `--import jiti/register` 以真实子进程跑;比拉起完整 runner+agent+mock LLM 轻量得多,且同样是
  一次真实 OS 进程边界穿越,满足 design.md「真实子进程」的字面要求。
- **`AttachmentStoreConfig.passthroughEnv` 是新增必填字段**(未设拓扑时为 `{}`):`pi-handler.ts`
  的 `attachmentSpawnEnv`/`stubSpawnSpec` 两个 spawn 构造点都要改(真实模式 + stub 模式各一处),
  漏改一处就是「stub agent 场景测试全绿但真实 agent 场景透传缺失」这种只有集成测试才抓得到的坑。
- **全仓回归的已知无关失败基线**(与本 spec 改动无关,`git stash` 验证过在改动之前就失败):
  根级 `test/webext-locate-dist.test.ts`(3 个,webext dist 产物 fixture 缺口)、
  `e2e:node` 的 `config-domains.e2e.test.ts` 与 `webext-build-load.e2e.test.ts`(与
  `browser-e2e-fixture-infra-gaps` 记忆一致);`desktop` 包的 `typecheck`/`test`(Tauri
  `binaries/node-aarch64-apple-darwin` 资源缺失,worktree 固有问题,`pnpm typecheck`/`pnpm test`
  需用 `--filter '!@blksails/pi-web-desktop'` 绕开才能看到其余包的真实结果)。
