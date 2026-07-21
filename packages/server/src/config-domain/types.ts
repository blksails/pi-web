/**
 * 配置域注册表 —— 类型契约与错误分类(spec: host-contract-ports,任务 5.3;Req 7.1-7.5)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §6。
 *
 * 目的:以**运行时注册**取代跨包硬编码的字面量联合(既有 `ConfigDomainId`),使宿主与
 * agent source 可各自注册自己关切的域,而不必改动 protocol 包。
 *
 * pi-SDK-free:只依赖 `zod` 与 protocol 的纯类型 `FormSchema`。
 */
import type { ZodTypeAny } from "zod";
import type { FormSchema } from "@blksails/pi-web-protocol";

/**
 * 一个配置域的完整描述:id + PUT 校验用 zod + 前端渲染用表单 IR。
 *
 * `id` 同时是落盘键(`<id>.json`,落 `workspace.user`,契约 §6 语义 5),故它必须满足
 * 键空间规则**且是单段**(不含分隔符)。
 */
export interface ConfigDomainDescriptor {
  readonly id: string;
  readonly schema: ZodTypeAny;
  readonly formSchema: FormSchema;
}

/** 注册失败的判别码。**跨边界按 `code` 判别,不用 `instanceof`**(与 WorkspaceError 同约定)。 */
export type ConfigDomainRegistrationErrorCode = "duplicate" | "invalid-id";

/**
 * 注册被拒。
 *
 * 两类拒绝合并到本类型的两个 `code` 上:id 不合法(含键空间违规与含分隔符两层)→
 * `invalid-id`;id 已存在 → `duplicate`。
 *
 * ⚠ 键校验层抛的是 `WorkspaceKeyError`(判别码 `key`),**不得**原样外泄给注册方:
 * 那会让「注册表的错误」多出一个契约 §6 未定义的判别码,调用方按 code 分流时漏接。
 * 故 `register` 捕获并转译为 `invalid-id`,原错误挂在 `cause` 上保留诊断信息。
 */
export class ConfigDomainRegistrationError extends Error {
  constructor(
    readonly code: ConfigDomainRegistrationErrorCode,
    readonly id: string,
    reason: string,
    options?: { readonly cause?: unknown },
  ) {
    super(`cannot register config domain ${JSON.stringify(id)}: ${reason}`, options);
    this.name = "ConfigDomainRegistrationError";
  }
}

/** 配置域注册表(契约 §6)。 */
export interface ConfigDomainRegistry {
  /** 注册一个域;id 非法或已存在时抛 {@link ConfigDomainRegistrationError}(绝不静默覆盖)。 */
  register(descriptor: ConfigDomainDescriptor): void;
  /** 按 id 查询;未注册返回 `undefined`(不抛)。 */
  get(id: string): ConfigDomainDescriptor | undefined;
  /** 列举全部已注册域,**按注册顺序**。 */
  list(): readonly ConfigDomainDescriptor[];
}
