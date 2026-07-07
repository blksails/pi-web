# Requirements Document

## Introduction

pi-web 桌面版把现有的 pi-web Web 应用封装为可双击启动的跨平台桌面应用。它复用 `pnpm build:cli` 产出的 standalone 自包含产物,由一层 Electron 薄壳负责:找一个空闲端口、以「Electron 充当 Node」的方式拉起 standalone server、等待就绪后在窗口内加载本地 Web UI。目标用户是希望在本机像用普通桌面软件一样使用 pi 编码 agent、而不必安装 Node 或在终端敲命令的开发者。

桌面版与现有 CLI 是同一份数据(`~/.pi/agent`)的两个入口:桌面版不引入新的会话/配置语义,只提供原生窗口与自包含运行时。

本规格聚焦 **M1(最小可用壳)**:能在一台未安装 Node 的干净机器上双击运行、跑通真实会话,并产出可分发的 macOS 安装包。M2(桌面体验增强)与 M3(多平台分发/签名/自动更新)不在本规格范围内。

## Boundary Context

- **In scope(M1)**:
  - Electron 主进程:空闲端口选择 → 以 Electron-as-Node 拉起 standalone server → 就绪探针 → 单窗口加载本地 UI。
  - 自包含产物嵌入(产物随桌面包分发,位于打包资源目录而非虚拟归档内,以保证 server 与 runner 子进程拿到真实文件路径)。
  - runner 子进程不依赖系统 Node(后端唯一改动:spawn 时使用注入的 Node 二进制)。
  - 窗口安全策略:仅监听回环地址 + 随机端口、隔离渲染进程、外链交系统浏览器。
  - 退出时的进程树收尾(不留孤儿子进程)。
  - 数据目录沿用 `~/.pi/agent`,与 CLI 共享。
  - 开发模式:壳指向已运行的 dev server 而非自行拉起。
  - macOS 安装包产出 + 干净(无 Node)机器验证。
- **Out of scope(顺延 M2/M3)**:原生目录选择器选 agent source、系统托盘、多窗口、原生菜单/快捷键、休眠唤醒会话恢复、Windows/Linux 分发与 CI 矩阵、代码签名与公证、自动更新。
- **Adjacent expectations**:
  - 复用 `scripts/pack-standalone.mjs` 产物且不改变其布局与可重定位契约。
  - 复用 `bin/pi-web.mjs` 已导出的纯函数(端口选择、env 组装、就绪探针、启动)语义,不改变 CLI 行为。
  - 会话引擎、配置域、附件系统、协议契约保持不变;桌面版不新增业务 RPC。
  - 后端对 runner 的 spawn 改动必须向后兼容:未注入桌面专用环境变量时,CLI 与 dev 行为与现状完全一致。

## Requirements

### Requirement 1: 桌面应用启动与后端拉起
**Objective:** 作为在本机使用 pi-web 的开发者,我想双击应用图标即可启动并进入聊天界面,以便无需在终端手动运行服务器。

#### Acceptance Criteria
1. When 用户启动桌面应用, the 桌面应用 shall 选择一个当前空闲的本地端口用于本地服务器。
2. When 桌面应用完成端口选择, the 桌面应用 shall 使用桌面运行时自带的 Node 能力拉起随包分发的 standalone server 进程,并将所选端口与回环主机地址传给该进程。
3. While 本地服务器尚未就绪, the 桌面应用 shall 在窗口内显示可见的启动/加载状态,而非空白窗口。
4. When 本地服务器对就绪探针返回可用响应, the 桌面应用 shall 在应用窗口内加载本地 Web UI(指向所选端口的回环地址)。
5. The 桌面应用 shall 在不要求宿主机预装 Node 运行时的前提下完成上述启动流程。

### Requirement 2: 启动失败的可见处理
**Objective:** 作为用户,我想在应用无法启动时看到明确提示而非卡死或空窗,以便知道发生了什么并可重试。

#### Acceptance Criteria
1. If 在就绪超时时限内本地服务器仍未就绪, then the 桌面应用 shall 停止等待并向用户显示可读的启动失败提示。
2. If 本地服务器进程在就绪前异常退出, then the 桌面应用 shall 向用户显示包含失败原因线索的错误信息,而非无限等待。
3. If 无法找到可用的本地端口, then the 桌面应用 shall 终止启动并向用户报告端口不可用的原因。
4. When 桌面应用因启动失败而无法进入聊天界面, the 桌面应用 shall 提供退出或重试的途径,并确保不遗留仍在运行的服务器子进程。

### Requirement 3: 自包含产物随包分发
**Objective:** 作为分发者,我想桌面安装包内自带完整运行时产物,以便终端用户无需任何额外安装即可运行。

#### Acceptance Criteria
1. The 桌面应用打包流程 shall 将 standalone 自包含产物(含 server 入口、runner bootstrap 与 agent 运行时依赖闭包)一并纳入分发包。
2. The 桌面应用打包流程 shall 使被拉起的 server 及其派生的 runner 子进程能够以真实文件系统路径访问产物文件,而非只能经虚拟归档访问。
3. While 桌面应用以打包形态运行, the 桌面应用 shall 从随包资源目录定位 standalone server 入口。
4. When runner 子进程在运行时动态加载用户 agent 源码, the 桌面应用 shall 保证该动态加载所需的运行时(转译器与 agent 运行时依赖)在产物内可被解析。

### Requirement 4: runner 子进程无需系统 Node
**Objective:** 作为使用桌面版的开发者,我想在没有安装 Node 的机器上也能正常发起会话,以便桌面版真正做到开箱即用。

#### Acceptance Criteria
1. When 会话引擎组装 runner 子进程的启动规格, the 后端 shall 使用可注入的 Node 二进制路径作为子进程可执行文件,当该注入值存在时。
2. Where 桌面运行时注入了指向其自带 Node 二进制的环境变量, the runner 子进程 shall 使用该二进制启动,而不依赖系统 PATH 上的 `node`。
3. If 未提供该注入的 Node 二进制环境变量, then the 后端 shall 沿用现有默认行为(使用 `node`),使 CLI 与开发模式行为与改动前完全一致。
4. When runner 子进程被拉起, the 桌面应用 shall 将子进程正常运行所需的环境(包括产物路径与数据目录相关变量)透传给该子进程。

### Requirement 5: 本地服务安全边界
**Objective:** 作为注重安全的用户,我想桌面版的本地服务不对外暴露、渲染层不被授予过度系统权限,以便降低本地服务被滥用的风险。

#### Acceptance Criteria
1. The 桌面应用 shall 仅在回环地址(127.0.0.1)上监听本地服务器,不绑定对外网络接口。
2. The 桌面应用 shall 为本地服务器使用随机(非固定)端口。
3. The 桌面应用 shall 以隔离的渲染上下文加载 Web UI,不向页面授予直接的 Node/系统集成能力。
4. When 用户在应用内点击指向外部站点的链接, the 桌面应用 shall 交由系统默认浏览器打开,而不在应用窗口内导航离开本地 UI。

### Requirement 6: 退出与进程树收尾
**Objective:** 作为用户,我想关闭应用后不残留后台进程,以便不浪费系统资源、也不出现端口被占用的问题。

#### Acceptance Criteria
1. When 用户关闭应用主窗口, the 桌面应用 shall 关停其拉起的本地服务器进程。
2. When 桌面应用关停本地服务器进程, the 桌面应用 shall 一并终止由服务器派生的 runner 子进程,不遗留孤儿进程。
3. If 本地服务器进程在退出流程中未在合理时限内正常结束, then the 桌面应用 shall 强制终止其进程树以确保清理完成。
4. When 桌面应用完成退出流程, the 桌面应用 shall 释放其占用的本地端口。

### Requirement 7: 与 CLI 共享数据目录
**Objective:** 作为同时使用终端与桌面版的开发者,我想两者操作同一份会话与配置,以便在两种入口间无缝切换。

#### Acceptance Criteria
1. The 桌面应用 shall 默认使用与 CLI 相同的数据目录(`~/.pi/agent`)读写会话、配置与附件。
2. When 用户在桌面版中创建会话, the 桌面应用 shall 将其持久化到与 CLI 共享的数据目录,使该会话在 CLI 入口下同样可见。
3. The 桌面应用 shall 不改变现有会话、配置与附件的存储语义。

### Requirement 8: 开发模式指向运行中的 dev server
**Objective:** 作为开发桌面壳的工程师,我想在开发时让壳连到已运行的 dev server 而非自行打包拉起,以便保留前端热更新、加快迭代。

#### Acceptance Criteria
1. Where 桌面应用以开发模式运行, the 桌面应用 shall 加载已运行的开发服务器地址,而不自行拉起 standalone server。
2. While 桌面应用处于开发模式, the 桌面应用 shall 不要求预先执行 standalone 产物打包即可启动窗口。
3. The 桌面应用 shall 通过明确的模式开关(而非猜测)区分开发模式与打包运行形态。

### Requirement 9: macOS 安装包产出与干净机器验证
**Objective:** 作为分发者,我想产出可分发的 macOS 安装包并证明它在无 Node 环境可用,以便交付一个真正自包含的桌面版。

#### Acceptance Criteria
1. The 桌面应用构建流程 shall 产出可分发的 macOS 安装包(dmg)。
2. When 在一台未安装 Node 运行时的 macOS 机器上安装并启动该安装包, the 桌面应用 shall 成功启动并进入聊天界面。
3. When 用户在该干净机器上发起一次真实(非桩)会话并发送消息, the 桌面应用 shall 返回流式回复,证明后端与 runner 子进程链路可用。
4. The 桌面应用交付 shall 附带以新鲜运行证据佐证的验证记录(启动成功 + 真实会话跑通)。
