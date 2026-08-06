import {
  MaterialsApplicationError,
  type MaterialsCommand,
} from "./contracts.js";

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function guard(body: Record<string, unknown>): {
  readonly confirmed: true;
  readonly idempotencyKey: string;
} {
  if (body.confirmed !== true) {
    throw new MaterialsApplicationError(
      "confirmation_required",
      "此操作须显式确认。",
      400,
    );
  }
  if (typeof body.idempotencyKey !== "string" || body.idempotencyKey.trim() === "") {
    throw new MaterialsApplicationError(
      "idempotency_key_required",
      "此操作缺少幂等键。",
      400,
    );
  }
  return { confirmed: true, idempotencyKey: body.idempotencyKey.trim() };
}

/** 旧 Pane `op` 仅在 Route 边界解析一次；服务内部不再传播字符串分支。 */
export function legacyMaterialsCommand(
  body: Record<string, unknown>,
): MaterialsCommand {
  switch (body.op) {
    case "add-to-library":
      return {
        kind: "add-to-library",
        ids: asStrings(body.ids),
      };
    case "create-folder":
      return {
        kind: "create-folder",
        name: typeof body.name === "string" ? body.name : "",
        parentId: typeof body.parentId === "string" ? body.parentId : null,
      };
    case "rename-folder":
      return {
        kind: "rename-folder",
        id: typeof body.id === "string" ? body.id : "",
        name: typeof body.name === "string" ? body.name : "",
      };
    case "delete-folder":
      return {
        kind: "delete-folder",
        id: typeof body.id === "string" ? body.id : "",
        ...guard(body),
      };
    case "move-materials":
      return {
        kind: "move-materials",
        ids: asStrings(body.ids),
        folderId: typeof body.folderId === "string" ? body.folderId : null,
        ...guard(body),
      };
    case "rename": {
      const items = Array.isArray(body.items)
        ? body.items.flatMap((value) => {
            if (typeof value !== "object" || value === null) return [];
            const row = value as Record<string, unknown>;
            return typeof row.id === "string" && typeof row.name === "string"
              ? [{ id: row.id, name: row.name }]
              : [];
          })
        : [];
      return {
        kind: "rename-materials",
        items,
        ...(items.length > 1 ? guard(body) : {}),
      };
    }
    case "delete":
      return {
        kind: "delete-materials",
        ids: asStrings(body.ids),
        ...guard(body),
      };
    case "distribute":
      return {
        kind: "distribute",
        ids: asStrings(body.ids),
        advertiserIds: asStrings(body.advertiserIds),
        ...guard(body),
      };
    default:
      throw new MaterialsApplicationError(
        "invalid_request",
        `未知素材操作: ${String(body.op ?? "")}`,
        400,
      );
  }
}
