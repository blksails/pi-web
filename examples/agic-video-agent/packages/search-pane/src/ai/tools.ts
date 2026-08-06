import { Type } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  getSearchPlatformClient,
  SearchPlatformError,
  type CreativeSearchResult,
  type SearchPlatformClient,
} from "../platform.js";

type ToolSchema = ReturnType<typeof Type.Object>;

export interface SearchToolDefinition {
  readonly name: "creative_search";
  readonly label: string;
  readonly description: string;
  readonly parameters: ToolSchema;
  execute(params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

function toolError(error: unknown): Record<string, unknown> {
  const known = error instanceof SearchPlatformError ? error : undefined;
  return {
    ok: false,
    error: {
      code: known?.code ?? "platform_unavailable",
      message: known?.message ?? String(error),
      status: known?.status ?? 503,
      retryable: known?.retryable ?? true,
    },
  };
}

function validInput(params: Record<string, unknown>) {
  const text = typeof params.text === "string" ? params.text.trim() : "";
  const imageUrl = typeof params.image_url === "string" ? params.image_url.trim() : "";
  if ((text === "") === (imageUrl === "")) {
    throw new SearchPlatformError(
      "Provide text or one image.",
      "invalid_request",
      400,
      false,
    );
  }
  if (imageUrl.length > 20 * 1024 * 1024) {
    throw new SearchPlatformError("Image is too large.", "invalid_request", 400, false);
  }
  const limit =
    typeof params.limit === "number" && Number.isSafeInteger(params.limit)
      ? Math.min(120, Math.max(1, params.limit))
      : 60;
  return {
    ...(text !== "" ? { text } : { imageDataUri: imageUrl }),
    limit,
  };
}

async function executeSearch(
  params: Record<string, unknown>,
  client: SearchPlatformClient,
): Promise<Record<string, unknown>> {
  if (!client.available) return toolError(new SearchPlatformError("platform seam unavailable"));
  const result: CreativeSearchResult = await client.searchCreatives(validInput(params));
  if (result.error) {
    return toolError(new SearchPlatformError(result.error, result.error));
  }
  return { ok: true, ...result };
}

export function createSearchToolDefinitions(
  client: SearchPlatformClient = getSearchPlatformClient(),
): readonly SearchToolDefinition[] {
  return [
    {
      name: "creative_search",
      label: "Creative search",
      description:
        "Search the current signed-in tenant's image material library by text or image vector similarity. Provide exactly one of text and image_url.",
      parameters: Type.Object({
        text: Type.Optional(
          Type.String({ description: "Natural-language image description or search phrase." }),
        ),
        image_url: Type.Optional(
          Type.String({
            description: "Image data URI or an image URL for visual similarity search.",
          }),
        ),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 120, multipleOf: 1 })),
      }),
      execute: async (params) => {
        try {
          return await executeSearch(params, client);
        } catch (error) {
          return toolError(error);
        }
      },
    },
  ];
}

function toolResult(payload: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

export function registerSearchCustomTools(
  pi: ExtensionAPI,
  client: SearchPlatformClient = getSearchPlatformClient(),
): void {
  for (const definition of createSearchToolDefinitions(client)) {
    pi.registerTool({
      name: definition.name,
      label: definition.label,
      description: definition.description,
      parameters: definition.parameters,
      execute: async (_id, params: Record<string, unknown>) =>
        toolResult(await definition.execute(params)),
    });
  }
}

/** 搜图无现成同名远程工具，默认注册进程内工具；显式 disabled 才关闭。 */
export function makeSearchToolsExtension(
  env: NodeJS.ProcessEnv = process.env,
  client?: SearchPlatformClient,
): ExtensionFactory {
  return (pi) => {
    if (env.PI_LABS_SEARCH_AI_ADAPTER === "disabled") return;
    registerSearchCustomTools(pi, client);
  };
}

export const searchToolsExtension = makeSearchToolsExtension();
