# Implementation Plan

- [x] 1. 核心：图像附件物化为 prompt images
- [x] 1.1 实现纯函数式 materialize + merge（可单测）
  - 从消息中的 `@attachment:<id>` / 规范标记与 `attachmentIds` 收集 id（去重、保序）
  - 仅 `image/*` 且属当前会话的附件：读字节 → 裸 base64 `ImageContent`
  - 与客户端已有 `images` 按 data 去重后合并
  - 读失败 / 非图 / 未知 id：跳过，不抛
  - 完成态：单元测试覆盖图像物化、非图跳过、去重、读失败 fail-soft
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_
  - _Boundary: materialize-prompt-images_

- [x] 2. 接线：消息提交路径
- [x] 2.1 在 `makeMessagesHandler` 于文本引用注入之后、`session.prompt` 之前合并物化 images
  - 扩展附件源可选 `getReadStream`；无能力时不物化（fail-soft）
  - 保留 `injectAttachmentRefs` 文本标记
  - 不调用 / 不依赖 `image_vision`
  - 完成态：command-routes 集成测试断言 prompt options.images 与文本引用并存
  - _Depends: 1.1_
  - _Requirements: 1.4, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: command-routes_

- [x] 3. 元数据与导出
- [x] 3.1 扩展 handler 附件注入类型与 barrel 导出
  - `AttachmentMetaSource` / handler opts 支持可选字节读取
  - 从 attachment-bridge 导出 materialize API
  - _Depends: 1.1_
  - _Requirements: 2.1_

## Implementation Notes

- 物化落在主进程 `makeMessagesHandler`：`materializePromptImages` 合并入 `session.prompt` 的 `images`，与 composer 上传共用 native 多模态通道。
- 文本引用路径未改；`image_vision` 未接入。
- 测试：`packages/core` 下 materialize 单测 15 + command-routes 含 4 条新断言，共 47 绿。
