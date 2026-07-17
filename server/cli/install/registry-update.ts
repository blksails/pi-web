/**
 * registry-update —— `pi-web update` 的 registry agent 通道(cli-package-commands
 * update 对齐补记,Req 4.8–4.10)。
 *
 * 既有 `update` 子命令只覆盖 plugin 通道(`plugin-installer.ts` 的 `update()`,shell out
 * `pi update`);经注册表安装(`registry-install.ts`)落到 `PI_WEB_REGISTRY_INSTALL_DIR`
 * 的包此前**没有任何更新通道**。本模块补齐它:
 *
 *   枚举安装根下带回执(`.pi-web-registry.json`)的子目录 → 逐项 resolve 该 source 的
 *   channel 当前指向 → 与回执版本比对 → 不同则经 `installFromRegistry` 原子重装并滚动回执。
 *
 * ## 设计裁决
 *
 * 1. **update 的语义是「对齐 channel 当前指向」,不是「只升不降」** —— channel 是 registry
 *    侧的权威(可以前移也可以回撤指向旧版,例如线上回滚);安装侧跟随即可,不做 semver
 *    大小比较。`resolved.version !== receipt.version` 即触发重装。
 *
 * 2. **pinned 如实跳过,不发起任何网络调用**(对齐 plugin 通道对钉死包的裁决,Req 4.6)——
 *    回执带 `pinnedVersion` 说明用户 install 时显式钉死了精确版本,update 报 `skipped`
 *    并给出如何解除钉死的指引。
 *
 * 3. **逐项独立、失败不中断**(Req 4.7)—— 与 plugin 通道同一汇总形状
 *    (`UpdatePackageOutcome[]` + `hasFailures`),调用方(`runUpdate`)合并两通道结果后
 *    统一决定退出码。`updated` 的 outcome 在 `reason` 里携带 `旧版 → 新版`(registry 通道
 *    真实观察到了版本跃迁,与 plugin 通道「无法断言确实推进了版本」的不确定性不同,这里
 *    的信息是可信的,值得呈现)。
 *
 * 4. **registry 未配置但存在本通道安装 → 逐项 failed,不静默跳过** —— 用户明确装过
 *    registry 包,`update` 却默不作声地掠过它们,是谎报「全部更新完成」。没有回执目录的
 *    用户(纯 plugin 用户)则完全不受影响(枚举为空,无输出)。
 *
 * 5. **两次 resolve 的 TOCTOU 可接受** —— 本模块 resolve 一次做版本比对,
 *    `installFromRegistry` 内部会再 resolve 一次实际安装。两次之间 channel 理论上可能又
 *    移动,但最终装到、写进回执的都是第二次 resolve 的结果,不会产生「回执与落盘不符」。
 *    不能把第一次的 version 钉给 `installFromRegistry`:显式 version 会被记成
 *    `pinnedVersion`,之后的 update 将永远跳过它。
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  installFromRegistry,
  readInstallReceipt,
  registryInstallDirName,
  type RegistryInstallReceipt,
} from "./registry-install.js";
import type { RegistryPort } from "../registry/registry-port.js";
import type { UpdatePackageOutcome } from "./plugin-installer.js";

/** 一条本通道的已安装条目:安装目录 + 回执。 */
export interface RegistryInstallEntry {
  readonly dir: string;
  readonly receipt: RegistryInstallReceipt;
}

/**
 * 枚举安装根下所有带有效回执的子目录。根不存在/不可读 → 空列表(本通道无安装,
 * 与「根存在但为空」不作区分 —— 两者对 update 的语义相同)。
 */
export function listRegistryInstalls(rootDir: string): RegistryInstallEntry[] {
  let names: string[];
  try {
    names = readdirSync(rootDir);
  } catch {
    return [];
  }
  const entries: RegistryInstallEntry[] = [];
  for (const name of names.sort()) {
    const dir = join(rootDir, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const receipt = readInstallReceipt(dir);
    if (receipt) entries.push({ dir, receipt });
  }
  return entries;
}

/**
 * 在本通道台账中查找 `packageId` 命中的条目(供 `runUpdate` 判别通道归属):
 * 匹配回执的 `sourceId`,或目录名等于 `registryInstallDirName(packageId)`(与 install
 * 落盘时同一 sanitize 规则)。
 */
export function findRegistryInstalls(
  entries: readonly RegistryInstallEntry[],
  packageId: string,
): RegistryInstallEntry[] {
  const dirName = registryInstallDirName(packageId);
  return entries.filter(
    (e) => e.receipt.sourceId === packageId || e.dir.endsWith(`/${dirName}`) || e.dir.endsWith(`\\${dirName}`),
  );
}

/** 与 plugin 通道同形的汇总结果(`hasFailures` 供调用方决定退出码)。 */
export interface UpdateRegistryResult {
  readonly outcomes: readonly UpdatePackageOutcome[];
  readonly hasFailures: boolean;
}

/**
 * 逐项更新本通道的已安装条目。`registry` 为 undefined(未配置 `PI_WEB_REGISTRY_URL`)
 * 且条目非空时,逐项 `failed`(设计裁决 4)。
 */
export async function updateRegistryInstalls(
  registry: RegistryPort | undefined,
  entries: readonly RegistryInstallEntry[],
): Promise<UpdateRegistryResult> {
  const outcomes: UpdatePackageOutcome[] = [];
  let hasFailures = false;

  for (const { dir, receipt } of entries) {
    const id = receipt.sourceId;

    if (receipt.pinnedVersion !== undefined) {
      outcomes.push({
        id,
        status: "skipped",
        reason:
          `安装时钉死为 ${receipt.pinnedVersion},不自动更新;` +
          `要换版本请重新 \`pi-web install ${id}\`(不指定版本即跟随 channel)。`,
      });
      continue;
    }

    if (registry === undefined) {
      hasFailures = true;
      outcomes.push({
        id,
        status: "failed",
        reason: "未配置注册表(设置 PI_WEB_REGISTRY_URL 后重试)。",
      });
      continue;
    }

    const resolved = await registry.resolve(id, {
      ...(receipt.channel !== undefined ? { channel: receipt.channel } : {}),
    });
    if (!resolved.ok) {
      hasFailures = true;
      outcomes.push({ id, status: "failed", reason: `resolve 失败: ${JSON.stringify(resolved.error)}` });
      continue;
    }

    if (resolved.value.version === receipt.version) {
      outcomes.push({
        id,
        status: "skipped",
        reason: `已是最新 (${receipt.version}${receipt.channel !== undefined ? `,channel ${receipt.channel}` : ""})`,
      });
      continue;
    }

    const installed = await installFromRegistry(registry, id, {
      ...(receipt.channel !== undefined ? { channel: receipt.channel } : {}),
      targetDir: dir,
    });
    if (!installed.ok) {
      hasFailures = true;
      outcomes.push({ id, status: "failed", reason: `重装失败: ${JSON.stringify(installed.error)}` });
      continue;
    }
    outcomes.push({ id, status: "updated", reason: `${receipt.version} → ${installed.value.version}` });
  }

  return { outcomes, hasFailures };
}
