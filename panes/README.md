# 宿主内置 pane 的 guest 源码

spec: `host-builtin-panes`

## 这里放什么

每个子目录是一个内置 pane 的 guest 实现,入口固定为 `main.tsx`:

```
panes/
├── session-info/main.tsx     # → paneId `host:session-info`
└── generated.d.ts            # 产物的类型垫片(产物本身不入库)
```

`scripts/build-builtin-panes.ts` **按目录扫描**,把每个 `main.tsx` 打成自足 IIFE 并内联进
一份带 CSP 的 HTML,汇总写入 `panes/generated.ts`。

**新增一个内置 pane** = 建一个目录写 `main.tsx` + 在 `lib/app/builtin-panes/index.ts` 的清单
里加一行。构建侧零改动。

## 三条约束

1. **不从宿主 realm 引入任何东西**。pane 跑在 `sandbox="allow-scripts"` 的 iframe 里,是独立
   realm、opaque origin。这里的代码只能 import npm 包与本目录下的文件;`@blksails/pi-web-ui`
   之类宿主包一律不可用(装了也拿不到宿主的 React 实例与 CSS)。
   例外:`@blksails/pi-web-panes-kit/guest` 是**为 guest 侧设计**的,可以用。

2. **对通道返回值做运行期校验**。`guest.query<T>()` 的泛型是**断言不是校验**。宿主在 route
   未声明时会把 404 错误体当正常结果 resolve 回来,直接解构就是渲染期崩溃、整个 pane 被卸载。
   信号载荷同理:字段缺失时显示空态,不要假定形状。

3. **给宿主浮层让位**。宿主的面板比例切换器固定在右下角,会盖住 pane 右下角的内容。
   基础样式里已给 `.pane-body` 留了 `padding-bottom` —— 不要靠改宿主 chrome 解决。

## 本地跑

```bash
node --import jiti/register scripts/build-builtin-panes.ts
```

`pnpm dev` 与 `pnpm build:client` 都已前置该步骤,通常不必手动执行。产物缺失时 vite 会在
解析 `panes/generated.js` 时失败并指向本文件。
