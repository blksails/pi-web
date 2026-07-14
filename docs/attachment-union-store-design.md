# Attachment UnionStore + Agent 具名 Profile — pre-spec 设计稿

> 状态:设计稿(未立 spec)。前置调查结论:UnionStore 可行且是 `BlobStore` 端口的自然延伸;
> 「agent 声明自己的 store」原样不可行,收窄为「agent 选择宿主注册的具名 profile」后可行。
> 本稿把两者的设计落到代码签名级,作为后续 `/kiro-spec-init` 的输入。

## 1. 背景与目标

现状(`packages/server/src/attachment/`):

- `BlobStore`(字节端口,S3 风格五能力)设计为可插拔,但唯一实现是 `LocalFsBlobBackend`;
- `AttachmentRegistry`(描述符)**硬编码本地目录**,不可插拔——云端多副本部署的天花板比 blob 更早;
- 公开 id `att_<16B base64url>` 为无路由信息的随机串,key === id,由门面在 `blob.put` 前铸造;
- 主/子进程各自经 **同一** `attachmentStoreConfigFromEnv` + spawn env(`PI_WEB_ATTACHMENT_DIR` +
  `PI_WEB_ATTACHMENT_SECRET`)构造指向同一后端的 store,签名 URL 互验;
- **分发生命周期长于会话**:历史消息中的附件在会话进程死亡、服务重启后仍经
  `GET /attachments/:id/raw` 分发(raw 路由只有 id)。

目标分两个独立有价值的阶段:

| 阶段 | 能力 | 依赖 |
|---|---|---|
| Spec 1 `attachment-backend-pluggable` | registry 可插拔 + S3 型后端 + **UnionBlobStore** 组合多后端 + env 驱动选择 + 描述符持久化后端绑定 | 无 |
| Spec 2 `agent-attachment-profile` | agent 定义声明 `attachmentProfile: "<宿主注册名>"`,决定**新写入**落哪个后端 | Spec 1 |

## 2. 设计不变式(来自调查的硬约束)

1. **后端绑定必须持久化在描述符层**。「字节在哪个后端」在落库时固化进 `Attachment.backend`;
   运行期声明(agent profile)只决定新写入去向,永不承载旧数据路由。理由:raw 分发在会话/agent
   进程死亡后仍要工作。
2. **配置必须完全 env 可表达**。子进程经 `createChildAttachmentStore(env)` 用同一工厂重建 store,
   union/profile 配置须能经 spawn env 序列化下发。
3. **凭据只来自宿主**。agent source 只声明 profile **名字**(纯字符串);endpoint/bucket/key 全部
   在宿主配置。未注册名字 → 会话创建失败(白名单,防外泄/SSRF)。
4. **门面语义不变**:先落 blob 再写描述符、失败回滚、id 仅由 `put` 铸造——union 不改变任何业务不变式。

## 3. Spec 1 — 后端可插拔 + UnionBlobStore

### 3.1 协议:描述符扩 `backend` 字段(向后兼容)

```ts
// packages/protocol/src/attachment/attachment-dto.ts(semver minor)
export const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  origin: AttachmentOriginSchema,
  sessionId: z.string(),
  createdAt: z.string().datetime(),
  /**
   * 字节所在后端的具名标识(union/profile 场景由写路径落库时固化)。
   * 缺省 = 历史对象/单后端部署,读路径回退默认后端(见 §3.4 迁移)。
   */
  backend: z.string().optional(),
});
```

### 3.2 端口改动:`put` 返回回执(内部端口,非协议)

门面写描述符时需要知道 union 实际选中的后端名;`BlobStore.put` 从 `void` 改为返回回执。
既有实现返回 `{}`,调用方零语义变化:

```ts
// packages/server/src/attachment/blob-store.ts
/** put 回执:组合后端(union)报告实际承载的后端名;单后端实现返回 {}。 */
export interface PutReceipt {
  readonly backendName?: string;
}

export interface BlobStore {
  put(
    key: string,
    body: Uint8Array | NodeJS.ReadableStream,
    meta: BlobMeta,
  ): Promise<PutReceipt>;                       // ← 原 Promise<void>
  getReadStream(key: string): Promise<{ stream: NodeJS.ReadableStream; meta: BlobMeta }>;
  head(key: string): Promise<BlobMeta>;
  presignUrl(key: string, opts?: { expiresInMs?: number }): Promise<string>;
  delete(key: string): Promise<void>;
}
```

门面 `put` 把回执写进描述符(唯一改动点):

```ts
// packages/server/src/attachment/attachment-store.ts · put 内
const receipt = await this.blob.put(id, input.bytes, meta);
const descriptor: Attachment = {
  id, name: input.name, mimeType: input.mimeType, size: input.size,
  origin: input.origin, sessionId: input.sessionId,
  createdAt: new Date().toISOString(),
  ...(receipt.backendName !== undefined ? { backend: receipt.backendName } : {}),
};
```

### 3.3 registry 可插拔:提为端口 + 现实现更名

```ts
// packages/server/src/attachment/attachment-registry.ts
/** 描述符注册表端口(既有 class 的同形接口;风格与 session-store-adapters 一致)。 */
export interface AttachmentRegistryPort {
  save(att: Attachment): Promise<void>;
  get(id: string): Promise<Attachment | undefined>;
  listBySession(sessionId: string): Promise<Attachment[]>;
}

/** 既有本地实现,更名保留(<root>/<id>.att.json 旁路,布局不变)。 */
export class LocalFsAttachmentRegistry implements AttachmentRegistryPort { /* 现 AttachmentRegistry 原文 */ }
```

> S3 场景的 registry 实现(如 `S3AttachmentRegistry`:描述符对象 `att/<id>.json` +
> `listBySession` 走前缀索引)属 Spec 1 交付项,接口即上述端口,本稿不展开实现体。
> ⚠ 既有 `listBySession` 全量扫描的性能问题与本设计正交,但换 S3 时必须一并解决
> (旁路二级索引 `by-session/<sessionId>/<id>`)。

### 3.4 `UnionBlobStore`(核心新增)

写路由 = 策略函数;读路由 = **描述符权威 + 迁移期探测链**。union 不自持路由状态
(描述符就是持久化的路由权威,不变式 1),经注入的 `resolveBackendName` 查询——由
config 工厂接到 registry,避免 union 依赖 registry 类型:

```ts
// packages/server/src/attachment/union-blob-store.ts(新文件)
import { BlobNotFoundError, type BlobMeta, type BlobStore, type PutReceipt } from "./blob-store.js";

/** 具名后端条目(名字 = 描述符 backend 字段取值域)。 */
export interface NamedBackend {
  readonly name: string;
  readonly store: BlobStore;
}

/** 写路由策略:按元数据选后端名;返回未注册名字 → put 抛错(配置错误尽早暴露)。 */
export type WritePolicy = (meta: BlobMeta) => string;

export interface UnionBlobStoreDeps {
  /** 至少一个;顺序 = 迁移期探测链顺序。 */
  readonly backends: readonly NamedBackend[];
  /** 写路由;缺省恒选 backends[0](primary)。 */
  readonly writePolicy?: WritePolicy;
  /**
   * 读路由权威:key → 落库时固化的后端名(config 工厂接 registry:
   * `(key) => registry.get(key).then((d) => d?.backend)`)。
   * 返回 undefined = 历史对象/描述符缺失 → 走探测链。
   */
  readonly resolveBackendName: (key: string) => Promise<string | undefined>;
}

/**
 * 组合多个 BlobStore 的联合后端。对门面呈现为单一 BlobStore:
 * - put:writePolicy 选一个后端落字节,回执报告后端名(门面固化进描述符);
 * - 读路径:优先描述符路由;缺省(迁移期)按声明顺序探测,吞 BlobNotFoundError 直到命中;
 * - delete:幂等语义(端口契约),路由命中删对应后端,缺省对全部后端幂等删。
 */
export class UnionBlobStore implements BlobStore {
  private readonly byName: ReadonlyMap<string, BlobStore>;
  private readonly ordered: readonly NamedBackend[];
  private readonly writePolicy: WritePolicy;
  private readonly resolveBackendName: (key: string) => Promise<string | undefined>;

  constructor(deps: UnionBlobStoreDeps) {
    if (deps.backends.length === 0) throw new Error("UnionBlobStore: backends must be non-empty");
    const names = new Set(deps.backends.map((b) => b.name));
    if (names.size !== deps.backends.length) throw new Error("UnionBlobStore: duplicate backend name");
    this.ordered = deps.backends;
    this.byName = new Map(deps.backends.map((b) => [b.name, b.store]));
    this.writePolicy = deps.writePolicy ?? (() => deps.backends[0]!.name);
    this.resolveBackendName = deps.resolveBackendName;
  }

  async put(key: string, body: Uint8Array | NodeJS.ReadableStream, meta: BlobMeta): Promise<PutReceipt> {
    const name = this.writePolicy(meta);
    const target = this.byName.get(name);
    if (target === undefined) throw new Error(`UnionBlobStore: writePolicy chose unknown backend "${name}"`);
    await target.put(key, body, meta);
    return { backendName: name };
  }

  async getReadStream(key: string) {
    return this.route(key, (s) => s.getReadStream(key));
  }
  async head(key: string) {
    return this.route(key, (s) => s.head(key));
  }
  async presignUrl(key: string, opts?: { expiresInMs?: number }) {
    // 混合语义天然成立:本地后端签 /raw URL,S3 后端 presign 直链,按对象各走各的。
    return this.route(key, (s) => s.presignUrl(key, opts));
  }

  async delete(key: string): Promise<void> {
    const name = await this.resolveBackendName(key);
    if (name !== undefined) {
      await this.byName.get(name)?.delete(key);
      return;
    }
    // 无路由信息(历史对象):对全部后端幂等删(端口契约:不存在不抛)。
    for (const b of this.ordered) await b.store.delete(key);
  }

  /** 读路由:描述符权威 → 命中后端;缺省走声明顺序探测链(仅迁移期路径)。 */
  private async route<T>(key: string, op: (s: BlobStore) => Promise<T>): Promise<T> {
    const name = await this.resolveBackendName(key);
    if (name !== undefined) {
      const target = this.byName.get(name);
      // 描述符指向已被运维摘除的后端 → 明确报错,不静默探测(配置错误可见)。
      if (target === undefined) throw new Error(`UnionBlobStore: descriptor backend "${name}" not configured`);
      return op(target);
    }
    for (const b of this.ordered) {
      try {
        return await op(b.store);
      } catch (err) {
        if (err instanceof BlobNotFoundError) continue;
        throw err;
      }
    }
    throw new BlobNotFoundError(key);
  }
}
```

`localPath` 委托:门面的 `backend?: DiskPathCapable` 现由 config 工厂在**本地后端参与组合时**
传入该本地后端实例(union 本身不实现 `diskPath`;非本地承载的对象 `localPath` 返回
`undefined`,契约本就允许)。

### 3.5 config 工厂:env 驱动的多后端组合

单一 env 承载完整拓扑(不变式 2:spawn env 原样透传即可让子进程重建同一 union;
凭据经 `${VAR}` 间接引用宿主 env,配置体本身可进版本库):

```jsonc
// PI_WEB_ATTACHMENT_BACKENDS(JSON;未设置 = 现状单本地后端,零行为变化)
{
  "backends": [
    { "name": "local", "kind": "local-fs", "dir": "~/.pi/agent/attachments" },
    { "name": "s3-cn", "kind": "s3", "bucket": "pi-attach", "region": "cn-northwest-1",
      "endpoint": "https://…", "accessKeyEnv": "PI_S3_AK", "secretKeyEnv": "PI_S3_SK" }
  ],
  "write": "local",                       // 缺省写路由(Spec 2 的 profile 按会话覆盖它)
  "registry": { "kind": "local-fs" }      // 或 { "kind": "s3", "backend": "s3-cn" }
}
```

```ts
// packages/server/src/attachment/config.ts · 工厂骨架(既有签名不变,内部分支)
export function attachmentStoreConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: { urlBasePath?: string } = {},
): AttachmentStoreConfig {
  const dir = resolveAttachmentDir(env);
  const secret = resolveAttachmentSecret(env);
  const signer = createUrlSigner(secret);
  const urlBasePath = options.urlBasePath ?? env["PI_WEB_ATTACHMENT_URL_BASE"] ?? "";

  const topology = parseBackendsEnv(env["PI_WEB_ATTACHMENT_BACKENDS"]); // undefined = 现状
  if (topology === undefined) {
    // ── 现状路径原样保留(单 LocalFs;存量部署零变化)──
    const backend = new LocalFsBlobBackend(dir, signer, urlBasePath);
    const registry = new LocalFsAttachmentRegistry(dir);
    return { store: new AttachmentStore({ blob: backend, registry, signer, backend }), dir, secret };
  }

  const registry = buildRegistry(topology.registry, { dir /* , s3 clients… */ });
  const named = topology.backends.map((b) => ({
    name: b.name,
    store: buildBackend(b, { signer, urlBasePath, env }),   // kind → LocalFs / S3 实例
  }));
  const localBackend = findLocalBackend(named);              // localPath 委托(可无)
  const union = new UnionBlobStore({
    backends: named,
    writePolicy: () => topology.write,
    resolveBackendName: (key) => registry.get(key).then((d) => d?.backend),
  });
  const store = new AttachmentStore({ blob: union, registry, signer, backend: localBackend });
  return { store, dir, secret };
}
```

spawn env 下发(`lib/app/pi-handler.ts` 既有 Req 7.3/7.4 处):在既有
`PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET` 旁**追加透传**
`PI_WEB_ATTACHMENT_BACKENDS` 与其引用的全部 `*Env` 凭据变量。子进程
`createChildAttachmentStore` 走同一工厂 → 主/子重建出同构 union(签名互验不受影响,
signer 仍单一 secret)。

### 3.6 迁移与兼容

- 未设 `PI_WEB_ATTACHMENT_BACKENDS`:走原路径,字节级零变化。
- 存量对象无 `backend` 字段:union 读路径走探测链(声明顺序含 `local` 即命中);
  可选一次性回填脚本(扫描 registry,`head` 探测后 `save` 回写 `backend`)。
- `PutReceipt` 为内部端口变更;协议仅 `AttachmentSchema` 加 optional 字段 → minor bump。

## 4. Spec 2 — agent 具名 profile(依赖 Spec 1)

agent 只声明**名字**;名字 → 后端映射、凭据、白名单全在宿主(不变式 3)。
profile 本质 = **按会话覆盖 union 的写路由**;读路由已由描述符权威承担,与会话无关。

### 4.1 声明面(agent-kit,纯数据)

```ts
// packages/agent-kit/src/types.ts · AgentDefinition 追加
export interface AgentDefinition {
  // …既有字段…
  /**
   * 附件落库 profile 名(宿主 PI_WEB_ATTACHMENT_BACKENDS.backends[].name 白名单)。
   * 只影响本 agent 会话**新写入**的后端选择;读/分发按描述符路由,与此无关。
   * 未注册的名字 → 会话创建失败。缺省 = 宿主默认写路由。
   */
  attachmentProfile?: string;
}
```

### 4.2 协议:装配期声明帧(`agent_routes` 完全同族)

```ts
// packages/protocol/src/attachment/profile-frame.ts(新文件)
export const AgentAttachmentProfileFrameSchema = z.object({
  type: z.literal("agent_attachment_profile"),
  profile: z.string().min(1),
});
export type AgentAttachmentProfileFrame = z.infer<typeof AgentAttachmentProfileFrameSchema>;
```

### 4.3 子进程侧接线(runner)

无时序死结:definition 就在子进程手里,child store 直接按 profile 构建;
帧只为让**主进程**知道并校验。

```ts
// packages/server/src/runner/attachment-wiring.ts · wireAttachmentBridge 内追加
// 1) 装配窗口(runRpcMode 前)推声明帧 —— slash_completions / agent_routes 同族:
if (definition.attachmentProfile !== undefined) {
  process.stdout.write(JSON.stringify({
    type: "agent_attachment_profile",
    profile: definition.attachmentProfile,
  } satisfies AgentAttachmentProfileFrame) + "\n");
}
// 2) 子进程 store:union 写路由按 profile 覆盖(工厂加可选参;undefined = 宿主默认):
const store = createChildAttachmentStore(env, { writeProfile: definition.attachmentProfile });
```

### 4.4 主进程侧:白名单校验 + 会话级写路由

```ts
// 会话装配读取声明帧处(agent_routes 声明帧的同一读取点旁):
const known = new Set(topology?.backends.map((b) => b.name) ?? []);
if (frame.profile !== undefined && !known.has(frame.profile)) {
  // 不变式 3:未注册 profile → 会话创建失败(白名单,防外泄/SSRF)。
  throw new SessionCreateError(`agent attachmentProfile "${frame.profile}" is not registered on this host`);
}
sessionWriteProfiles.set(sessionId, frame.profile);   // 会话级写路由表(仅影响 put)
```

浏览器上传路由(`store.put` 带 `sessionId`)与 tool bridge `putOutput` 经同一张
会话级写路由表取 profile → 传给 union 的 `writePolicy`(`WritePolicy` 扩为
`(meta, hint?: { profile?: string }) => string`,Spec 2 内完成)。会话结束清理表项;
**描述符里已固化的 `backend` 不受清理影响**(不变式 1,历史分发照常)。

### 4.5 安全清单

- profile 取值 = 宿主注册名白名单,agent 无法引入新 endpoint;
- 凭据仅存在于宿主 env,agent source 全程接触不到;
- 声明帧为纯数据,经 zod 校验,畸形帧按既有帧协议惯例忽略;
- `PI_WEB_AGENT_ROUTES_DISABLED` 同风格留 `PI_WEB_AGENT_ATTACHMENT_PROFILE_DISABLED`
  运维关断(关断 = 声明帧忽略,回宿主默认写路由,不失败会话)。

## 5. 测试面(按本仓 spec 硬规则:单元/集成 + e2e)

| 层 | 覆盖 |
|---|---|
| `UnionBlobStore` 单元 | 写路由/回执;描述符路由命中;探测链(含 `BlobNotFoundError` 穿透与非 NotFound 直抛);重名/空后端/未知 writePolicy 构造错误;delete 幂等双路径 |
| 门面集成 | `put` 回执 → 描述符 `backend` 固化;回滚路径带 union;`localPath` 混合承载 |
| config 工厂 | env 缺省零变化;JSON 拓扑解析;凭据间接引用;子进程同 env 重建同构 |
| 主/子进程集成(真实子进程) | tool `putOutput` 落非默认后端 → 主进程 raw 分发可读(签名互验);⚠ 自定义 stdout 帧须 `fs.writeSync(1)` 直写(takeOverStdout 既有坑) |
| Spec 2 集成 | 声明帧 → 白名单拒绝失败会话;profile 写路由生效;会话死后历史附件分发仍通 |
| e2e | 双后端拓扑下:上传 → 对话引用 → 重启服务 → 历史图片仍渲染 |

## 6. 开放问题(立 spec 前需拍板)

1. `listBySession` 在 S3 registry 下的索引形态(前缀旁路 vs 外部索引),及既有全量扫描是否顺手根治;
2. 探测链是否只在「描述符存在但无 backend 字段」时启用(更严),还是描述符缺失也兜底(更松);
3. `WritePolicy` 是否需要 mime/size 之外的维度(origin 需扩 `BlobMeta`,门面透传一行);
4. 回填脚本是否随 Spec 1 交付,还是留运维文档;
5. Spec 2 的 profile 是否允许 per-route/per-tool 粒度(本稿刻意只做会话粒度,YAGNI)。
