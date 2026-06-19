# Implementation Plan

> 范围:仅 `packages/ui`,全部非破坏式新增。依赖方向严格 `customization/theme/icons → elements → chat`。

- [x] 1. 基础:定制契约与主题底座
- [x] 1.1 暴露各可覆盖元件的公开 props 类型
  - 从元件层汇出 SubmitButton / Attachments / ModelSelector / SpeechInput / WebSearchToggle / Message 的公开 props 类型,作为覆盖契约地基
  - 完成态:外部可 import 上述各元件的 props 类型,且 `tsc --noEmit` 通过
  - _Requirements: 5.1, 5.2_

- [x] 1.2 定义组件覆盖映射与优先级解析
  - 定义可覆盖组件位映射(各位 props 复用对应元件契约),实现 `slots(整块) > components(细粒度) > 默认` 解析;`null` 表示移除可移除控件;Message 按 role 子映射且未提供角色回退默认
  - 完成态:解析函数对 override 组件/`null`/缺省三态返回正确实现,纯函数无副作用
  - _Depends: 1.1_
  - _Requirements: 1.1, 1.3, 5.1, 5.2, 5.3, 5.4, 5.5, 9.1, 9.2, 9.3, 9.4_

- [x] 1.3 (P) 建立图标契约与注入机制
  - 定义图标位枚举与图标主题类型,提供 IconsProvider 与 useIcon(命中主题用主题,否则回退默认 lucide);保留各位尺寸约束与可访问性标签语义
  - 完成态:在主题缺省时 useIcon 返回默认 lucide 图标;提供主题后返回主题图标
  - _Requirements: 8.1, 8.2, 8.3_
  - _Boundary: customization/icons_

- [x] 1.4 (P) 实现布局预设到 className 的映射
  - 提供 centered/wide/full/split 四预设到容器与消息区 className 的映射;缺省与 centered 等价于现行版面;split 标记划出让位区
  - 完成态:四预设返回确定 className,split 的让位标志为真,缺省等于 centered
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Boundary: customization/layout_

- [x] 1.5 (P) 实现运行时主题 Provider
  - 提供 ThemeProvider 接受 light/dark/system,切换文档根的暗色类;system 读取并监听操作系统明暗偏好且随其变化更新;缺省 system;matchMedia 不可用时回退 light 不报错
  - 完成态:三种模式分别应用正确明暗类,system 下模拟偏好变化触发更新,卸载清理监听
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: theme/ThemeProvider_

- [x] 1.6 (P) 导出 Tailwind 令牌预设
  - 抽出现有令牌到工具类的映射为可被下游一行引用的预设,现有包内 Tailwind 配置改为引用该预设(行为等价)
  - 完成态:下游可经 presets 引用获得令牌映射;包内既有样式渲染结果不变
  - _Requirements: 3.1, 3.2, 3.3_
  - _Boundary: theme/tailwind-preset_

- [x] 2. 核心:抽出/新增可覆盖元件位
- [x] 2.1 (P) 抽出消息操作区为可覆盖位并迁移其图标
  - 将复制/赞/踩操作区抽为独立可覆盖元件;将消息区内图标改为经 useIcon 取值,默认外观不变
  - 完成态:默认渲染与现状一致;提供覆盖实现时该区被替换
  - _Depends: 1.3_
  - _Requirements: 5.1, 5.2, 8.1_
  - _Boundary: elements/message, elements/message-actions_

- [x] 2.2 (P) 新增对话背景层元件
  - 新增渲染于消息层之下、不拦截交互的背景位,默认透明无背景
  - 完成态:默认无可见背景且消息可正常交互;提供背景后显示于消息下层
  - _Requirements: 4.1_
  - _Boundary: elements/conversation-background_

- [x] 2.3 (P) 抽出空态欢迎页与起始卡片为可覆盖位
  - 将居中标题/副标题/起始卡片网格抽为空态元件与单卡元件,接收标题、副标题、起始项与回调、输入区节点
  - 完成态:默认空态渲染与现状一致;可整体或按单卡覆盖
  - _Requirements: 4.2, 4.3, 5.1, 5.2_
  - _Boundary: elements/empty-state, elements/starter-card_

- [x] 2.4 (P) 封装 Markdown 渲染为可覆盖位
  - 将现有富文本渲染封装为可覆盖的 Markdown 位,默认行为不变
  - 完成态:默认渲染与现状一致;提供覆盖时改用自定义实现
  - _Requirements: 5.1, 5.2_
  - _Boundary: elements/markdown_

- [x] 2.5 (P) 迁移输入区控件图标至注入机制
  - 将发送/停止/重试、附件、模型、语音、联网等输入区控件图标改为经 useIcon 取值,默认回退既有 lucide,保留尺寸与可访问性标签
  - 完成态:默认外观与现状一致;提供图标主题后对应位图标被替换
  - _Depends: 1.3_
  - _Requirements: 8.1, 8.2, 8.3_
  - _Boundary: elements/submit-button, elements/attachments, elements/model-selector, elements/speech-input, elements/web-search-toggle_

- [x] 3. 集成:插槽扩展与装配接线
- [x] 3.1 扩展整块插槽集合
  - 在既有 header/footer/sidebar/messageActions 基础上新增 background 与 empty 两个整块插槽类型
  - 完成态:插槽类型含新增两项且与既有插槽共存,类型检查通过
  - _Requirements: 4.1, 4.2, 4.4_

- [x] 3.2 在 PiChat 装配点接入四维定制
  - 新增 components/icons/layout 及主题透传入口;在各装配点按 `slots > components > 默认` 解析实现;以 IconsProvider 下发图标;按布局预设排布对话区与让位区;空态/会话态/工具条改为引用可覆盖位与可排序控件;缺省时维持现行为
  - 完成态:提供覆盖即生效、缺省即等于现状;同位 slot 与 component 并存时取 slot;split 划出让位区由插槽/子节点承接
  - _Depends: 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1_
  - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 4.3, 5.1, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 9.1, 9.2, 9.3, 9.4_
  - _Boundary: chat/pi-chat_

- [x] 3.3 汇出公共定制契约
  - 从包入口导出 ThemeProvider/useTheme、IconsProvider 与图标类型、布局预设类型、组件覆盖类型、各覆盖位 props 类型与预设路径
  - 完成态:集成方可从包入口 import 全部公共定制契约,`tsc --noEmit` 通过
  - _Depends: 3.2_
  - _Requirements: 3.3, 5.2, 8.1_

- [x] 4. 验证:单测、集成测与端到端
- [x] 4.1 (P) 契约单元测试
  - 覆盖优先级解析三态与 null 移除、Message 按 role 回退、布局预设映射(含 split)、useIcon 命中与回退、ThemeProvider 三模式与系统偏好运行时变化
  - 完成态:上述单测全部通过
  - _Depends: 1.2, 1.3, 1.4, 1.5_
  - _Requirements: 2.1, 2.2, 2.3, 5.4, 5.5, 7.1, 7.4, 8.1, 8.2, 9.1, 9.2, 9.3, 9.4_

- [x] 4.2 (P) 定制路径集成测试
  - 验证:自定义发送键替换默认;按 role 替换 user 消息且 assistant 回退;移除某输入控件后其余可用;background 与 empty 插槽分别替换;布局预设改变消息容器宽度类;图标主题替换且保留可访问性标签;同位 slot 优先于 component
  - 完成态:上述集成测试全部通过
  - _Depends: 3.2_
  - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.3, 5.4, 7.2, 8.1, 8.3, 9.1, 10.1, 10.3, 10.4_

- [x] 4.3 向后兼容回归测试
  - 验证不提供任何新增定制入口时默认外观与结构与既有版本一致,既有 slots/注册表/CSS 变量用法不受影响
  - 完成态:回归测试通过且无既有用例破坏
  - _Depends: 3.2_
  - _Requirements: 1.1, 1.2, 1.3, 10.5_

- [x] 4.4 主题切换浏览器端到端测试
  - 在真实浏览器下经 ThemeProvider 在 dark/light 间切换,断言文档根暗色类与可见配色随之变化;采用隔离 build 与外部 server 模式运行
  - 完成态:Playwright 端到端用例通过,dev 环境不受污染
  - _Depends: 1.5, 3.2_
  - _Requirements: 2.1, 2.2, 10.2_
