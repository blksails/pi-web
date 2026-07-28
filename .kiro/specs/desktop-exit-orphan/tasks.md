# Implementation Plan — desktop-exit-orphan

## 1. 双层修复

- [x] 1.1 Rust:补 `RunEvent::Exit` 收尾
  - `ExitRequested` 在 macOS Apple Event 退出下不触发,故在事件循环即将退出时**同步**再收一次尾
  - ★ 同步而非 `spawn_blocking`:事件循环已在退出,派出去的任务不保证跑得到
  - _Requirements: 1.1_

- [x] 1.2 Node:父进程守望(`packages/server/src/parent-watchdog.ts`)
  - 壳经 `PI_WEB_SHELL_PID` 下发自己的 pid;server 每 2s 用**信号 0**探测其存活
  - ★ 这不是 1.1 的重复,是它**覆盖不到的那一半**:壳被 SIGKILL 时没有任何收尾机会
  - 不看 `process.ppid === 1` —— 容器与某些 init 下合法启动时 ppid 也可能是 1
  - EPERM(进程在但非本用户)视为存活,不自尽
  - 触发后走与信号相同的 `shutdown()`,不跳过既有清理
  - _Requirements: 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 1.3 测试(14 例)
  - 重点是**不该启用的八种情形**(无 env / 空 / 非数字 / 小数 / 0 / 1 / 负数 / 停表后)——
    误启用的后果是 server 无故自尽,比不修更糟
  - 触发后须停表:否则会反复调用 `shutdown()`,而那条路径里有 `process.exit`
  - _Requirements: 2.1, 2.2_

## 2. 真机验证(打包态,载荷 99cc2b96a348)

- [x] 2.1 两条退出路径均已验通

| 场景 | 壳 | server | 端口 31415 |
|---|---|---|---|
| 优雅退出(Apple Event,同 ⌘Q 路径) | 已退出 | **✓ 已退出** | 无响应 |
| `SIGKILL` 壳(无收尾机会) | 已退出 | **✓ 5s 内自尽** | 无响应 |

两次均零残留进程。

★ 首次测试曾出现**假绿**:启动后 10s 就退出,而 server 那时还没起来 ——
没有 server 自然没有孤儿。已改为「等端口真响应再退出」重测。
这类假绿正是本仓反复强调的「别拿跑绿当判据」。
