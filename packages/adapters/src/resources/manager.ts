import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  DefaultPackageManager,
  SettingsManager,
  type PackageManager,
} from "@earendil-works/pi-coding-agent";
import type {
  CreateSkillInput,
  CreateTemplateInput,
  ManagedResource,
  ManagedResourceKind,
  ResourceCatalog,
  ResourceManager,
  ResourceManagerOptions,
  ResourceScope,
} from "./types.js";

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_RESOURCE_BYTES = 512 * 1024;

interface ResourceRoots {
  readonly skills: string;
  readonly prompts: string;
}

interface ParsedMarkdown {
  readonly name?: string;
  readonly description?: string;
  readonly argumentHint?: string;
}

function validateName(name: string): string {
  if (!NAME_PATTERN.test(name) || name === "." || name === "..") {
    throw new Error("Resource name must be 1-64 ASCII letters, numbers, '.', '_' or '-'.");
  }
  return name;
}

function rootsForScope(scope: ResourceScope, cwd: string, agentDir: string, companyRoot?: string): ResourceRoots {
  if (scope === "company") {
    if (companyRoot === undefined || companyRoot.length === 0) {
      throw new Error("Company resource root is not configured.");
    }
    return { skills: join(companyRoot, "skills"), prompts: join(companyRoot, "prompts") };
  }
  if (scope === "agent") {
    return { skills: join(cwd, ".pi", "skills"), prompts: join(cwd, ".pi", "prompts") };
  }
  return { skills: join(agentDir, "skills"), prompts: join(agentDir, "prompts") };
}

function assertWithin(root: string, target: string): void {
  const rootAbs = resolve(root);
  const targetAbs = resolve(target);
  const rel = relative(rootAbs, targetAbs);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.includes(`${sep}..${sep}`)) {
    throw new Error("Resource path escapes its configured root.");
  }
}

function parseFrontmatter(text: string): ParsedMarkdown {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end < 0) return {};
  const result: { name?: string; description?: string; argumentHint?: string } = {};
  for (const line of text.slice(4, end).split("\n")) {
    const match = /^(name|description|argument-hint):\s*(.*)$/.exec(line);
    if (match === null) continue;
    const value = match[2]!.trim().replace(/^['"]|['"]$/g, "");
    if (match[1] === "name") result.name = value;
    else if (match[1] === "description") result.description = value;
    else result.argumentHint = value;
  }
  return result;
}

async function readMarkdown(path: string): Promise<{ readonly text: string; readonly meta: ParsedMarkdown }> {
  const text = await readFile(path, "utf8");
  if (Buffer.byteLength(text, "utf8") > MAX_RESOURCE_BYTES) {
    throw new Error(`Resource is larger than ${MAX_RESOURCE_BYTES} bytes: ${path}`);
  }
  return { text, meta: parseFrontmatter(text) };
}

async function walk(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") files.push(path);
  }
  return files;
}

async function scanSkillRoot(root: string, scope: ResourceScope): Promise<ManagedResource[]> {
  const files = (await walk(root)).filter((path) => basename(path).toUpperCase() === "SKILL.MD");
  const resources: ManagedResource[] = [];
  for (const path of files) {
    const { text, meta } = await readMarkdown(path);
    const name = basename(dirname(path));
    resources.push({
      kind: "skill",
      scope,
      name,
      description: meta.description ?? text.split("\n").find((line) => line.trim().length > 0 && !line.startsWith("#"))?.trim() ?? "",
      path,
    });
  }
  return resources;
}

async function scanPromptRoot(root: string, scope: ResourceScope): Promise<ManagedResource[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files = entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".md")
    .map((entry) => join(root, entry.name));
  const resources: ManagedResource[] = [];
  for (const path of files) {
    const { text, meta } = await readMarkdown(path);
    resources.push({
      kind: "template",
      scope,
      name: basename(path, extname(path)),
      description: meta.description ?? text.split("\n").find((line) => line.trim().length > 0 && !line.startsWith("#"))?.trim() ?? "",
      ...(meta.argumentHint !== undefined ? { argumentHint: meta.argumentHint } : {}),
      path,
    });
  }
  return resources;
}

function templateFrontmatter(name: string, description: string, argumentHint: string | undefined): string {
  const lines = ["---", `name: ${name}`, `description: ${JSON.stringify(description)}`];
  if (argumentHint !== undefined && argumentHint.length > 0) {
    lines.push(`argument-hint: ${JSON.stringify(argumentHint)}`);
  }
  lines.push("---", "");
  return `${lines.join("\n")}\n`;
}

function assertResourceBytes(text: string): void {
  if (Buffer.byteLength(text, "utf8") > MAX_RESOURCE_BYTES) {
    throw new Error(`Resource is larger than ${MAX_RESOURCE_BYTES} bytes.`);
  }
}

export class PiResourceManager implements ResourceManager {
  private readonly cwd: string;
  private readonly agentDir: string;
  private readonly companyRoot: string | undefined;
  private readonly packageManager: PackageManager;

  constructor(options: ResourceManagerOptions) {
    this.cwd = resolve(options.cwd);
    this.agentDir = resolve(options.agentDir);
    this.companyRoot = options.companyRoot === undefined ? undefined : resolve(options.companyRoot);
    this.packageManager = options.packageManager ?? new DefaultPackageManager({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager: SettingsManager.create(this.cwd, this.agentDir, { projectTrusted: true }),
    });
  }

  private roots(scope: ResourceScope): ResourceRoots {
    return rootsForScope(scope, this.cwd, this.agentDir, this.companyRoot);
  }

  async list(): Promise<ResourceCatalog> {
    const scopes: ResourceScope[] = ["company", "agent", "personal"];
    const skills: ManagedResource[] = [];
    const templates: ManagedResource[] = [];
    for (const scope of scopes) {
      let roots: ResourceRoots;
      try {
        roots = this.roots(scope);
      } catch {
        continue;
      }
      skills.push(...(await scanSkillRoot(roots.skills, scope)));
      templates.push(...(await scanPromptRoot(roots.prompts, scope)));
    }
    return {
      skills: skills.sort((a, b) => `${a.scope}/${a.name}`.localeCompare(`${b.scope}/${b.name}`)),
      templates: templates.sort((a, b) => `${a.scope}/${a.name}`.localeCompare(`${b.scope}/${b.name}`)),
      packages: this.packageManager.listConfiguredPackages(),
    };
  }

  async createSkill(input: CreateSkillInput): Promise<ManagedResource> {
    const name = validateName(input.name);
    const root = this.roots(input.scope).skills;
    const filePath = join(root, name, "SKILL.md");
    assertWithin(root, filePath);
    const description = input.description?.trim() ?? "";
    const content = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${input.content.trimEnd()}\n`;
    assertResourceBytes(content);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, { encoding: "utf8", flag: input.overwrite === true ? "w" : "wx" });
    return { kind: "skill", scope: input.scope, name, description, path: filePath };
  }

  async createTemplate(input: CreateTemplateInput): Promise<ManagedResource> {
    const name = validateName(input.name);
    const root = this.roots(input.scope).prompts;
    const filePath = join(root, `${name}.md`);
    assertWithin(root, filePath);
    const description = input.description?.trim() ?? "";
    await mkdir(dirname(filePath), { recursive: true });
    const content = `${templateFrontmatter(name, description, input.argumentHint?.trim())}${input.content.trimEnd()}\n`;
    assertResourceBytes(content);
    await writeFile(
      filePath,
      content,
      { encoding: "utf8", flag: input.overwrite === true ? "w" : "wx" },
    );
    return { kind: "template", scope: input.scope, name, description, path: filePath };
  }

  async remove(kind: ManagedResourceKind, scope: ResourceScope, name: string): Promise<void> {
    const safeName = validateName(name);
    const root = kind === "skill" ? this.roots(scope).skills : this.roots(scope).prompts;
    const filePath = kind === "skill" ? join(root, safeName, "SKILL.md") : join(root, `${safeName}.md`);
    assertWithin(root, filePath);
    await rm(kind === "skill" ? dirname(filePath) : filePath, { recursive: kind === "skill", force: false });
  }

  async installPackage(scope: ResourceScope, source: string): Promise<void> {
    if (scope === "company") throw new Error("Company package installation is not supported by pi settings.");
    await this.packageManager.installAndPersist(source, { local: scope === "agent" });
  }

  async removePackage(scope: ResourceScope, source: string): Promise<boolean> {
    if (scope === "company") throw new Error("Company package removal is not supported by pi settings.");
    return this.packageManager.removeAndPersist(source, { local: scope === "agent" });
  }
}

export function createPiResourceManager(options: ResourceManagerOptions): ResourceManager {
  return new PiResourceManager(options);
}
