---
name: skill-create
description: 创建或完善一个可被 pi 自动发现的 Skill
argument-hint: 技能目标、使用场景或改进要求
---

请依据下面的目标，创建或完善一个 pi Skill：

$ARGUMENTS

执行规则：

1. 先明确技能名称、触发场景、输入输出与边界；名称须使用小写字母、数字、点、下划线或连字符。
2. 遵循当前项目的 Skill 约定，目录中写入 `SKILL.md`，并包含 `name`、`description` frontmatter。
3. 未指定范围时，先判断用户意图：项目技能写入当前项目的 `.pi/skills/<name>/SKILL.md`，个人技能写入用户 agent 目录的 `skills/<name>/SKILL.md`；不得擅自覆盖已有文件。
4. 正文只保留执行任务所需的步骤、判断条件、工具约束与验证方式；避免重复项目已有规则。
5. 写入前检查目标路径与现有内容；若会覆盖或需求不足，先向用户说明并确认。
6. 写入后复读文件，检查 frontmatter、路径、命令与示例可执行；最后简述变更与验证结果。
