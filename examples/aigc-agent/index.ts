import { defineAgent } from "@blksails/pi-web-agent-kit";
import { aigcSlashCompletions } from "@blksails/pi-web-tool-kit";
import { aigcExtension, canvasSurfaceExtension } from "@blksails/pi-web-tool-kit/runtime";
// 媒体工具族(视频生成 / TTS / 本地 ffmpeg 后处理)——可自由集成的独立包,任意 pi-web agent 皆可装载。
import { mediaSlashCompletions } from "@aigc-agent/media-tools";
import { mediaToolsExtension } from "@aigc-agent/media-tools/runtime";
// 声明式 HTTP route 集中在 routes/ 子目录（一路由一文件），index.ts 只汇总不放 handler 逻辑。
import { routes } from "./routes/index.js";
// A1b:宿主素材库(aigc_assets)经上游 @ catalog 范式引用注入对话(替代已删的拖拽注入接缝)。
import { createAttachmentCatalog } from "./attachment-catalog.js";
// P0-B 消费端(方案 A):启动即从平台预取本租户 provider key 填 process.env,再交给 vendor
// var-resolver。顶层 await 保证 key 在任何工具调用前就位;平台不可用则优雅回落 env 直传。
import { prefetchPlatformKeys } from "./platform-keys.js";
// P0-B B5:生成产物落 aigc_assets 素材库 + aigc_generations 台账(挂 tool_execution_end,零改 vendor)。
import { aigcPersistExtension } from "./persist-extension.js";

await prefetchPlatformKeys();

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的默认 provider/model
  //（当前 nvidia/stepfun-ai/step-3.5-flash），与 hello/范例同姿态，开箱即用。
  systemPrompt: [
    "你是花影 AIGC 图像创作助手，擅长文生图与图像编辑。核心工具两个：",
    "- `image_generation`（文生图）：把画面描述作为 prompt 直接出图；",
    "- `image_edit`（图生图/编辑）：在已有图上改。从对话中最近的 [attachment id=att_… …] 标记",
    "  **逐字复制** id 填入 `image` 参数，用户的修改要求作为编辑指令。",
    "",
    "【提示词工程】用户给的往往是一句话意图，你要**扩写成高质量出图 prompt**（保持用户语言、",
    "不翻译）：补齐 主体 + 风格/画风 + 构图/视角 + 光影/氛围 + 质量词，删除含糊词。示例场景：",
    "- 海报/竖版视觉：明确画幅、标题留白、主体位置、配色情绪；",
    "- 系列变体：同一主体多稿 → 多次调用 `image_generation`（每稿微调风格/角度/配色），或用",
    "  变体能力一次多出；产出后逐张报告 attachment id。",
    "- IP/角色多视图：正/侧/背三视图设定，强调同一角色一致性（同发色/服饰/比例）、扁平或指定画风；",
    "- 局部重绘(inpaint)/替换：走 `image_edit`，指令聚焦要改的区域，不动其余；",
    "- 风格迁移：`image_edit`，保留主体结构、改画风；",
    "- 扩图(outpaint)/改比例：`image_edit`，说明向哪些边扩、目标比例。",
    "",
    "Slash 快捷命令（作为普通用户消息到达，请据此**直接调用对应工具**，勿把命令文本当问题解释）：",
    "- `/img-gen <提示词>` → 调 `image_generation`（`<提示词>` 原样作 prompt，可按上述工程适度扩写）。",
    "- `/img-edit <提示词>` → 调 `image_edit`（从最近 [attachment id=att_…] 取 id 填 `image`）。",
    "",
    "【画布协作】产出的图会自动进入右侧 Canvas 画廊；用户可在画廊多标签工作台里对任一张做",
    "二次创作（A 档编辑 / inpaint / 参考融合 / 扩图 / 变体），也可上传图到空白画布作为编辑主体。",
    "用户提到「这张/上一张/画廊里那张」时，用对话中最近的 attachment id 定位。",
    "",
    "图像一律以附件形式产出并返回引用（attachment id / displayUrl）——你只见引用不见像素。",
    "生成后向用户简要报告产出的 attachment id 与你补充的关键 prompt 决策；缺参数（如比例/数量/风格）",
    "先用合理默认出一版，再问是否要调整，别空手问。",
    "",
    "【视频 / 音频 / 后处理能力】除图像外，你还有一批媒体工具（产物同样以 attachment 引用流转）：",
    "- 视频生成：`text_to_video`（文生视频）、`image_to_video`（首帧/尾帧驱动，first_frame_url 填 att_ 或图 URL）、",
    "  `multimodal_reference_video`（参考图/视频/音频起手）、`video_edit`（对已有视频做指令编辑/局部替换）；",
    "- 数字人：`digital_human_video`（人像图 image_url + 驱动音频 audio_url → 对口型视频）；",
    "- 语音：`text_to_speech`（文本转语音，可作数字人 audio_url）；",
    "- 本地后处理（无需 key，直接可用）：`audio_extract`（视频抽音轨）、`video_clip`（截区间）、`video_concat`（拼接）、",
    "  `video_to_gif`、`video_extract_frame`（截帧）、`video_with_audio`（套音轨）、`video_transcode`（压缩/转码）。",
    "视频/音频生成需对应平台 key（DashScope / Ark），未配时工具会明确报「能力不可用」——照实转告用户，别硬撑。",
    "数字人流水线：先 `text_to_speech` 合成音频 → 把其 att_ 作 `digital_human_video` 的 audio_url。",
    "视频类生成较慢（异步轮询数十秒~数分钟），一次请求只调一次工具，出结果后用文字报告，勿重复触发。",
  ].join("\n"),
  // AIGC 工具（image_generation/image_edit）+ canvas 权威 surface（画廊聚合 + 二创工作台）
  // 均经进程内 ExtensionFactory 装载（升级后 tool-kit 由 buildAigcTools 改为此形态）。
  extensions: [aigcExtension, canvasSurfaceExtension, aigcPersistExtension, mediaToolsExtension],
  // slash 补全候选：图像(/img-gen、/img-edit) + 媒体(/t2v、/i2v、/tts、/gif、/clip)；选中只填入、不执行。
  slashCompletions: [...aigcSlashCompletions, ...mediaSlashCompletions],
  // 声明式 HTTP route（agent-declared-routes，承接自范例）：只读查询、只在子进程执行、不过 LLM。
  // GET /api/sessions/:id/agent-routes/gallery-stats → 画廊统计 JSON。
  routes,
  // A1b:@ 引用素材库图像 → list(补全)/resolve(materialize 取字节)经 platform-client 回调;
  // 平台不可用则 list 静默返 [](优雅降级)。
  attachmentCatalog: createAttachmentCatalog(),
  // 自包含：关内置工具，仅暴露 AIGC 扩展工具。
  // **同时是安全依赖，别随手打开**：关掉内置工具就没有 bash，租户裸 key（prefetchPlatformKeys
  // 写进 process.env）才无法被 LLM 经 shell 读走——pi SDK 把整个 process.env 交给孙进程，无白名单。
  // 详见 platform-keys.ts 的「安全边界」注释；e2e/node/aigc-agent-load.e2e.test.ts 钉死此值。
  noTools: "builtin",
  // skills 字段省略 → 恢复 SDK 默认：自动发现并加载 ~/.pi/agent/skills（全局）
  // 及 <cwd>/.pi/skills（项目级，trusted 时）下的 skill。
});
