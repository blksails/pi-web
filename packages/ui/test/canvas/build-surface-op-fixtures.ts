/**
 * build-surface-op golden fixtures(任务 4.1)。
 *
 * 期望文本由**迁移前** `buildToolPrompt` 捕获固化(六动作 × mask/refs 有无组合 + 意图截断/最小/
 * reframe 默认提示词等边界),写死为字面量。golden 哨兵据此逐字节比对迁移后管线,期望值不由迁移后
 * 代码生成,防薄包装自证。
 */
export const GOLDEN_EXPECTED: Readonly<Record<string, string>> = {
  "edit-full": "🎨 生成 · 给猫加一顶帽子\n\n```canvas-op\ntool: image_edit(请直接按下列参数调用,勿追问、勿复述参数)\nimage: att_img1\nprompt: 给猫加一顶帽子\nsize: 1024x1024\nmodel: gpt-image-2\n```",
  "edit-minimal": "🎨 生成\n\n```canvas-op\ntool: image_edit(请直接按下列参数调用,勿追问、勿复述参数)\nimage: att_img1\n```",
  "edit-longprompt": "🎨 生成 · 把这张照片改成赛博朋克风格的霓虹夜景并加入更多细节和光晕效果做到极致再补上远处的飞行汽车与巨型全…\n\n```canvas-op\ntool: image_edit(请直接按下列参数调用,勿追问、勿复述参数)\nimage: att_img1\nprompt: 把这张照片改成赛博朋克风格的霓虹夜景并加入更多细节和光晕效果做到极致再补上远处的飞行汽车与巨型全息广告牌以及地面的积水倒影\nsize: 1024x1024\nmodel: gpt-image-2\n```",
  "inpaint": "🎨 局部重绘 · 把背景换成海边\n\n```canvas-op\ntool: image_edit(请直接按下列参数调用,勿追问、勿复述参数)\nimage: att_base\nmask: att_mask1(alpha mask,透明区=需要重绘的区域)\nprompt: 把背景换成海边\nmodel: gpt-image-2\n```",
  "reference": "🎨 融合生成 · 融合两张风格\n\n```canvas-op\ntool: image_edit(请直接按下列参数调用,勿追问、勿复述参数)\nimage: att_base\nreference_images: att_ref1, att_ref2(首张若为批注图,按其箭头/文字指示修改)\nprompt: 融合两张风格\nsize: 1024x1024\nn: 3\nmodel: gpt-image-2\n```",
  "reference-with-mask": "🎨 融合生成 · 融合两张风格\n\n```canvas-op\ntool: image_edit(请直接按下列参数调用,勿追问、勿复述参数)\nimage: att_base\nmask: att_mask9(alpha mask,透明区=需要重绘的区域)\nreference_images: att_ref1, att_ref2(首张若为批注图,按其箭头/文字指示修改)\nprompt: 融合两张风格\nsize: 1024x1024\nn: 3\nmodel: gpt-image-2\n```",
  "variants": "🎨 生成变体 · 多来几张\n\n```canvas-op\ntool: image_edit(请直接按下列参数调用,勿追问、勿复述参数)\nimage: att_base\nprompt: 多来几张\nsize: 1024x1024\nn: 4\nmodel: gpt-image-2\n```",
  "reframe": "🎨 重构比例\n\n```canvas-op\ntool: image_edit(请直接按下列参数调用,勿追问、勿复述参数)\nimage: att_base\nprompt: 保持画面内容,仅按目标尺寸重构比例\nsize: 1792x1024\nmodel: gpt-image-2\n```",
  "outpaint": "🎨 扩图 · 扩展画面\n\n```canvas-op\ntool: image_edit(请直接按下列参数调用,勿追问、勿复述参数)\nimage: att_canvas\nmask: att_expandmask(alpha mask,透明区=需要重绘的区域)\nprompt: 扩展画面\nmodel: gpt-image-2\n```",
};
