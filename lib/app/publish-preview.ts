/**
 * publish-preview(spec publish-host-command,任务 2.1)——
 * `/agent publish` / `/plugin publish` 的**发布前预览**编排。
 *
 * ## 只做什么
 *
 * 编译 → kind 门 → 组装卡片数据。**不签名、不上传、不登记、零凭据、零外部写。**
 * 真实的清单解析、文件收集、逐文件 sha384 全在既有 `compile()` 里,本模块一行不重造。
 *
 * ## 为什么不用 `publish()` 编排器
 *
 * `publish-orchestrator.ts` 的 `publish()` **恒签名**(`opts.keyPath` 必填,编译后立刻
 * `sign()`)。复用它就等于必须在 web 宿主上引入私钥来源 —— 而发布身份已裁定归云端托管,
 * 本轮 pi-web 侧不引入任何私钥。故直接建在 `compile()` 之上。
 *
 * ## 预览 ≠ CLI 的 --dry-run
 *
 * CLI 的 `--dry-run` **是签名的**(它要求 `--key`,产出已签名清单)。本模块不签名,
 * 因此:给不出 `publisher` 指纹与签名,也验不出密钥类失败。这个差异经
 * `disclaimers` 两个**布尔位**如实传给渲染器 —— 用布尔位而不是一句文案,是为了让它
 * 成为可断言的结构,不会因改文案而静默失效。
 */
import type { PluginKind } from "@blksails/pi-web-protocol";
import {
  PUBLISH_PREVIEW_DATA_PART,
  type PublishPreviewData,
} from "@blksails/pi-web-protocol";
// 相对路径 + `.js`:仓库唯一在 vite dev / jiti 服务端 / esbuild 产物三条解析链上都成立的形态。
import { compile, type CompileError } from "../../server/cli/publish/manifest-compiler.js";
import { redactSecrets } from "../../server/cli/reporter.js";

export { PUBLISH_PREVIEW_DATA_PART };

/** 预览恒携带的差异声明:本轮永远是「未签名 + 未验授予」。 */
const PREVIEW_DISCLAIMERS = { unsigned: true, grantNotChecked: true } as const;

/**
 * `CompileError` → 用户可见说明。
 *
 * **八个分支逐一给文案,不压成一条** —— 它们对应的是完全不同的修复动作,
 * 压成「编译失败」等于把定位工作原样丢回给用户。`hint` 一律回答"改哪里"。
 */
export function describeCompileError(e: CompileError): {
  code: string;
  message: string;
  hint?: string;
} {
  switch (e.code) {
    case "MANIFEST_MISSING":
      return {
        code: e.code,
        message: "目标目录没有发布清单,无法发布。",
        // ★ 刻意**只回显清单文件名,不回显完整路径**。
        //   `expectedPath` 由用户传入的 dir 拼成,是用户可控数据;而 `path.resolve` 会把
        //   `https://user:token@host/x` 压成 `https:/user:token@host/x`(单斜杠),
        //   `redactSecrets` 的 URL 凭据规则要求 `://`,对这个形态**失效** ——
        //   单测当场抓到凭据经此漏出。与其给脱敏打补丁,不如不回显用户可控路径:
        //   用户本就知道自己传了什么目录,完整路径对定位没有增量价值。
        hint: `请在目标目录下创建 ${e.expectedPath.split(/[/\\]/).pop() ?? "pi-web.json"}。`,
      };
    case "MANIFEST_INVALID":
      return {
        code: e.code,
        message: `发布清单不合法:${e.issues.join(";")}`,
        hint: "按上列问题逐条修正清单后重试。",
      };
    case "MANIFEST_KIND_REQUIRED":
      return {
        code: e.code,
        message: `发布清单必须显式声明 "kind",可选取值:${e.allowed.join(" | ")}。`,
        // 这条不是啰嗦:两侧缺省相反,靠猜必错一半,历史上已因此把包发成过错误类型。
        hint:
          "不能省略:pi-web 侧缺省为 plugin、registry 侧缺省为 agent,两者相反," +
          "省略会让包被发成错误类型。",
      };
    case "DECLARED_PATH_MISSING":
      return {
        code: e.code,
        message: `清单声明了但不存在的文件:${e.paths.join(", ")}`,
        hint: "补上这些文件,或从清单里移除对应声明。",
      };
    case "ENTRY_NOT_FOUND":
      return {
        code: e.code,
        message: `kind=agent 但探测不到入口文件(已按序尝试:${e.candidates.join(", ")})。`,
        hint: "补一个约定入口文件,或在 package.json 的 pi-web.entry 里显式指定。",
      };
    case "ENTRY_OVERRIDE_MISSING":
      return {
        code: e.code,
        message: `package.json#pi-web.entry 指向的文件不存在:${e.declared}`,
        hint: "修正该声明或补上文件 —— 显式声明不会静默回退到约定入口。",
      };
    case "ENTRY_OUTSIDE_PACKAGE":
      return {
        code: e.code,
        message: `入口解析结果越出了包目录:${e.resolved}`,
        // 前置拦截的意义:registry 侧同样会拒,但那时版本号已经烧掉了。
        hint: "把入口移进包目录内。registry 侧也会拒绝包外路径,在此提前拦下以免烧掉一个版本号。",
      };
    case "WEBEXT_SOURCE_WITHOUT_DIST":
      return {
        code: e.code,
        message: `存在 webext 源(${e.source})但缺少对应产物(${e.expectedDist})。`,
        hint: "先构建 webext 产物再发布 —— 缺产物会让生产环境的面板直接失效。",
      };
    case "KEY_UNUSABLE":
      // 本轮不签名,理论上不可达;仍穷尽以保证将来接上签名时编译器会提醒补文案。
      return {
        code: e.code,
        message: `签名私钥不可用(${e.reason})。`,
        hint: "本轮预览不签名,出现该错误说明调用方误传了密钥路径。",
      };
  }
}

export interface PublishPreviewDeps {
  /** 测试注入点;缺省真实 `compile()`。生产不传。 */
  readonly compileFn?: typeof compile;
}

export type PreviewOutcome = {
  readonly data: PublishPreviewData;
  /** 供 handler 组装 `CommandResult.message`(失败时为错误文案,成功时为一句概述)。 */
  readonly message: string;
};

function failure(
  code: string,
  message: string,
  hint?: string,
): PreviewOutcome {
  return {
    data: {
      ok: false,
      files: [],
      warnings: [],
      disclaimers: PREVIEW_DISCLAIMERS,
      // ★ `hint` 同样要脱敏:它常把用户传入的路径原样嵌进去(如 MANIFEST_MISSING 的
      //   expectedPath),而那条路径可能是 `https://user:token@host/...` 这类形态。
      //   早先只脱敏 message,单测当场抓到 `hint` 把凭据漏了出去。
      error: {
        code,
        message: redactSecrets(message),
        ...(hint !== undefined ? { hint: redactSecrets(hint) } : {}),
      },
    },
    message: redactSecrets(message),
  };
}

/**
 * 对一个本地包目录做发布前预览。
 *
 * @param expectedKind 命令锁定的类别(命令名即意图)。清单 `kind` 与之不符即拒绝并指路 ——
 *                     **清单是权威**,与 registry 安装通道同一心智。
 */
export async function previewPublish(
  packageDir: string,
  expectedKind: PluginKind,
  deps: PublishPreviewDeps = {},
): Promise<PreviewOutcome> {
  const compileFn = deps.compileFn ?? compile;
  const compiled = await compileFn(packageDir);

  if (!compiled.ok) {
    const d = describeCompileError(compiled.error);
    return failure(d.code, d.message, d.hint);
  }

  const pkg = compiled.value;

  // kind 门:清单权威。与命令锁定类别不符 → 拒绝并指出应改用哪条命令。
  if (pkg.kind !== expectedKind) {
    const alt = pkg.kind === "component" ? undefined : `/${pkg.kind} publish`;
    return failure(
      "PUBLISH_KIND_MISMATCH",
      `该包的发布清单声明类别是 "${pkg.kind}",而当前命令按 "${expectedKind}" 处理。`,
      alt !== undefined
        ? `请改用 ${alt}。`
        : "component 包不经 publish 车道分发;请在目标 source 目录内使用 `pi-web add` 安装组件包。",
    );
  }

  return {
    data: {
      ok: true,
      package: {
        id: pkg.id,
        version: pkg.version,
        kind: pkg.kind,
        displayName: pkg.displayName,
      },
      files: pkg.refs.map((r) => ({ path: r.path, integrity: r.integrity })),
      // 告警是**一等字段**:并进 steps 会被渲染成"成功步骤"或"失败步骤",两种都不对。
      warnings: [...pkg.warnings],
      disclaimers: PREVIEW_DISCLAIMERS,
    },
    message: `预览通过:${pkg.id}@${pkg.version}(${pkg.kind},${pkg.refs.length} 个文件)。这只是发布前校验,尚未发布。`,
  };
}
