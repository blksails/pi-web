# Requirements Document

## Introduction

pi-web 桌面版打开 pane 后，**pane 的 chrome（tab 栏、「新开 Pane」、刷新、切换器）整条不可见**，只看得到 pane 内容。后果不是少了装饰——tab 栏是切换与新开 pane 的**唯一入口**，被盖住等于用户被锁在首个 pane 里，无法经 UI 恢复。

已定位的机制（代码级证据）：chrome 与 pane 内容槽是兄弟结构，几何正确时不可能相互覆盖；而「几何尚未确定」时系统采用的默认矩形是**从窗口顶端起、高度铺满**，恰好落在 chrome 所在的那一段。也就是说，系统对「信息不足」的处置选择了"全遮"，而非"不遮"。真正让系统停在这一态的触发条件尚未定位，是本 spec 要一并消除的。

本 spec 的立场：**安全兜底是止血，不是根治**。两件都要做，且都要有证据。

## Boundary Context

- **In scope**：桌面版 pane 内容槽的几何与其降级行为；几何链路失败的可取证性；chrome 可达性的机械化判定与真机视觉证据。
- **Out of scope**：网页宿主的布局路径；pane 内容自身的渲染；pane 生命周期与保活策略；任何具体 agent 的 pane 声明内容；chrome 自身的视觉设计与按钮增减。
- **Adjacent expectations**：chrome 的渲染与 pane 内容槽的结构关系由 pane 宿主提供，本 spec 依赖其"chrome 与内容槽不重叠"这一既有结构，但不改动它；`aigc-pane-desktop-integration` 已覆盖"拖拽时不遮挡分隔线"，本 spec 补的是"几何未知时不遮挡 chrome"，两者不重复。

## Requirements

### Requirement 1: Pane chrome 恒可达

**Objective:** 作为桌面版用户，我希望无论 pane 处于什么状态，tab 栏与「新开 Pane」始终可见可点，以便我永远有办法切换或新开 pane。

#### Acceptance Criteria

1. While 右侧面板已打开至少一个 pane，the 桌面版 shall 使 pane chrome 完整可见，不被 pane 内容遮挡。
2. When 用户拖拽面板宽度，the 桌面版 shall 在拖拽全程保持 chrome 可见。
3. When 窗口尺寸变化，或窗口在不同缩放比的显示器之间移动，the 桌面版 shall 保持 chrome 可见。
4. When 用户点击 chrome 上的「新开 Pane」，the 桌面版 shall 打开 pane 选择器并可成功新开一个 pane。
5. The 桌面版 shall 在任何时刻都为「切换到另一个已打开的 pane」保留至少一条可用的界面路径。

### Requirement 2: 几何未知或非法时的降级行为

**Objective:** 作为桌面版用户，我希望在窗口几何还没算出来的瞬间不要看到错位的 pane，以便我不会被一块盖住控件的面板挡住去路。

#### Acceptance Criteria

1. If pane 内容槽的几何尚未确定，then the 桌面版 shall 不显示 pane 内容，而非以一个覆盖 chrome 的默认矩形显示它。
2. If 收到的几何被判定非法，then the 桌面版 shall 沿用上一次已知有效的几何，且 shall 不回落到覆盖 chrome 的矩形。
3. When 几何在降级态之后变为可用，the 桌面版 shall 自动把 pane 落位到正确位置，不需要用户做任何操作。
4. While 处于降级态，the 桌面版 shall 保持 chrome 可见且可交互。
5. The 桌面版 shall 在所有降级路径上都不产生与 chrome 区域相交的 pane 矩形。

### Requirement 3: 几何链路的失败可取证

**Objective:** 作为维护者，我希望几何链路的每一次失败都留下痕迹，以便同类故障下次能被直接观测，而不是靠读代码反推。

#### Acceptance Criteria

1. If 量得的槽位尺寸因不可用而被丢弃，then the 桌面版 shall 留下一条含被丢弃数值与丢弃原因的诊断记录。
2. If 几何未能送达布局侧，then the 桌面版 shall 留下一条含失败原因的诊断记录，且 shall 不把该失败静默吞掉。
3. If 收到的几何被校验拒绝，then the 桌面版 shall 留下一条含被拒数值与拒绝原因的诊断记录。
4. When 维护者需要确认当前实际生效的 pane 槽位几何，the 桌面版 shall 提供一条能取得该数值的途径。
5. The 桌面版 shall 使上述诊断在不重新编译的前提下即可开启并读取。

### Requirement 4: 触发条件的定位与消除

**Objective:** 作为桌面版用户，我希望这个问题被根治而不只是被兜底遮住，以便 pane 的几何在正常路径上本来就是对的。

#### Acceptance Criteria

1. When 桌面版正常启动并打开一个 pane，the 桌面版 shall 使该 pane 的槽位几何来自宿主实测值，而非降级默认值。
2. When 首个 pane 首次显示，the 桌面版 shall 在显示之前就已取得有效几何。
3. If 首帧尚未完成布局导致量槽失败，then the 桌面版 shall 在布局完成后补上一次上报，且 shall 不停留在降级态。
4. The 桌面版 shall 记录本缺陷的真实触发条件；若最终证明触发条件不可复现，the 记录 shall 说明这一点，而非以"已修复"含混带过。

### Requirement 5: 既有行为不回归

**Objective:** 作为桌面版用户，我希望这次修复不改变我已经习惯的拖拽与全屏表现。

#### Acceptance Criteria

1. When 用户拖拽面板宽度，the 桌面版 shall 保持 pane 跟手，不出现相较修复前更明显的滞后或插帧。
2. When 宿主进入全屏模式，the 桌面版 shall 隐藏全部内容 pane，并在退出全屏后按原可见性恢复。
3. Where 运行在网页宿主，the 系统 shall 保持既有布局行为逐字段不变。
4. When pane 的浮层菜单打开，the 桌面版 shall 保持既有的叠放次序与焦点表现，不因几何改动而抢焦或关闭菜单。

### Requirement 6: 可验证性与证据

**Objective:** 作为验收者，我希望「chrome 是否被盖住」能被机械判定，以便这个缺陷不会再一次只能靠肉眼在真机上撞见。

#### Acceptance Criteria

1. The 验收 shall 覆盖「几何未知」这一路径——该路径当前在自动化验证中**零覆盖**（既有几何用例全部传入明确的非零顶边，或走全屏模式；而产生遮挡矩形的兜底分支位于需要真实窗口句柄的调用链内，结构上跑不到测试里）。
2. When 几何计算在「几何未知」的输入下运行，the 验收 shall 断言产出的 pane 矩形与 chrome 区域不相交。
3. When 修复完成，the 验收 shall 产出真机截图，图中 tab 栏与 pane 内容同时可见，且可据图数出已打开的 pane 数。
4. If 任一新增断言在修复前的代码上不会失败，then the 验收 shall 判定该断言无效并重写——"跑绿"本身不构成证据。
5. The 验收 shall 同时给出机械证据与视觉证据；缺任一侧不得判定通过。
