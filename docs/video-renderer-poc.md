# 视频渲染 Adapter POC

日期：2026-08-05

## 结论

首轮不把渲染引擎写入 Video Domain。新增 `VideoRenderRequest` 与 `VideoRendererAdapter` 接缝，并以本机 FFmpeg 做可替换 POC。

实测结果：8 个镜头、7 个转场请求可生成真实 MP4；输出文件含 MP4 `ftyp` 头，且再次交给 FFmpeg 解码检查通过。

## 选择依据

| 候选 | 本机/仓库证据 | 本轮结论 |
| --- | --- | --- |
| FFmpeg | 本机可执行，含 `libx264`、`libx265`、`libvpx`；仓库已有 `local-ffmpeg` Adapter 与 attachment 回流 | 先作离线基线与导出 Adapter |
| Remotion / Scene.js | 当前依赖树无对应包 | 不预选，不伪造能力 |
| Blender | 本机命令不可用 | 暂不接入 |
| ComfyUI | 当前无本地服务证据 | 暂不接入 |

## 能力与降级

当前 FFmpeg 版本没有 `xfade` filter，故 POC 以串接为主：

- 实做：`cut`、`fade`（淡入淡出）；
- 明确降级为 cut：`dissolve`、`wipe`、`match-cut`、`morph`；
- 降级结果由 `degradedTransitions` 返回，不能当作已完成的电影级转场。

后续须以新引擎/新 FFmpeg 能力矩阵复测，再决定是否为 dissolve/wipe/match-cut/morph 增加 Adapter；不在 Domain 层引入引擎名。

## 验证入口

- `examples/agic-video-agent/video-studio/renderer.test.ts`
- `node --import jiti/register media-tools/test/ffmpeg.selfcheck.ts`

## 已知限制

- 当前 POC 已支持图片 attachment → `localPath` → FFmpeg → `putOutput` 的端到端回流；`video_render` Agent 工具可将成功产物写入当前项目导出资产。
- 当前测试使用 fake attachment port 验证回流；真实远端对象存储、浏览器预览与大文件流式落库仍待单独验收。
- 未实现音轨、字幕、VFX 多层合成、增量渲染及逐帧预览。
- 旧 FFmpeg 的滤镜能力不足以证明多种电影级转场；本轮只证明 Adapter 边界与真实文件产出。
