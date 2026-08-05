---
name: creative-nine-grid-pro
description: 将社交媒体九宫格需求转为可执行的多图定位、空格补全、网格线与跨格溢出参数。用户要求九宫格排版、多图分格、指定格位、AI 补全或主体突破格线时使用。
---

# Creative Nine Grid Pro

将用户意图转为确定的九宫格资源、位置数组与图层参数。不得让单次文生图承担多个独立格子的语义。

## 输入参数

- `prompt`：主体、艺术风格、环境或空格补全描述；需生成内容时使用。
- `image_sources`：参考图 URL 或平台资源 ID，数量 0–9。
- `grid_positions`：每个资源对应的格位，取 1–9，按从左至右、从上至下编号。
- `split_as_nine_files`：`true` 输出 9 张 1:1 方图；`false` 输出 1 张完整方图。默认 `true`。
- `enable_grid_overflow`：是否启用主体跨格溢出。默认 `false`。
- `overflow_grid_index`：溢出主体所在格位，默认 `5`；仅溢出开启时生效。
- `overflow_scale`：主体等比放大倍数，默认 `1.5`。
- `grid_line_style`：网格线样式对象；`color` 默认 `"white"`，`width_px` 默认 `4`。

## 执行规则

1. 解析用户指定的主体、风格、格位、输出形态与溢出意图。
2. 若用户指定多个独立场景，逐格生成或获取资源：每次单图调用只负责一个场景，再填入 `image_sources`。例如“周围 8 格为不同回忆、中间为主角”时，先生成 8 张背景，再生成主体图，组成 9 个资源；不得用一次提示词生成一张包含 8 个独立时空的大图。
3. 若有未指定格位，按 `prompt` 逐格补全；若只有 1 张图且未指定格位，将其作为完整九宫格背景。无可用生图工具时，保留缺口并明确请求补充资源。
4. 校验 `grid_positions`：长度须与 `image_sources` 一致，数字须为 1–9 且不得重复。未提供时按下列规则推导：
   - 1 张图：作为主背景，铺满 1–9 格。
   - 9 张图：按输入顺序映射到 1–9 格。
   - 2–8 张图：从第 1 格起按行优先紧凑填充。
5. 用户提及“突破画面限制”“不要呆在格子里”“遮挡周围格子”“溢出来”等意图时，强制设 `enable_grid_overflow: true`，并指定 `overflow_grid_index`；未指定主体格位时用 `5`。
6. 溢出开启时，按主体格中心等比放大 `overflow_scale`，让主体图层位于网格线之上并遮挡相邻格边缘。建议值：`1.0` 无溢出，`1.3` 轻度溢出，`1.5` 强溢出。

## 排版管线

调用可用的排版后端时，严格按此顺序传递与渲染：

1. 按 `grid_positions` 将资源拼成 3×3、3000×3000 像素方形底图；必要时先统一裁切或填充为单格比例。
2. 在底图上绘制 `grid_line_style` 指定的横竖分割线。
3. `enable_grid_overflow` 为 `true` 时，从 `overflow_grid_index` 的主体资源生成透明图层，以该格中心为轴按 `overflow_scale` 放大，并叠加到网格线之上。
4. 按 `split_as_nine_files` 输出完整大图或 9 张对齐的 1:1 方图。

## 输出契约

传给排版后端的结构化参数应至少包含：

```json
{
  "prompt": "...",
  "image_sources": [],
  "grid_positions": [],
  "split_as_nine_files": true,
  "enable_grid_overflow": false,
  "overflow_grid_index": 5,
  "overflow_scale": 1.5,
  "grid_line_style": {
    "color": "white",
    "width_px": 4
  }
}
```

调用前完成数组长度、格位范围、唯一性及溢出格位校验；工具不支持某字段时，不静默丢弃，须说明限制。
