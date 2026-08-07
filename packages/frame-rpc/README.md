# @blksails/pi-web-frame-rpc

宿主 ↔ 沙箱 `<iframe>` 的最小可信通信地基。零依赖、框架无关，宿主侧与子帧侧各一份参考实现。

面向的场景：把**第三方页面或模型生成的 UI** 放进 `sandbox="allow-scripts"` 子帧。隔离由 sandbox
属性给，但**通信本身**很容易把隔离白送掉——本包提供的就是那套不会送掉隔离的协议。

```bash
pnpm add @blksails/pi-web-frame-rpc
```

## 宿主侧

```ts
import { connectSandboxFrame } from "@blksails/pi-web-frame-rpc";

const conn = connectSandboxFrame({
  frame: iframeEl,               // 只用到 contentWindow
  instanceId: "preview-1",
  endpoint: {
    handlers: { getTheme: () => ({ mode: "dark" }) },   // 子帧可调的方法
    privilegedEvents: ["navigate", "openModule"],       // 后台静音名单
    onEvent: (name, data) => bus.emit(name, data),
  },
  onConnect: (ep) => void ep.request("render", scene),
});

conn.setVisible(false);   // 面板被隐藏：子帧收到通知去停 rAF，且高权限事件被静音
conn.destroy();
```

`<iframe>` 必须写成：

```html
<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" src="/sandbox/preview.html"></iframe>
```

**刻意不含 `allow-same-origin`** —— 加上它等于把宿主 DOM 与凭证交还给该帧，隔离随即归零。

## 子帧侧

```ts
import { connectToHost } from "@blksails/pi-web-frame-rpc";

const guest = connectToHost({
  handlers: { render: (scene) => draw(scene) },
  onVisibility: (visible) => (visible ? start() : stop()),
  onInit: (instanceId, ep) => void ep.notify("ready", { instanceId }),
});
```

## 协议为什么长这样

| 设计 | 理由 |
|---|---|
| **ping-pong 轮询握手**，不是单向 ready | 子帧比父帧先就绪时，单向 ready 会静默丢包（父帧还没挂监听器），表现为随机的「永远转圈」 |
| 握手包是**唯一**的裸 `postMessage` | 不透明 origin 下 `targetOrigin` 只能是 `"*"`，故此通道**不得携带任何机密**；握手一成即改走 `MessagePort` |
| `origin` 是**期望值断言**而非拒收条件 | `sandbox` 无 `allow-same-origin` ⇒ `event.origin` 恒为 `"null"`；收到别的 origin 反而说明不是那个沙箱 |
| 身份锚 = `event.source === iframe.contentWindow` **引用相等** | origin 在这条链路上已报废；引用相等是伪造者拿不到的东西 |
| **ack + 两段超时** | `postMessage` 的发送方感知不到对端处理器抛错（MDN 明言）。短 ack 区分「没收到」与「在慢慢算」，收到 ack 后才换长计时 |
| 词表固定，未知 `t` **丢弃** | 不抛、不记录内容——记录即把不可信数据带进日志 |
| handler 抛错**不回传** message/stack | 对不可信子帧而言那是宿主内部信息泄漏；只回固定文案 |
| method 名**仅在字符集受控时**回显 | 回显不可信输入本身是放大面（日志注入 / 终端转义） |
| **入站并发上限** | 不可信对端可用 `req` 洪水打满宿主 handler |
| **后台静音**（Luigi `skipEventsWhenInactive` 范式） | 被隐藏的帧仍能发 navigate/openModule ⇒ 既是 UX bug，也是 UI 劫持面 |
| **不跨边界传函数** | 函数代理 = 向不可信侧永久授予能力，沙箱场景反模式 |

## 两侧不对称的地方（照抄另一侧会写错）

- 子帧**无法**校验 origin（宿主 origin 对它是任意的，硬编码即把库锁死在一个部署上）；子帧唯一
  可用的锚是 `event.source === window.parent`。
- 子帧**必须**接受重复的 `init`：宿主 React 树重挂会重新握手，若沿用宿主侧「已连接则忽略」，
  子帧会永远抱着一根已死的管道。本实现改为**换管道**（旧端点销毁）。

## 测试

```bash
pnpm -F @blksails/pi-web-frame-rpc test
```

覆盖：三道闸各拒收路径、无 ack 短超时且 pending 不泄漏、ack 后长计时独立、双向 `req` 服务、
未知 method 与原型链属性、handler 错误不外泄、入站并发上限、后台静音、未知 type 丢弃、
握手轮询与「可见性先于 init」的次序、伪造 ready、握手超时、重复 init 换管道、host↔guest 端到端。
