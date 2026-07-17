---
name: upload-domain-review
description: 解压域名审核压缩包并 scp 上传到 ab1:~/ablink/public。用户提到域名审核、上传审核文件、ablink/public、审核压缩包、scp ab1 时使用。
---

# upload_domain_review · 上传域名审核文件

## 做什么

1. 拿到本地**压缩包**（或已解压文件夹）
2. 解压（zip / tar / tar.gz / tgz / tar.bz2 / rar）
3. 执行：`scp -r <文件夹> ab1:~/ablink/public`

远端目录默认：`ab1:~/ablink/public`（env `ABLINK_SCP_REMOTE` 可覆盖）。

## 何时触发

- 域名审核 / 审核材料 / 备案审核文件
- 上传到 ablink / public
- 用户发来 `.zip` 等压缩包并要求上传

## 步骤

1. 确认本地路径：`archive`（压缩包）或 `folder`（已解压目录）。
2. **先预览**：不设 `confirm` → 解压（若有）并打印将执行的 `scp` 命令，不上传。
3. 用户确认后：`confirm: true` 真正 scp。
4. 如实汇报 scp 退出码与 stderr；失败时提示检查 `Host ab1` 与密钥。

## 工具参数

| 字段 | 说明 |
|------|------|
| archive | 本地压缩包路径 |
| folder | 已解压目录（与 archive 二选一） |
| remote | 默认 `ab1:~/ablink/public` |
| confirm | **true 才 scp** |
| keep_extract | true 保留临时解压目录 |

## 示例

- 预览：`upload_domain_review({ archive: "/tmp/审核材料.zip" })`
- 上传：`upload_domain_review({ archive: "/tmp/审核材料.zip", confirm: true })`
- 已解压：`upload_domain_review({ folder: "/tmp/site", confirm: true })`

## 解压后选目录规则

- 包内**仅一个顶层文件夹** → scp 该文件夹
- 多个文件散落 → 以压缩包文件名作为文件夹名上传

## 纪律

- 生产机写入：未确认不 scp。
- 不在对话中打印 SSH 私钥内容。
- 依赖本机 `~/.ssh/config` 的 `Host ab1`（IdentityFile 等）。
- 优先用本工具，不要手写带密钥的 scp 命令到日志。
