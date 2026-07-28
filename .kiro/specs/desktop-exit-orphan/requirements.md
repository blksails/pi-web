# Requirements — desktop-exit-orphan

## 缺陷(2026-07-28 实测复现)

桌面壳退出后,被它拉起的 server 进程**不退出**,变成 PPID=1 的孤儿并继续占着端口。

复现(打包态,干净现场):

```
启动:  壳 96248 → server 96269 → runner 96720
osascript 'tell application "pi-web" to quit'
退出后: 壳 96248 已退出
        server 96269 存活,PPID=1
        31415 仍返回 200
```

## 为什么既有收尾没生效

`RunEvent::ExitRequested → supervisor.stop()` 的链路本身是对的(`stop()` 会对进程组
发 SIGTERM 再升级 SIGKILL),但它**没被触发** —— macOS 的 Apple Event 退出(与 ⌘Q 同路径)
不走 `ExitRequested`。

而且这条链路**天生**覆盖不了壳被 `SIGKILL` 的情形:那时壳没有任何机会执行收尾。
server 又被刻意置为独立进程组组长(为了能整组杀 runner 孙进程),因此也**不会**
随父进程被内核回收。两件事叠加,孤儿几乎是必然。

## 后果不止占端口

调试时打到的可能是**上一次残留的实例**,其内存里还留着旧登录态 ——
`desktop-account-login` 真机验证期间已据此误判过一次「登录状态还在」,
直到查进程树才发现壳早已不存在。这类误判会把后续所有结论带偏。

## Requirements

### Requirement 1:壳退出则 server 退出

1. When 桌面壳正常退出(⌘Q / Apple Event / 菜单退出), the pi-web 宿主 shall 一并终止 server 进程及其子进程,并释放端口。
2. When 桌面壳被强制终止(`SIGKILL`,无收尾机会), the server shall 在数秒内自行退出。
3. The server shall 在自行退出时走与信号退出相同的收尾路径,不得跳过既有清理。

### Requirement 2:不得误伤非桌面形态

1. Where 宿主不是桌面壳(`pnpm dev:server` / npm CLI / 容器), the server shall **不**启用父进程守望 —— 那些形态下父进程消失是正常的(nohup / systemd / docker)。
2. If 守望所需的父进程标识缺失或非法, then the server shall 不启用守望,而**不是**据此退出。
3. If 父进程存在但不属于当前用户(权限受限), then the server shall 视其为存活,不得自行退出。
