/**
 * attachment-store · 存储配置工厂 `attachmentStoreConfigFromEnv`(task 2.5;Req 1.8, 4.6, 7.2)。
 *
 * 从环境变量解析**附件存储目录约定**与**签名 secret**,并组合既有门面/后端/注册表/签名器构造出
 * 一个可用的 {@link AttachmentStore}(主进程实例化)。后端经配置选择(本切片 = {@link LocalFsBlobBackend}),
 * 为未来 S3 后端留缝(design.md §Architecture / BlobStore 可插拔)。
 *
 * 设计约束(design.md §config.ts / 环境变量约定 / UrlSigner;Req 1.8/4.6/7.2):
 * - **目录约定**(Req 7.2):`PI_WEB_ATTACHMENT_DIR` 是本地后端落盘位置的**单一来源**(类比会话工作目录);
 *   缺省时回落到约定默认目录 `~/.pi/agent/attachments`(与既有 `~/.pi/agent/*` 约定一致,
 *   见 `config/config-codec.ts` / `session-store/fs-store.ts`),保证默认目录稳定一致。
 * - **稳定 secret**(Req 4.6):HMAC 签名 secret 取自稳定来源 `PI_WEB_ATTACHMENT_SECRET`。子进程经 spawn env
 *   共享同一 secret 的场景**必须**用此稳定来源 —— 否则子进程产出的签名 URL 在主进程校验时 401。
 *   仅在**无子进程共享的纯单进程**场景下,未设置时可回退进程启动随机(经 {@link resolveAttachmentSecret});
 *   该随机回退在附件-tool(子进程共享)场景下不可用(需主/子进程一致)。
 * - **接口风格一致**(Req 1.8):后端经配置选择;组合既有受认可复用面,不另起第二套接口风格。
 *
 * 工厂构造的 store 用于**主进程**;下游 `attachment-tool-bridge` 会用**同样的 env**(经 spawn 下发的
 * `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET`)在子进程内组合实例化,故 secret 解析支持稳定 env 来源。
 */
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createUrlSigner,
  resolveAttachmentSecret,
  ATTACHMENT_SECRET_ENV,
} from "./url-signer.js";
import { LocalFsBlobBackend } from "./local-fs-backend.js";
import { AttachmentRegistry } from "./attachment-registry.js";
import { AttachmentStore } from "./attachment-store.js";
import { UnionBlobStore } from "./union-blob-store.js";
import {
  ATTACHMENT_BACKENDS_ENV,
  AttachmentBackendsConfigError,
  buildBackends,
  buildRegistry,
  computePassthroughEnv,
  parseBackendsEnv,
} from "./backends-config.js";

/**
 * 附件存储目录约定环境变量名(本地后端落盘位置的单一来源,Req 7.2)。
 *
 * 经 spawn env 下发给子进程,使子进程指向同一后端目录(透传归本 spec 拥有)。
 */
export const ATTACHMENT_DIR_ENV = "PI_WEB_ATTACHMENT_DIR";

/** 签名 secret 环境变量名(稳定来源,Req 4.6;复用自 url-signer,避免字面量漂移)。 */
export { ATTACHMENT_SECRET_ENV };

/**
 * 约定默认落盘目录(缺省 `PI_WEB_ATTACHMENT_DIR` 时回落,Req 7.2)。
 *
 * 与既有 `~/.pi/agent/*` 目录约定对齐(`config/config-codec.ts`、`session-store/fs-store.ts`),
 * 使默认目录稳定一致、绝对、归于 home 下。
 */
export function defaultAttachmentDir(): string {
  return join(homedir(), ".pi", "agent", "attachments");
}

/**
 * 解析附件存储目录约定(单一来源,Req 7.2)。
 *
 * 优先读取 `PI_WEB_ATTACHMENT_DIR`;缺省(未设或空)回落到 {@link defaultAttachmentDir}。
 *
 * @param env 环境变量来源(默认 `process.env`,便于测试注入)。
 */
export function resolveAttachmentDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env[ATTACHMENT_DIR_ENV];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return defaultAttachmentDir();
}

/** {@link attachmentStoreConfigFromEnv} 的返回:可用 store + 解析出的目录/secret(供装配方下发 spawn env)。 */
export interface AttachmentStoreConfig {
  /** 组合好的可用门面(单后端路径 = {@link LocalFsBlobBackend};多后端拓扑 = union 组合)。 */
  readonly store: AttachmentStore;
  /** 解析出的落盘根目录(本地后端单一来源);供主进程经 spawn env 下发给子进程。 */
  readonly dir: string;
  /** 解析出的签名 secret(稳定来源);供主进程经 spawn env 下发给子进程,保证主/子进程一致。 */
  readonly secret: string;
  /**
   * 子进程 spawn env 透传清单(`attachment-backend-pluggable` spec,Req 6.1):多后端拓扑生效时
   * 含拓扑 env 原文 + 全部被引用凭据变量;未设拓扑 env 时为空对象(单后端路径无需额外透传,
   * 既有 `PI_WEB_ATTACHMENT_DIR`/`PI_WEB_ATTACHMENT_SECRET` 透传不变)。
   */
  readonly passthroughEnv: Record<string, string>;
}

/**
 * 从环境变量解析目录/secret 并构造一个可用的 {@link AttachmentStore}(主进程实例化,Req 1.8/4.6/7.2)。
 *
 * - 目录:`PI_WEB_ATTACHMENT_DIR`(单一来源),缺省回落约定默认目录;
 * - secret:`PI_WEB_ATTACHMENT_SECRET`(稳定来源),缺省仅纯单进程可回退随机;
 * - 后端经配置选择(本切片 = LocalFs),组合 Registry + UrlSigner 成门面。
 *
 * 返回同时带 `dir`/`secret`,使装配方(`pi-handler`)能经 spawn env **同时下发**目录与 secret,
 * 让下游子进程用**同一** env 构造出指向同一目录、签名互验通过的 store。
 *
 * `options.writeProfile`(`agent-attachment-profile` spec,Req 3.2):子进程一会话一进程,
 * 静态覆盖多后端拓扑的写路由(优先于拓扑声明的默认 `write`)。仅在拓扑生效时有意义;
 * 未设拓扑时该选项被忽略(无后端可选,理论不可达——白名单校验权威在 runner 装配期,
 * 本工厂仅防御性接受)。指向未在拓扑中声明的名字 → 装配期抛
 * {@link AttachmentBackendsConfigError}(既有配置错误类型,fail fast)。
 *
 * @param env 环境变量来源(默认 `process.env`,便于测试注入)。
 */
export function attachmentStoreConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: { urlBasePath?: string; writeProfile?: string } = {},
): AttachmentStoreConfig {
  const dir = resolveAttachmentDir(env);
  // 稳定 secret 来源(Req 4.6);缺省仅纯单进程可回退随机(子进程共享场景需稳定且一致)。
  const secret = resolveAttachmentSecret(env);

  const signer = createUrlSigner(secret);
  // 分发 URL base path 前缀由**挂载方**决定(pi-handler 把端点挂在 `/api/**` 下 → 传 "/api");
  // 优先级:显式 options > env `PI_WEB_ATTACHMENT_URL_BASE`(经 spawn env 下发给子进程)> ""。
  // 缺省 ""(集成测试/直接构造不加前缀,签名校验不依赖前缀,既有 `/attachments/:id/raw` 形态不变)。
  const urlBasePath =
    options.urlBasePath ?? env["PI_WEB_ATTACHMENT_URL_BASE"] ?? "";

  // 多后端拓扑 env(`attachment-backend-pluggable` spec,Req 1.1/2.1):未设置 → 原路径原样保留
  // (存量单机部署零行为变化);设置 → union + registry 组装。
  const topology = parseBackendsEnv(env[ATTACHMENT_BACKENDS_ENV]);
  if (topology === undefined) {
    // ── 现状路径原样保留(单 LocalFs;存量部署零变化)──
    const backend = new LocalFsBlobBackend(dir, signer, urlBasePath);
    const registry = new AttachmentRegistry(dir);
    const store = new AttachmentStore({ blob: backend, registry, signer, backend });
    return { store, dir, secret, passthroughEnv: {} };
  }

  // 会话级静态写路由覆盖(agent-attachment-profile spec,Req 3.2):writeProfile 优先于拓扑
  // 声明的默认 write;必须命中已声明的后端名,否则装配期即失败(fail fast,不静默落到默认)。
  const writeProfile = options.writeProfile;
  if (
    writeProfile !== undefined &&
    !topology.backends.some((b) => b.name === writeProfile)
  ) {
    throw new AttachmentBackendsConfigError(
      `writeProfile "${writeProfile}" is not among the declared backend names`,
    );
  }

  const buildDeps = { signer, urlBasePath, dir, env };
  const named = buildBackends(topology, buildDeps);
  const registry = buildRegistry(topology, buildDeps);
  // localPath 委托:union 本身不实现 diskPath,首个参与组合的本地后端(若有)承接该能力
  // (design.md §门面与装配改动;非本地承载对象 localPath 天然返回 undefined)。
  const localBackend = named.find(
    (b): b is typeof b & { store: LocalFsBlobBackend } => b.store instanceof LocalFsBlobBackend,
  )?.store;
  const union = new UnionBlobStore({
    backends: named,
    writePolicy: () => writeProfile ?? topology.write,
    resolveBackendName: (key) => registry.get(key).then((d) => d?.backend),
  });
  const store = new AttachmentStore({ blob: union, registry, signer, backend: localBackend });
  return { store, dir, secret, passthroughEnv: computePassthroughEnv(topology, env) };
}
