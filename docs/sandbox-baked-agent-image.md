# 烘焙 agent 镜像 · 本地沙盒开发闭环操作文档

> spec `sandbox-baked-agent-image`(Req 6.1/6.3)· 关联脚本:`scripts/build-agent-image.mjs`、`scripts/dev-e2b-local.mjs`
> 目标:**单命令**把一个 agent source 目录变成「专属沙箱镜像 → 已注册模板 → 可用的沙盒 dev」,网页建会话即跑在沙箱里,装配面(工具 / webext / 布局)与非沙盒 dev 一致。

---

## 0. TL;DR(单命令)

```bash
PI_WEB_E2B_BAKE_SOURCE=examples/hello-agent pnpm dev:e2b:local
```

这条命令按序做五件事:

1. 从本地 kind 集群的 agent-sandbox Deployment 读 `SYSTEM_TOKEN`(= `E2B_API_KEY`,无需手填);
2. **bake**:`node scripts/build-agent-image.mjs examples/hello-agent --kind-load --register`
   —— 构建专属镜像 → `kind load` 进集群 → 注册为 agent-sandbox 模板(含 manager 重启等就绪);
3. `kubectl port-forward svc/agent-sandbox 10000:80` + 起本地 e2b 反代(:13000);
4. 注入 `PI_WEB_E2B_TEMPLATE_MAP='{"<source 绝对路径>":"<烘焙模板名>"}'`;
5. 起 pi-web dev(API `:3020` / vite `:5183`,ws-runner 数据面)。

起来后打开 `http://localhost:5183`,选 source `examples/hello-agent` 建会话——该会话即以烘焙镜像在沙箱内运行。banner 中会多一行确认:

```
bake 模式:source=/…/examples/hello-agent → 模板=烘焙镜像 piweb-agent-hello-agent-xxxxxxxx.xxxxxxxxxxxx(已注入 TEMPLATE_MAP)。
```

同源内容重复执行是幂等的:tag = 源内容哈希 → docker 层缓存命中(秒级),模板注册为同名条目整条替换。

---

## 1. 前置条件

| 前置 | 自检命令 | 说明 |
| --- | --- | --- |
| Docker daemon 在跑 | `docker info` | Docker Desktop / OrbStack 均可(`docker build` 与 `kind load` 都依赖) |
| kind 集群(缺省名 `pi-clouds`) | `kind get clusters` | 集群名不同用构建脚本 `--kind-cluster` 指定(dev 单命令走缺省) |
| agent-sandbox 已部署 | `kubectl -n agent-sandbox get deploy agent-sandbox` | 部署方法见 pi-clouds 仓 `docs/real-machine-verification-checklist` §8;ns/名字不同用 env `AGENT_SANDBOX_NS` / `AGENT_SANDBOX_SVC` 覆盖 |
| 基座镜像本地已存在 | `docker images \| grep agent-runner` | 缺省 `pi-clouds/agent-runner:pi`(内含 node + pi + pi-web-server + runner-entry);换基座用 env `PI_WEB_E2B_BASE_IMAGE` |
| `kubectl` / `kind` CLI | `which kubectl kind` | 缺失时构建脚本会在对应步骤给安装指引 |

数据面用缺省 `ws-runner`(`PI_WEB_E2B_DATAPLANE` 不设即可)。envd 数据面在本地 agent-sandbox 上跑不了 runner,banner 会给出警告。

---

## 2. `PI_WEB_E2B_BAKE_SOURCE` 语义

- **取值**:一个 agent source 目录(须含入口 `index.js` 或 `index.ts`)。相对路径按当前工作目录解析为**绝对路径**(建议在仓库根执行,如 `examples/hello-agent`)。
- **设置时**:读完 SYSTEM_TOKEN 后先跑 bake 一条龙;**bake 任一步失败 → 不起 dev**,并透传失败步骤的原始错误与修复建议(见 §5)。
- **未设置时**:`dev:e2b:local` 行为与从前完全一致(零行为变化),使用预注册模板(缺省 `piweb-demo`)。
- **TEMPLATE_MAP 合并规则**:注入的映射键 = source 目录绝对路径。若你已显式设置 `PI_WEB_E2B_TEMPLATE_MAP` 且其中**已含同键,则你的显式配置优先**(烘焙项不覆盖);仅键缺失时补入烘焙项。其他键原样保留。
- **全局模板仍然生效**:`PI_WEB_E2B_TEMPLATE`(缺省 `piweb-demo`)继续作为兜底——建会话时 source 命中 map 的用烘焙镜像,其他 source 走全局模板。
- **时序注意**:模板注册(`--register`)会 `rollout restart` agent-sandbox manager,**已建立的 port-forward 会随旧 Pod 断掉**。因此 bake 刻意排在 port-forward 之前。若另一个终端已有 `dev:e2b:local` 或手工 port-forward 在跑,本命令的 bake 会把它们断开——先停掉再跑。
- **不热更新**:bake 只在 dev 启动时执行一次。dev 运行期间修改 agent 源码不会进沙箱(镜像不可变);改完源码 **Ctrl-C 重跑本命令**(内容哈希变了 → 新 tag 新镜像新模板,秒到分钟级)。

### 命名派生(构建期与会话期同一套纯函数)

| 产物 | 形态 | 例(hello-agent) |
| --- | --- | --- |
| slug | `sanitize(目录名)-sha256(标识)前8位` | `hello-agent-4b558455` |
| 镜像 | `piweb-agent/<slug>:<tag>`(tag 缺省=源内容哈希前 12 位) | `piweb-agent/hello-agent-4b558455:f8503971aacb` |
| 模板 | `piweb-agent-<slug>.<tag>` | `piweb-agent-hello-agent-4b558455.f8503971aacb` |

---

## 3. 构建工具单独使用(不起 dev)

```bash
pnpm build:agent-image <sourceDir> [--tag t] [--base-image i] [--no-bundle] \
  [--kind-load] [--kind-cluster c] [--register]
```

- 缺省 bundle 模式:esbuild 把入口打成单文件 `index.js`(externals = pi SDK + `@blksails/*`,由基座镜像全局 node_modules 解析)。agent 依赖 `import.meta.url` 相对路径语义时用 `--no-bundle`(拷全部源,沙箱运行时 jiti 编译)。
- 构建输出会打印收集/排除文件清单(审计)、image:tag、模板名与「下一步指引」;不带 `--kind-load` / `--register` 时指引里给出对应手工命令。
- dev 单命令内部就是 spawn 这个脚本(带 `--kind-load --register`),输出原样可见。

---

## 4. 三种模板接线方式(会话期解析序:map → derive → global → 报错)

建会话时(e2b 分支)按下列顺序为 source 解析沙箱模板,全空则**会话创建失败**并给出含三条修复路径的错误(不静默回退本地执行):

1. **显式映射(map)** —— `PI_WEB_E2B_TEMPLATE_MAP`(JSON:source 标识 → 模板名):

   ```bash
   PI_WEB_E2B_TEMPLATE_MAP='{"/abs/path/to/agent":"piweb-agent-xxx.yyy"}'
   ```

   键做两级查找:先按用户传入的**原始 source 串**精确匹配,再按 resolver 归一后的 **policySource**(dir 归一为绝对路径)。因此 dir 类 source 的键**建议写绝对路径**——用户建会话传相对路径也能经归一命中。`PI_WEB_E2B_BAKE_SOURCE` 就是这条路的自动化(自动构建 + 自动注入)。

2. **派生约定(derive)** —— `PI_WEB_E2B_TEMPLATE_DERIVE=1` 时启用,tag 取 map 值的 `derive:<tag>` 形式(优先)或 `PI_WEB_E2B_TEMPLATE_DERIVE_TAG`;取到 tag 则按 §2 命名派生 `piweb-agent-<slug>.<tag>`。**前置**:agent-sandbox 已注册 dynamic 模板规则

   ```
   piweb-agent-(?P<name>.+)\.(?P<version>.+)$  →  piweb-agent/<name>:<version>
   ```

   (模板名与镜像名互逆,manager 按名字即时解析镜像,无需逐个注册静态条目。)适合「多 agent、镜像已批量入集群」的场景。

3. **全局模板(global)** —— `PI_WEB_E2B_TEMPLATE=<模板名>`:所有 source 同一模板(既有单模板部署的向后兼容位)。

---

## 5. 常见错误与修复(按步骤)

| 步骤 | 症状 | 修复 |
| --- | --- | --- |
| 读 SYSTEM_TOKEN | `无法从 kind 读取 agent-sandbox SYSTEM_TOKEN` | 集群未起或未部署 agent-sandbox:`kubectl -n agent-sandbox get deploy agent-sandbox`;或显式设 `E2B_API_KEY` 跳过自动读取 |
| 烘焙计划 | `烘焙计划失败 [MISSING_ENTRY/…]` | `PI_WEB_E2B_BAKE_SOURCE` 未指向含 `index.js`/`index.ts` 入口的目录;检查路径(相对路径按当前工作目录解析) |
| docker build | `docker build 失败(exit N)` | 看透传的构建输出;`docker info` 确认 daemon;失败时 build context 目录保留,可进去手工复现 |
| kind load | `步骤「kind load」失败` + stderr | `kind get clusters` 确认集群存在(缺省名 `pi-clouds`;不同名单独跑构建脚本加 `--kind-cluster`);确认镜像已构建、docker daemon 在跑 |
| 模板注册(kubectl patch / rollout) | `步骤「读取/写回模板 ConfigMap」失败` 或 `等待 manager 就绪` 超时 | `kubectl config current-context` 确认指向本地集群;ns/名字不同设 `AGENT_SANDBOX_NS` / `AGENT_SANDBOX_SVC`;就绪超时看 `kubectl -n agent-sandbox describe deploy agent-sandbox` 与 `logs deploy/agent-sandbox --tail=100`(常见:镜像拉取失败、模板 JSON 不合法致 manager 启动崩) |
| port-forward | `port-forward 起后 manager :10000 仍不可达` / 端口占用 | 多半是旧的 port-forward 进程还占着端口(bake 的 rollout restart 会断旧转发但进程可能残留):`lsof -i :10000` 找到并 kill 后重跑 |
| 建会话 | 报错 `无法为 source "…" 解析沙箱模板(显式映射 → 派生约定 → 全局模板均未命中)` | 建会话的 source 与 `PI_WEB_E2B_BAKE_SOURCE` 不是同一目录(map 键不命中);改用同一 source,或按错误文案三条修复路径手工接线(§4) |
| 建会话 | 沙箱起不来 / 会话报健康检查失败 | 模板已注册但镜像不在集群里(Pod `ImagePullBackOff`):`kubectl -n agent-sandbox get pods` 查看;重跑单命令(bake 会重新 `kind load`) |
| banner | `⚠ 数据面 = envd …` | 别设 `PI_WEB_E2B_DATAPLANE=envd`;本地闭环用缺省 `ws-runner` |

---

## 6. 与非沙盒 dev 的能力一致性

- **装配面一致(设计目标,Req 1.x/4.1)**:烘焙镜像的启动链为 沙箱 runner-entry → `AGENT_CMD` → `runner-bootstrap --agent /workspace/agent … --cwd … --agent-dir …`,与非沙盒 dev 的 assemble-spawn custom 模式**同一套装配语义**——agent 的工具、webext 贡献(五层)、布局声明在沙箱内外一致(逐项一致性由 e2e `sandbox-baked-image.local` 验证,任务 6.1)。
- **LLM 凭据**:agent 声明的 `config.providerKeys` 键自动并入沙箱 env 白名单,值来自主进程 env——与非沙盒同源。
- **附件**:仅当附件后端拓扑判定为「全远程」(如 cloud-http)时,附件 env 才透传进沙箱,附件能力与非沙盒一致;本地盘后端(拓扑判定不过)时附件 wiring 走既有 fail-closed 降级(`available:false` 提示,不崩溃),**会话其余能力不受影响**。
- **刻意的差异**:
  - 沙箱内 agent 源在 `/workspace/agent` 且随镜像**不可变**(运行产物写沙箱临时区);改源码须重跑 bake(§2「不热更新」)。
  - bundle 模式下 agent 被 esbuild 单文件化,`import.meta.url` 相对路径语义变化——受影响的 agent 构建时用 `--no-bundle`。
