# Agentic SDLC and Spec-Driven Development

Kiro-style Spec-Driven Development on an agentic SDLC

## Project Context

### Paths
- Steering: `.kiro/steering/`
- Specs: `.kiro/specs/`

### Steering vs Specification

**Steering** (`.kiro/steering/`) - Guide AI with project-wide rules and context
**Specs** (`.kiro/specs/`) - Formalize development process for individual features

### Active Specifications
- Check `.kiro/specs/` for active specifications
- Use `/kiro status [feature-name]` to check progress

## Development Guidelines
- Think in English, generate responses in English. All Markdown content written to project files (e.g., requirements.md, design.md, tasks.md, research.md, validation reports) MUST be written in the target language configured for this specification (see spec.json.language).

## Minimal Workflow
All phases run through the single `kiro` skill (`/kiro <sub>`); the per-phase specs live inside it.
- Phase 0 (optional): `/kiro init` (steering; custom domain files via the `steering-custom` phase)
- Discovery: `/kiro discovery "idea"` — determines action path, writes brief.md + roadmap.md for multi-spec projects
- Phase 1 (Specification):
  - Single spec: `/kiro quick {feature} [--auto]` or step by step:
    - `/kiro spec "description"`
    - `/kiro requirements {feature}`
    - `/kiro validate gap {feature}` (optional: for existing codebase)
    - `/kiro design {feature}`
    - `/kiro validate design {feature}` (optional: design review)
    - `/kiro tasks {feature}`
  - Multi-spec: `/kiro batch` — creates all specs from roadmap.md in parallel by dependency wave
- Phase 2 (Implementation): `/kiro run {feature} [tasks]`
  - Without task numbers: autonomous mode (subagent per task + independent review + final validation)
  - With task numbers: manual mode (selected tasks in main context, still reviewer-gated before completion)
  - `/kiro next` for one task in the main conversation; `/kiro workflow {feature}` for parallel Workflow orchestration
  - `/kiro validate impl {feature}` (standalone re-validation)
- Progress check: `/kiro status {feature}` (use anytime)

## Skills Structure
The kiro pipeline ships as one skill: `~/.claude/skills/kiro/`
> Not vendored in this repo anymore. Harnesses without a `Skill` tool must read these files directly by path; if the directory is absent on the machine, the kiro pipeline is unavailable and the phases below cannot be followed.
- `SKILL.md` — router, state detection, approval gates, execution modes
- `phases/<x>/SKILL.md` — the full spec for each phase (steering, discovery, spec-init, spec-requirements, spec-design, spec-tasks, spec-batch, spec-quick, impl, review, debug, validate-gap, validate-design, validate-impl, verify-completion), plus their `rules/` and `templates/`
- `assets/templates/` — bootstrap copies of `.kiro/settings/templates/`
- `workflows/` — `parse-tasks.mjs` + `spec-exec.workflow.js` for Workflow-native parallel execution
- Subagents may call skills: prefer `Skill(kiro-<x>)` when the host registers one, otherwise read `~/.claude/skills/kiro/phases/<x>/SKILL.md`
- `review` — task-local adversarial review protocol used by reviewer subagents
- `debug` — root-cause-first debug protocol used by debugger subagents
- `verify-completion` — fresh-evidence gate before success or completion claims
- **If there is even a 1% chance a skill applies to the current task, invoke it.** Do not skip skills because the task seems simple.

## Development Rules
- 3-phase approval workflow: Requirements → Design → Tasks → Implementation
- Human review required each phase; use `-y` only for intentional fast-track
- Keep steering current and verify alignment with `/kiro status`
- Follow the user's instructions precisely, and within that scope act autonomously: gather the necessary context and complete the requested work end-to-end in this run, asking questions only when essential information is missing or the instructions are critically ambiguous.

## Steering Configuration
- Load entire `.kiro/steering/` as project memory
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via the `steering-custom` phase of `/kiro init`)
