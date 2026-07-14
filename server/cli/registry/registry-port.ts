/**
 * RegistryPort(cli-package-commands 任务 7.1)—— Source Registry 的**本仓端口**。
 *
 * 依赖倒置:接口在**本仓**定义,**不向上层泄漏** `@pi-clouds/registry-client` 的具体类型。
 * 两个实现:`HttpRegistryAdapter`(生产,经 registry-client 的 HTTP 客户端)与注册表侧交付的
 * 进程内契约夹具(测试)。这样发布/安装逻辑只依赖本接口,registry-client 的分发形态(源码 alias
 * vs npm)如何变都不影响上层。
 *
 * 与 pi-clouds `RegistryApi` 的对齐差异(实现 adapter 时处理):
 *  - 本端口方法**不带 token**;token 由 adapter 自持/注入,不外泄给上层。
 *  - `setChannel` ↔ pi-clouds 的 `moveChannel`(改名)。
 *  - `uploadBundle`:发布侧把 bundle tarball 交 registry 代理上传到 OSS,换回内容寻址 key;
 *    **发布侧不接触 OSS 写凭据**(用户决策)。
 *
 * 安装侧验签模型(用户决策,偏离原 design 的零信任):**信任 registry** ——
 * registry 在 `registerVersion` 时已验过发布者签名,安装侧不再 `getPublisherKeys` 重验,
 * 只在落盘后做逐项 integrity 复核。故本端口**不含 getPublisherKeys**。
 */

/** 统一 Result(与 install/source-resolver 同形)。 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * 不可变来源引用(本仓重声明,与 pi-clouds `Origin` 同构但不 import 其类型)。
 * registry 要求 origin **不可变**:git 用 tag/commit-sha、npm 用精确 version、oss 用内容寻址 bundle key。
 */
export type RegistryOrigin =
  | { readonly type: "git"; readonly repo: string; readonly ref: string }
  | { readonly type: "npm"; readonly name: string; readonly version: string }
  | { readonly type: "oss"; readonly bundle: string };

/** 已签名的发布清单(规范化 JSON 对象,含 `signature` 字段)。本仓不解析其内部结构,原样透传。 */
export type SignedManifest = Readonly<Record<string, unknown>>;

/** `resolve` 成功结果:自包含来源 + 已验签清单(registry 已在发布时验过签)。 */
export interface ResolvedRegistryEntry {
  readonly sourceId: string;
  readonly version: string;
  readonly origin: RegistryOrigin;
  /** 已签名清单;含逐文件 integrity,供落盘后复核。 */
  readonly manifest: SignedManifest;
  /** 显式指名已 yank 的版本时为 true(供 CLI 告警)。 */
  readonly yanked?: boolean;
}

/**
 * RegistryError 判别联合(本仓)。adapter 把 registry-client 的错误码归一到这里。
 */
export type RegistryError =
  /** source 不存在(或对调用方不可见,同响应)。 */
  | { readonly code: "SOURCE_ABSENT"; readonly sourceId: string }
  /** 同版本已存在(发布幂等冲突)。 */
  | { readonly code: "VERSION_EXISTS"; readonly sourceId: string; readonly version: string }
  /** 服务端拒绝版本(验签失败 / integrity 不符 / 回源失败等),带原因。 */
  | { readonly code: "VERSION_REJECTED"; readonly reason: string }
  /** 来源引用可变,发布侧**前置拒绝**(不把判定推给服务端,Req 7.8)。 */
  | { readonly code: "MUTABLE_REF"; readonly ref: string }
  /** 注册表不可达/超时,带地址供报错。 */
  | { readonly code: "UNREACHABLE"; readonly baseUrl: string; readonly detail?: string }
  /** 权限不足(非属主/未认证)。 */
  | { readonly code: "FORBIDDEN"; readonly detail?: string }
  /** 其它未归类错误(带原始 code + message)。 */
  | { readonly code: "OTHER"; readonly detail: string };

export interface RegistryPort {
  /** 解析(按 channel 或精确 version)→ 自包含来源 + 已验签清单。 */
  resolve(sourceId: string, opts?: { channel?: string; version?: string }): Promise<Result<ResolvedRegistryEntry, RegistryError>>;
  /** 代理上传 bundle tarball → registry 写 OSS → 内容寻址 key(发布侧不接触 OSS 凭据)。 */
  uploadBundle(sourceId: string, bytes: Uint8Array): Promise<Result<{ readonly bundle: string }, RegistryError>>;
  /** 代理下载 bundle 字节(安装侧不接触 OSS 凭据)。 */
  downloadBundle(sourceId: string, bundle: string): Promise<Result<Uint8Array, RegistryError>>;
  /** 登记新版本(origin 可变时**必须**在此前置失败,不推给服务端)。 */
  registerVersion(sourceId: string, origin: RegistryOrigin, manifest: SignedManifest): Promise<Result<void, RegistryError>>;
  /** 把发布通道指向某版本。 */
  setChannel(sourceId: string, channel: string, version: string): Promise<Result<void, RegistryError>>;
}
