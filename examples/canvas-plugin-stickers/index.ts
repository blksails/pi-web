/**
 * canvas-plugin-stickers — Canvas **插件双端范例**(canvas-plugins-m3 · Req 6.1–6.5)。
 *
 * 面向「插件作者」的 canonical 参照:一个扩展同时贡献
 *  - **前端插件捆**(`.pi/web/stickers.tsx`):贴纸图层(`defineCanvasLayer`)+ 贴纸工具
 *    (`defineCanvasTool` 经 `createLayer` 声明「点击置层」)+ 风格迁移动作(`defineCanvasAction`,
 *    `via:"command"` 且 `match` 经 `capability.actions.includes` 避让);经 `.pi/web/web.config.tsx`
 *    的 `defineWebExtension({ canvasPlugins:[stickersBundle] })` 挂上车道①,与 `CanvasLauncher`/
 *    `CanvasPanel` 复用同一 Canvas 表面;
 *  - **agent 侧命令**(本文件):在 `aigc-canvas` 权威 surface 基础上追加 `style_transfer` 命令
 *    与同名 `extraActions` 白名单条目,使前端 `styleTransferAction` 的命令通道有对应处理器
 *    且进入 `capability.actions`(前端据此放行该 command 动作)。
 *
 * 装载 = `extensions: [aigcExtension, stickersCanvasExtension]`:
 *  - `aigcExtension`:`image_generation` / `image_edit` 工具(LLM 生成图落 `att_`,触发源 ①);
 *  - `stickersCanvasExtension`:`makeCanvasSurfaceExtension` 带 deps 变体 —— `commandDeps.extraCommands`
 *    注入 `style_transfer` 处理器,`extraActions:["style_transfer"]` 令能力清单可见该动作。
 *
 * `style_transfer`(风格迁移)= 「参考图融合」的语义特化:把 `style_ref` 作为参考图、按 `strength`
 * 生成风格化提示词,**复用**内置 `reference` 命令(经 `createCanvasCommands`)执行 `runImageTool`
 * 并落库 prepend(`derivedFrom = image`)—— 不重造血缘/落库编排(照 `commands.ts` 内置 handler 手法)。
 *
 * 执行层经 `@blksails/pi-web-tool-kit/runtime` 子入口引入(含 pi SDK 值导入,仅 jiti 子进程加载,
 * 不进 Next 服务端 bundle)。model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { aigcSlashCompletions } from "@blksails/pi-web-tool-kit";
import {
  aigcExtension,
  createCanvasCommands,
  makeCanvasSurfaceExtension,
  type GalleryState,
  type SurfaceCommandHandler,
} from "@blksails/pi-web-tool-kit/runtime";

/** 风格强度缺省(0 = 轻微上色,1 = 完全重绘);越界钳制到 [0,1]。 */
const DEFAULT_STRENGTH = 0.6;

/** 由强度生成风格迁移提示词(保留源图构图/主体,仅迁移参考图的风格质感)。 */
function styleTransferPrompt(strength: number): string {
  return [
    "Transfer the artistic style from the reference image onto the source image.",
    "Preserve the source image's composition, subjects, and structure;",
    "apply only the reference's stylistic qualities (color palette, texture, brushwork).",
    `Style strength: ${strength.toFixed(2)} (0 = subtle tint, 1 = full restyle).`,
  ].join(" ");
}

// 复用内置 `reference` 命令(参考图融合):其内部 `runImageTool(reference_images=[…])` → 落库
// prepend(derivedFrom = image)。取一次纯内置命令表(无 extraCommands 注入 → 纯 builtin),
// capability 由 surface 快照继承(命令 reducer 从 s.capabilities 继承,不依赖此处 capability)。
const builtinCommands = createCanvasCommands();

/**
 * `style_transfer`:风格迁移命令。args = `{ image, style_ref, strength?, model? }`。
 * 构造参考图融合参数后委派内置 `reference`(不重造落库/血缘编排);缺 `image`/`style_ref`
 * → 非抛错显式失败(`{ok:false}`,保留稳定领域 code,不留半态)。
 */
const styleTransfer: SurfaceCommandHandler<GalleryState> = (args, ctx) => {
  const a = (args ?? {}) as Record<string, unknown>;
  const image = typeof a.image === "string" ? a.image : "";
  const styleRef = typeof a.style_ref === "string" ? a.style_ref : "";
  if (image === "" || styleRef === "") {
    return {
      ok: false as const,
      error: {
        code: "invalid_args",
        message: "style_transfer requires `image` and `style_ref` att_ ids",
      },
    };
  }
  const reference = builtinCommands.reference;
  if (reference === undefined) {
    return { ok: false as const, error: { code: "internal", message: "reference command unavailable" } };
  }
  const strength =
    typeof a.strength === "number" ? Math.min(1, Math.max(0, a.strength)) : DEFAULT_STRENGTH;
  const params: Record<string, unknown> = {
    image,
    reference_images: [styleRef],
    prompt: styleTransferPrompt(strength),
  };
  if (typeof a.model === "string" && a.model !== "") params.model = a.model;
  return reference(params, ctx);
};

export default defineAgent({
  systemPrompt: [
    "You are canvas-plugin-stickers, a pi-web example showing a two-sided Canvas plugin.",
    "- Use `image_generation` to generate images; use `image_edit` to edit an uploaded image",
    "  (copy the public id from the [attachment id=att_… …] marker into the tool's `image`).",
    "Generated images land as attachments and are aggregated by the Canvas gallery.",
    "In the Canvas workbench the user can drop emoji stickers as plugin layers and run",
    "`style_transfer` (a plugin command) directly; those actions bypass the LLM. Keep chat replies concise.",
  ].join("\n"),
  // 进程内 ExtensionFactory 装载:AIGC 工具 + canvas 权威 surface(带 style_transfer 插件命令)。
  // 包 void 箭头(对齐 canvasSurfaceExtension):makeCanvasSurfaceExtension 返回 (pi)=>SurfaceHandle,
  // 装配后其返回的 handle 由 SDK 内部持有,ExtensionFactory 只需 void。pi 由 extensions 元素上下文定型。
  extensions: [
    aigcExtension,
    (pi) => {
      makeCanvasSurfaceExtension({
        commandDeps: { extraCommands: { style_transfer: styleTransfer } },
        extraActions: ["style_transfer"],
      })(pi);
    },
  ],
  // slash 补全候选(/img-gen、/img-edit)。
  slashCompletions: aigcSlashCompletions,
  // Self-contained:关掉内置工具与磁盘 skills,保持示例 hermetic。
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
