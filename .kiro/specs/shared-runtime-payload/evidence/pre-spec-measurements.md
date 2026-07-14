# 立项前实测数据

所有数字均在 macOS 24.6.0 / Apple Silicon、本 worktree（`feat/electron-to-tauri`，含第一层剪枝 `cb45637`）上实际执行命令得到，非估算。

## dist 产物构成

```
du -sh dist        →  85M
du -sh dist/*      →  65M node_modules / 15M client / 3.3M packages
                      620K server.mjs / 584K examples / 48K lib / 4.0K schema-registry.data.json
find dist -type f | wc -l  →  8795
find dist -type d | wc -l  →  1595
```

node_modules 前几大：`@mistralai` 11M、`@earendil-works` 5.0M、`@google` 4.7M、`@opentelemetry` 4.5M、`@mariozechner` 4.4M。

## 压缩率

```
tar cf - dist | gzip -6      | wc -c  →  15.7 MB
tar cf - dist | zstd -19 -T0 | wc -c  →   9.5 MB
gzip -6 -c node-aarch64-apple-darwin  →  31.8 MB  （sidecar node 原 85.6MB，供第三层参考）
```

## 安装包体积（UDZO dmg，`hdiutil create -format UDZO`）

| 形态 | `.app` | dmg |
|---|---:|---:|
| 现状（内嵌完整 `dist/`） | 176 MB | **80.7 MB** |
| 把 `Contents/Resources/dist/` 换成 `runtime/dist.tar.gz` | 107 MB | **54.3 MB** |

⇒ 下载体积 **−32.7%**。dmg 自身即压缩格式，故收益远小于「85MB → 15.7MB」的朴素直觉。

## 归档格式的硬约束

```
find dist -type l | wc -l            →  11   （dist/node_modules/@blksails/pi-web-* → ../../packages/*）
find dist -type f -perm -u+x | wc -l →  38   （jiti-cli.mjs / node-which / yaml/bin.mjs 等）
最长相对路径                          →  155 字符（> ustar name 字段 100 字符上限）
```

## Node 运行时能力

```
根 package.json  engines.node  →  >=22.19.0
宿主   node v22.22.0  →  zlib.createZstdCompress / createZstdDecompress = function
sidecar node v22.22.0 →  zlib.createZstdCompress / createZstdDecompress = function
```

Node 自 22.15.0 起提供 zstd 流式 API。Node 无内置 tar 读写实现。

## 由此推出的磁盘占用预测（待实现后复测）

| 场景 | 今天 | gz 载荷 | zstd 载荷 |
|---|---:|---:|---:|
| 仅装桌面版 | 176 | 107 + 85 = 192 | 101 + 85 = 186 |
| 仅装 CLI | 85 | 15.7 + 85 = 100.7 | 9.5 + 85 = 94.5 |
| 两者都装 | 261 | 122.7 + 85 = 207.7 | 110.5 + 85 = 195.5 |

**单产品磁盘占用变差**（载荷与解包副本各存一份），**两者都装时净省 ~55~65MB**，**下载体积一律下降**。这是本 spec 必须以阈值条款正面面对的取舍。
