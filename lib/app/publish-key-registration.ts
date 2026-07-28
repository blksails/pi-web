/**
 * 公钥自动登记的编排(spec publish-key-lifecycle,Req 2)——
 * 发布前**尽力**让本机公钥出现在本企业 publisher 名下。
 *
 * ## best-effort 的含义(这是本模块最重要的性质)
 *
 * 任何一步失败都**静默返回**,不抛、不改调用方的任何输出。理由与
 * `DesktopCapabilitiesClient.getSourcesGrant` 的 fail-soft 同源:登记是发布的**准备**,
 * 不是发布本身。让它抛会把"公钥暂时登记不上"升级成"发布预览整个崩" ——
 * 而预览本可以照常给出编译校验与文件清单。
 *
 * ## 本地回执只是**省一次网络往返**,不是正确性依赖
 *
 * 回执可能被删、可能换机器、可能并发 —— 这些都会导致重复登记请求。因此
 * **服务端把"已存在"当成功是必需的**(见 cloud 的 `publish-key-registration.ts`),
 * 本地回执失效只会多打一次网络,不会产生错误状态。
 *
 * 回执**在服务端确认成功之后**才写:反过来(先写后调)会在失败时留下一个
 * "以为登记过了"的假状态,而那正是 Req 2.5「不留半状态」要防的。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { createLogger } from "@blksails/pi-web-logger";
import type { PublishKeyInfo, KeystoreError } from "../../server/cli/publish/keystore.js";
import type { Result } from "../../server/cli/publish/manifest-compiler.js";

const logger = createLogger({ namespace: "app:publish-key-registration" });

/** 回执文件名(与密钥同目录)。 */
export const REGISTRATION_RECEIPT_FILENAME = "registered.json";

/** 回执内容。只有可公开物 —— **绝不**含 token 或私钥。 */
interface RegistrationReceipt {
  readonly fingerprint: string;
  readonly publisherId: string;
}

export interface RegisterPublishKeyFn {
  (input: { readonly publicKey: string; readonly label: string }): Promise<
    { readonly ok: true; readonly fingerprint: string; readonly publisherId: string } | { readonly ok: false }
  >;
}

export interface PublishKeyRegistrationDeps {
  readonly ensureKey: () => Result<PublishKeyInfo, KeystoreError>;
  /** 有发布授予才登记 —— 没授予说明这台机器还不到能发布的阶段。 */
  readonly getPublishGrant: () => Promise<{ readonly publisherId: string } | undefined>;
  readonly registerPublishKey: RegisterPublishKeyFn;
  /** 回执路径。缺省 `<密钥目录>/registered.json`。 */
  readonly receiptPath?: string;
  /** 标签来源,缺省本机主机名(测试注入)。 */
  readonly hostLabel?: () => string;
}

function readReceipt(path: string): RegistrationReceipt | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RegistrationReceipt>;
    if (typeof parsed.fingerprint !== "string" || typeof parsed.publisherId !== "string") return undefined;
    return { fingerprint: parsed.fingerprint, publisherId: parsed.publisherId };
  } catch {
    // 回执坏了就当没有 —— 它只是缓存,重登一次即可(与密钥文件的处理**刻意不同**:
    // 那个坏了必须报错,因为覆盖会毁掉不可再生的私钥;回执随时可重建)。
    return undefined;
  }
}

function writeReceipt(path: string, receipt: RegistrationReceipt): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // 写不下回执只影响下次是否多打一次网络,不影响正确性 —— 不升级为失败。
    logger.debug("publish key receipt write failed");
  }
}

/**
 * 登记编排的结果。
 *
 * ★ 三态而非布尔:`already`(回执命中)与 `registered`(本次刚登记)对**调用方的含义相同**
 * ——公钥已就位——但对诊断的含义完全不同。用布尔表示会逼出一个选择:要么把 `already`
 * 记成 `false`(于是"已就位"被误判成"没就位",真实发布路径会据此拒绝),要么记成 `true`
 * (于是分不清是否打了网络)。这正是 spec publish-execution 把它升为硬前置时暴露的问题。
 */
export type PublishKeyRegistrationOutcome =
  /** 本次向服务端登记成功。 */
  | "registered"
  /** 回执命中,此前已登记 —— **同样表示公钥已就位**。 */
  | "already"
  /** 未登记:无密钥 / 无授予 / 登记失败。 */
  | "skipped";

/** 公钥是否已就位(可以发布)。 */
export function isKeyInPlace(outcome: PublishKeyRegistrationOutcome): boolean {
  return outcome !== "skipped";
}

/**
 * 确保本机公钥已登记。**永不抛**。
 */
export async function ensurePublishKeyRegistered(
  deps: PublishKeyRegistrationDeps,
): Promise<PublishKeyRegistrationOutcome> {
  try {
    const key = deps.ensureKey();
    if (!key.ok) {
      // 密钥都拿不到就谈不上登记。这里不报错:调用方(发布预览)有自己的失败面,
      // 而密钥问题会在真正需要签名时以明确的方式暴露。
      logger.debug("publish key unavailable; skip registration", { code: key.error.code });
      return "skipped";
    }

    const receiptPath = deps.receiptPath ?? join(dirname(key.value.path), REGISTRATION_RECEIPT_FILENAME);
    const grant = await deps.getPublishGrant();
    if (grant === undefined) return "skipped";

    // 幂等短路:同一把钥匙、同一个 publisher 已登记过 → 不打网络。
    // 比对**两者**而非只比指纹:换了企业(publisherId 变)时必须重登。
    const receipt = readReceipt(receiptPath);
    if (receipt?.fingerprint === key.value.fingerprint && receipt.publisherId === grant.publisherId) {
      return "already";
    }

    const label = (deps.hostLabel ?? hostname)();
    const result = await deps.registerPublishKey({ publicKey: key.value.publicKey, label });
    if (!result.ok) return "skipped";

    writeReceipt(receiptPath, { fingerprint: result.fingerprint, publisherId: result.publisherId });
    return "registered";
  } catch {
    // 兜底:本函数对调用方的契约是"永不抛"。
    logger.debug("publish key registration skipped due to unexpected error");
    return "skipped";
  }
}
