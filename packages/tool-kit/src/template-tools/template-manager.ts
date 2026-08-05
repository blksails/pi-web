import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

export type TemplateScope = "company" | "agent" | "personal";

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function templateRoot(
  scope: TemplateScope,
  cwd: string,
  agentDir: string,
  companyRoot = process.env.PI_WEB_COMPANY_RESOURCES_DIR
    ?? (process.env.PI_WEB_COMPANY_PROMPTS_DIR === undefined
      ? undefined
      : dirname(process.env.PI_WEB_COMPANY_PROMPTS_DIR)),
): string {
  if (scope === "company") {
    if (companyRoot === undefined || companyRoot.trim().length === 0) {
      throw new Error("Company resource root is not configured.");
    }
    return resolve(companyRoot, "prompts");
  }
  return scope === "agent"
    ? resolve(cwd, ".pi", "prompts")
    : resolve(agentDir, "prompts");
}

export function validateTemplateName(name: string): string {
  if (!NAME_PATTERN.test(name) || name === "." || name === "..") {
    throw new Error("Template name must be 1-64 ASCII letters, numbers, '.', '_' or '-'.");
  }
  return name;
}

export function renderPromptTemplate(
  name: string,
  description: string,
  content: string,
  argumentHint?: string,
): string {
  const lines = ["---", `name: ${name}`, `description: ${JSON.stringify(description)}`];
  if (argumentHint !== undefined && argumentHint.trim().length > 0) {
    lines.push(`argument-hint: ${JSON.stringify(argumentHint.trim())}`);
  }
  lines.push("---", "", content.trimEnd(), "");
  return lines.join("\n");
}

export async function createPromptTemplate(options: {
  readonly scope: TemplateScope;
  readonly name: string;
  readonly description?: string;
  readonly argumentHint?: string;
  readonly content: string;
  readonly cwd?: string;
  readonly agentDir?: string;
}): Promise<string> {
  const name = validateTemplateName(options.name);
  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(process.cwd(), ".pi", "agent");
  const root = templateRoot(options.scope, cwd, agentDir);
  const filePath = join(root, `${name}.md`);
  const rel = relative(root, resolve(filePath));
  if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Template path escapes its root.");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    renderPromptTemplate(name, options.description?.trim() ?? "", options.content, options.argumentHint),
    { encoding: "utf8", flag: "wx" },
  );
  return filePath;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export default function templateManager(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "create_prompt_template",
    label: "Create prompt template",
    description:
      "Create a pi-native Markdown prompt template. Use scope agent for this project, personal for the user profile, or company for the configured company resource root. Never overwrite an existing template.",
    parameters: Type.Object({
      name: Type.String({ description: "Stable template name, 1-64 ASCII letters/numbers/._-" }),
      content: Type.String({ description: "Prompt body. Include $1, $2, or named placeholders as needed." }),
      description: Type.Optional(Type.String({ description: "Short description shown in template discovery." })),
      argumentHint: Type.Optional(Type.String({ description: "Hint shown when invoking the template." })),
      scope: Type.Optional(
        Type.Union([
          Type.Literal("agent"),
          Type.Literal("personal"),
          Type.Literal("company"),
        ]),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const p = params as {
        name: string;
        content: string;
        description?: string;
        argumentHint?: string;
        scope?: TemplateScope;
      };
      try {
        const filePath = await createPromptTemplate({
          ...p,
          cwd: ctx.cwd,
          agentDir: process.env.PI_CODING_AGENT_DIR,
          scope: p.scope ?? "agent",
        });
        ctx.ui.notify(`已创建模板: ${filePath}`, "info");
        return textResult(`Created pi prompt template at ${filePath}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create template.";
        ctx.ui.notify(`模板创建失败: ${message}`, "error");
        return textResult(`Template creation failed: ${message}`);
      }
    },
  });
}
