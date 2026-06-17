# Implementation Plan

> 语言:zh。boundary 锚定 design.md「Boundary Commitments」。仅依赖 `@pi-web/react` + shadcn/AI Elements;不实现传输/后端/路由/非 React 嵌入。
> 硬性:每个对外组件含 `@testing-library/react` 组件测试;含 e2e(mock 会话驱动 `<PiChat>`)。单一命令运行全部。

- [ ] 1. 包脚手架与底座(AI Elements + shadcn)
- [ ] 1.1 创建 `@pi-web/ui` 包骨架与构建/测试配置
  - 创建 `packages/ui/package.json`(name `@pi-web/ui`;peerDeps:`react`、`@pi-web/react`、`ai`、`@ai-sdk/react`;不含后端依赖;`scripts.test = vitest run`)、`tsconfig.json`(strict、DOM lib、`jsx: react-jsx`、ES2022)、`vitest.config.ts`(DOM 环境 jsdom/happy-dom + `@testing-library/jest-dom` setup)
  - 创建 `src/lib/cn.ts`(clsx + tailwind-merge 合并工具)
  - 观察完成:`vitest run` 在空/占位测试下可启动并通过;`tsc --noEmit` 通过
  - _Requirements: 9.1, 9.4, 11.7_
- [ ] 1.2 引入 AI Elements 与 shadcn 底座组件源
  - 经 `npx ai-elements add`/`npx shadcn add` 生成并纳入包内:`Conversation`/`Message`/`Response`/`Reasoning`/`Tool`/`PromptInput`/`Actions` 及所需 Radix/shadcn primitives(Select/Dialog/Command 等);创建 `components.json`(别名/CSS 变量约定)
  - 观察完成:底座组件可从包内被 import 并在一个最小渲染冒烟测试中挂载成功
  - _Requirements: 9.2, 9.3, 9.4_
  - _Depends: 1.1_
- [ ] 1.3 建立 shadcn CSS 变量主题层
  - 创建 `src/theme/pi-ui.css`,全部样式 token 引用 shadcn CSS 变量(`--background`/`--foreground`/`--primary` 等),无硬编码颜色
  - 观察完成:在两套不同 CSS 变量值下渲染同一组件,视觉 token 随宿主变量变化(快照/计算样式断言)
  - _Requirements: 9.3_
  - _Depends: 1.2_

- [ ] 2. 测试夹具(mock 会话与消息样本)
- [ ] 2.1 实现 mock 会话与 mock transport 夹具
  - 创建 `test/fixtures/mock-session.ts`:mock `usePiSession`/`usePiControls`/`useExtensionUI` 结果与可脚本化推送 part / 触发扩展 UI / 提供 `commands`/`stats` 的 mock `PiTransport`
  - 创建 `test/fixtures/ui-message-fixtures.ts`:各类 `UIMessage` parts 样本(text、reasoning start/delta/end、tool input-available/累积/output-available、`data-pi-*`)
  - 观察完成:夹具可在一个示例测试中驱动出流式文本与一次工具三态序列
  - _Requirements: 11.1, 11.6_
  - _Depends: 1.1_

- [ ] 3. 渲染器注册表(扩展点)
- [ ] 3.1 实现 `renderer-registry.ts`(注册/解析/默认回退/覆盖) (P)
  - 创建 `src/registry/renderer-registry.ts`:`createRendererRegistry()` 工厂 + 模块级单例委托;`registerToolRenderer`/`registerDataPartRenderer`/`resolveToolRenderer`/`resolveDataPartRenderer`;未命中返回 `undefined`;重复注册覆盖
  - 观察完成:`renderer-registry.test.ts` 验证注册→解析命中、未注册→`undefined`、重复注册以最后者为准
  - _Requirements: 7.1, 7.2, 7.5, 7.6, 11.5_
  - _Boundary: renderer-registry.ts_
  - _Depends: 1.1_

- [ ] 4. parts 层默认渲染组件
- [ ] 4.1 实现 `<PiToolPart>` 工具卡(start/update/end 三态) (P)
  - 创建 `src/parts/pi-tool-part.tsx`:基于 AI Elements `<Tool>`;start(工具名+入参)/update(累积值替换)/end(结果;`isError` 错误样式);明细折叠区键盘可达 + aria 状态
  - 观察完成:`parts/pi-tool-part.test.tsx` 用夹具断言三态各自渲染、错误态样式、折叠区可键盘展开且带 aria
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 10.1, 10.3, 11.1, 11.2_
  - _Boundary: pi-tool-part.tsx_
  - _Depends: 1.2, 2.1_
- [ ] 4.2 实现 `<PiReasoning>` 可折叠思考块 (P)
  - 创建 `src/parts/pi-reasoning.tsx`:基于 AI Elements `<Reasoning>`;增量渲染、默认折叠、切换更新可见性 + `aria-expanded`、进行中指示、键盘触发
  - 观察完成:`parts/pi-reasoning.test.tsx` 断言默认折叠、点击/键盘展开、`aria-expanded` 反映状态、进行中指示
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 10.1, 10.3, 11.1, 11.3_
  - _Boundary: pi-reasoning.tsx_
  - _Depends: 1.2, 2.1_

- [ ] 5. part 分派器
- [ ] 5.1 实现 `PartRenderer` 分派(含注册表解析与默认回退)
  - 创建 `src/chat/part-renderer.tsx`:按 part 类型分派(text→`Response`、reasoning→`<PiReasoning>`、tool→`resolveToolRenderer ?? <PiToolPart>`、`data-pi-*`→`resolveDataPartRenderer ?? 默认`);纯渲染、不依赖 hooks
  - 观察完成:`chat/part-renderer.test.tsx` 断言各 part 类型→正确组件;注册自定义工具/data-part 渲染器后命中**覆盖默认**
  - _Requirements: 1.4, 2.4, 7.3, 7.4, 7.5, 11.5_
  - _Boundary: part-renderer.tsx_
  - _Depends: 3.1, 4.1, 4.2_

- [ ] 6. controls 层组件
- [ ] 6.1 实现 `<PiModelSelector>` 与 `<PiThinkingLevel>` (P)
  - 创建 `src/controls/pi-model-selector.tsx`(基于 shadcn Select;选择→`usePiControls.setModel`;进行中态;失败显示可辨识错误不静默)与 `src/controls/pi-thinking-level.tsx`(选择→`setThinking`);均不向消息流写入
  - 观察完成:`controls/pi-model-selector.test.tsx`/`pi-thinking-level.test.tsx`(mock `usePiControls`)断言选择触发对应方法、进行中/错误态呈现
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 10.1, 11.1_
  - _Boundary: pi-model-selector.tsx, pi-thinking-level.tsx_
  - _Depends: 1.2, 2.1_
- [ ] 6.2 实现 `<PiSessionStats>` (P)
  - 创建 `src/controls/pi-session-stats.tsx`:展示 `usePiControls.stats`(用量/成本),统计更新刷新
  - 观察完成:`controls/pi-session-stats.test.tsx` 断言统计渲染并在 mock stats 更新后刷新
  - _Requirements: 4.4, 11.1_
  - _Boundary: pi-session-stats.tsx_
  - _Depends: 1.2, 2.1_
- [ ] 6.3 实现 `<PiCommandPalette>` 斜杠命令补全
  - 创建 `src/controls/pi-command-palette.tsx`:基于 shadcn Command;"/" 触发展示 `getCommands` 候选、输入过滤、选择填充/提交;方向键导航/回车确认/Esc 关闭 + aria 活动项;空态/错误态不崩溃
  - 观察完成:`controls/pi-command-palette.test.tsx` 断言触发列表、过滤、选择填充、键盘导航、aria 活动项、空/错误态
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 10.1, 10.4, 11.1_
  - _Boundary: pi-command-palette.tsx_
  - _Depends: 1.2, 2.1_

- [ ] 7. dialog 层权限弹窗
- [ ] 7.1 实现 `<PiPermissionDialog>`(扩展 UI 四类 + 回传)
  - 创建 `src/dialog/pi-permission-dialog.tsx`:基于 shadcn/Radix Dialog;按 `extensionUI.current` 类别渲染 select/confirm/input/editor;提交经 `respond(requestId, response)` 回传匹配响应;失败保留弹窗 + 错误 + 重试;焦点捕获/Esc/关闭后焦点还原/aria 对话框语义
  - 观察完成:`dialog/pi-permission-dialog.test.tsx`(mock `useExtensionUI`)断言四类各自渲染、提交回传匹配 ui-response、回传失败保留可重试、焦点/Esc/aria
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 10.1, 10.2, 10.3, 11.1, 11.4_
  - _Boundary: pi-permission-dialog.tsx_
  - _Depends: 1.2, 2.1_

- [ ] 8. `<PiChat>` 装配组件与插槽
- [ ] 8.1 实现 `<PiChat>` 装配(useChat + AI Elements + part 分派 + 内嵌弹窗/控制)
  - 创建 `src/chat/slots.ts`(`PiChatSlots` 类型与默认)与 `src/chat/pi-chat.tsx`:接收 `session`/`controls`/`extensionUI`,用 `useChat({ transport })` 驱动;`Conversation`+`Message`+`Response`+`PromptInput`+`Actions` 装配;每 part 交 `PartRenderer`;流式进行中指示 + 中止入口(`abort`);内嵌 `<PiPermissionDialog>`;可选内置控制面板;不实现任何传输逻辑
  - 观察完成:`chat/pi-chat.test.tsx`(mock 会话)断言消息区/输入区渲染、提交追加用户消息、流式文本渲染、`extensionUI.current` 存在时弹窗弹出
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 11.1_
  - _Boundary: pi-chat.tsx, slots.ts_
  - _Depends: 5.1, 7.1_
- [ ] 8.2 实现 `<PiChat>` 四个插槽(header/footer/sidebar/messageActions)
  - 在 `pi-chat.tsx`/`slots.ts` 接入 header/footer/sidebar 渲染位与 `messageActions(message)` 每消息操作区;未提供插槽用合理默认或不渲染该区域
  - 观察完成:`chat/pi-chat.test.tsx` 增加用例断言四插槽内容就位、缺省插槽不报错
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - _Boundary: pi-chat.tsx, slots.ts_
  - _Depends: 8.1_

- [ ] 9. 分发产物(npm 导出 + shadcn registry)
- [ ] 9.1 实现 npm 聚合导出面 `index.ts`
  - 创建 `src/index.ts`:导出 `PiChat`、各细粒度组件、`registerToolRenderer`/`registerDataPartRenderer`/`createRendererRegistry` 与公开类型(`PiChatProps`/`PiChatSlots`/各 Props/`ToolRenderer`/`DataPartRenderer`)
  - 观察完成:从包入口可 import 全部对外符号;`tsc --noEmit` 通过且无 `any`
  - _Requirements: 9.1, 9.4_
  - _Depends: 8.2, 6.3, 6.1, 6.2_
- [ ] 9.2 生成 shadcn registry 清单(`npx pi-web add chat`)
  - 创建 `registry.json` 条目:`chat`(`<PiChat>` 及其依赖组件源)与各细粒度组件条目 + AI Elements/shadcn 依赖声明
  - 观察完成:`npx pi-web add chat`(或等价 registry resolve)在样例项目落地 `<PiChat>` 及其依赖源文件,无缺失依赖
  - _Requirements: 9.2_
  - _Depends: 9.1_

- [ ] 10. Storybook 与 e2e(硬性)
- [ ] 10.1 编写 Storybook 故事(可视化文档 + e2e 场景)
  - 创建 `stories/pi-chat.stories.tsx`(mock 会话驱动 `<PiChat>`)及 `pi-tool-part`/`pi-reasoning`/`controls`/`pi-permission-dialog` 故事
  - 观察完成:Storybook 可启动并展示 `<PiChat>` 在 mock 会话下的流式文本/工具卡/思考块/弹窗
  - _Requirements: 11.6_
  - _Depends: 8.2, 2.1_
- [ ] 10.2 实现 e2e:mock 会话驱动 `<PiChat>` 全交互
  - 创建 `test/e2e/pi-chat.e2e.test.tsx`:用 mock 会话/mock transport 脚本化推送 part 与触发扩展 UI,断言(a)流式文本逐步出现、(b)工具卡 start→update→end、(c)思考块可展开、(d)扩展 UI 弹窗出现并在作答后经 `respond` 回传并关闭
  - 观察完成:`vitest run` 中该 e2e 通过,覆盖跨组件完整交互
  - _Requirements: 11.6, 11.7_
  - _Depends: 8.2, 7.1, 5.1, 2.1_

- [ ] 11. 集成校验
- [ ] 11.1 单一命令运行全部测试并校验需求覆盖
  - 运行 `vitest run` 跑通全部单元/组件/e2e;核对每个对外组件均有渲染测试、工具卡三态、思考折叠、弹窗回传、注册表覆盖默认、e2e 全交互均被覆盖
  - 观察完成:单条命令输出全部测试通过的新鲜运行证据,无跳过的硬性用例
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_
  - _Depends: 10.2, 5.1, 3.1_
