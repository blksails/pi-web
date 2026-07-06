/**
 * canvas-plugin-stickers 前端插件捆(canvas-plugins-m3 · Req 6.1/6.2/6.4;design「范例」)。
 *
 * 一个扩展经 `defineWebExtension({ canvasPlugins:[stickersBundle] })`(见 web.config.tsx)贡献:
 *  - `stickerLayer`(`defineCanvasLayer<StickerData>`):emoji 贴纸图层。`Render` 按视口 `scale`
 *    显 emoji;`bake` 拍平时把 emoji 烤进 2D 上下文;`Inspector` 提供尺寸滑杆(`update` 传**完整
 *    新 data** 对象);
 *  - `stickerTool`(`defineCanvasTool`):贴纸工具。经 `createLayer` 声明「点击置层」——激活期在
 *    舞台按下即放置一枚 `kind:"sticker"` 图层(初值 emoji + size);工具上下文 `layers` 只读,
 *    放置写路径归装配层(不在工具内改层);
 *  - `styleTransferAction`(`defineCanvasAction`):风格迁移动作。`via:"command"` 走命令通道
 *    (对应 agent 侧 `style_transfer` 命令);`match` 经 `capability.actions.includes("style_transfer")`
 *    避让——agent 未声明该动作(非本范例 source)时该动作不参与决策(退化安全)。
 *
 * 命名空间:捆内 `tools/layers/actions` 的 `id/type` 与 `createLayer.kind` 由 `registerPluginBundles`
 * 施加 `<manifestId>:` 前缀(作者写本地名);`requires` 用**前缀化后**的全局名。故本地 layer
 * `type:"sticker"` → 全局 `canvas-plugin-stickers:sticker`,与 `requires` 一致命中。
 */
import { defineCanvasLayer, defineCanvasTool, defineCanvasAction } from "@blksails/pi-web-canvas-kit";
import type { ActionInput, CanvasPluginBundle } from "@blksails/pi-web-canvas-kit";

/** 贴纸图层私有数据(emoji 字形 + 字号 px)。 */
export interface StickerData {
  readonly emoji: string;
  readonly size: number;
}

/** 贴纸初值(放置时的 createLayer.data)。 */
const STICKER_DEFAULT: StickerData = { emoji: "🌟", size: 64 };

/** 尺寸滑杆范围(px)。 */
const SIZE_MIN = 16;
const SIZE_MAX = 256;

/** Inspector 可选 emoji 调色板(放置后经 update 换字形;放置初值固定 STICKER_DEFAULT.emoji)。 */
const EMOJI_PALETTE: readonly string[] = ["🌟", "❤️", "🔥", "✨", "🎉", "👍", "🌈", "⚡"];

/** emoji 贴纸图层:Render 显 emoji、bake 烤字、Inspector 调尺寸。 */
const stickerLayer = defineCanvasLayer<StickerData>({
  type: "sticker", // 命名空间后 = "canvas-plugin-stickers:sticker"
  Render: ({ layer, scale }) => {
    const d = (layer.data as StickerData | undefined) ?? STICKER_DEFAULT;
    return (
      <span
        data-sticker-emoji
        style={{
          fontSize: `${d.size * scale}px`,
          lineHeight: 1,
          userSelect: "none",
          display: "inline-block",
        }}
      >
        {d.emoji}
      </span>
    );
  },
  bake: (ctx2d, layer, size) => {
    const d = (layer.data as StickerData | undefined) ?? STICKER_DEFAULT;
    // Ctx2DLike 的 font/fillText 为可选原语(旧注入 fake 可缺省)→ 无则退化跳过(拍平不阻塞)。
    if (typeof ctx2d.fillText !== "function") return;
    ctx2d.font = `${d.size}px serif`;
    // Ctx2DLike 无 textAlign/textBaseline:默认左上/字母基线,y 取图层框高使 emoji 落在框内。
    ctx2d.fillText(d.emoji, 0, size.h);
  },
  Inspector: ({ layer, update }) => {
    const d = (layer.data as StickerData | undefined) ?? STICKER_DEFAULT;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div data-sticker-emoji-palette style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {EMOJI_PALETTE.map((emoji) => (
            <button
              key={emoji}
              type="button"
              data-sticker-emoji-pick={emoji}
              aria-pressed={emoji === d.emoji}
              onClick={() => update({ ...d, emoji } satisfies StickerData)}
              style={{ fontSize: 18, opacity: emoji === d.emoji ? 1 : 0.55 }}
            >
              {emoji}
            </button>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>大小</span>
          <input
            data-sticker-size-range
            type="range"
            min={SIZE_MIN}
            max={SIZE_MAX}
            value={d.size}
            onChange={(e) => update({ ...d, size: Number(e.target.value) } satisfies StickerData)}
          />
          <span>{d.size}px</span>
        </label>
      </div>
    );
  },
});

/** 贴纸工具:createLayer 声明「点击置层」(舞台按下放置一枚贴纸,自动选中)。 */
const stickerTool = defineCanvasTool({
  id: "sticker", // 命名空间后 = "canvas-plugin-stickers:sticker"
  label: "贴纸",
  icon: "🌟",
  overlayInteractive: true,
  createLayer: { kind: "sticker", data: STICKER_DEFAULT },
});

/**
 * 风格迁移动作(命令通道):把当前工作图 + 单张参考图交给 agent 侧 `style_transfer` 命令。
 * `match` 门槛:恰一张参考图 + prompt 以 "style:" 起头 + capability 白名单含 "style_transfer"
 * (避让——非本范例 source 无此白名单条目则不适用,评 false);命中评 85。
 */
const styleTransferAction = defineCanvasAction({
  id: "style-transfer", // 命名空间后 = "canvas-plugin-stickers:style-transfer"
  label: "风格迁移",
  match: (input: ActionInput) =>
    input.referenceIds.length === 1 &&
    input.prompt.startsWith("style:") &&
    input.capability.actions.includes("style_transfer")
      ? 85
      : false,
  buildArgs: (input: ActionInput) => ({
    image: input.imageId,
    style_ref: input.referenceIds[0],
    ...(input.model !== "" ? { model: input.model } : {}),
  }),
  execution: { via: "command", command: "style_transfer" },
});

/**
 * 贴纸插件捆。`requires` 用前缀化后的全局名(声明该捆依赖自带的 sticker 图层类型 —— 缺失
 * 时 registerPluginBundles 将贴纸工具注册为禁用态并出诊断,置灰 + tooltip 显缺失项)。
 */
export const stickersBundle: CanvasPluginBundle = {
  id: "stickers",
  requires: ["canvas-plugin-stickers:sticker"],
  tools: [stickerTool],
  layers: [stickerLayer],
  actions: [styleTransferAction],
};
