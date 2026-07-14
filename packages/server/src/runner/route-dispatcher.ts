/**
 * agent-declared-routes · 纯请求派发器 `createRouteDispatcher`。
 *
 * SRP/DIP 收口:把「请求帧 → 结果帧」的**纯逻辑**(registry 查找 + invoke handler + 错误归一化)
 * 从 runner 接线(`wireAgentRoutesBridge`)里剥离出来。本模块**不依赖** FrameChannel / stdio / IO,
 * 只依赖领域类型,故可脱离通道独立单测。
 *
 * 归一化契约(与既有线协议逐字一致):
 *  - name 未注册 → `ok:false, code:"route_not_registered"`;
 *  - handler 抛错 → `ok:false, code:"handler_error"`(message 取 Error.message);
 *  - handler 返回值不可 JSON 序列化(如循环引用)→ `ok:false, code:"handler_error"`
 *    (序列化探针**只作用于不可信的返回值** `value`,结果帧其余字段均为我方掌控的原语);
 *  - 正常 → `ok:true`(+ `result` 当 value 非 undefined)。
 *
 * `dispatch` **永不 reject**:所有失败都归一化为结果帧,交由调用方原样回流。
 */
import type {
  AgentRouteRequestFrame,
  AgentRouteResultFrame,
} from "@blksails/pi-web-protocol";
import type { NormalizedAgentRouteDecl } from "./agent-loader.js";

export interface RouteDispatcher {
  /** 请求帧 → 归一化结果帧。永不 reject。 */
  dispatch(frame: AgentRouteRequestFrame): Promise<AgentRouteResultFrame>;
}

const RESULT_TYPE = "piweb_agent_route_result" as const;

/** 归一化错误结果帧(单一构造点)。 */
function errorFrame(
  id: string,
  code: "route_not_registered" | "handler_error",
  message: string,
): AgentRouteResultFrame {
  return { type: RESULT_TYPE, id, ok: false, error: { code, message } };
}

/**
 * 构造进程内路由派发器。handler 引用只存活于闭包 registry,不出进程。
 *
 * @param routes 归一化声明(含 handler 引用,来自 agent-loader)。
 */
export function createRouteDispatcher(
  routes: readonly NormalizedAgentRouteDecl[],
): RouteDispatcher {
  const registry = new Map<string, NormalizedAgentRouteDecl>(
    routes.map((decl) => [decl.name, decl]),
  );

  return {
    async dispatch(frame) {
      const entry = registry.get(frame.name);
      if (entry === undefined) {
        // 防御路径,正常不发生——主进程已按路由表 404。
        return errorFrame(
          frame.id,
          "route_not_registered",
          `route not registered in this agent process: ${frame.name}`,
        );
      }

      let value: unknown;
      try {
        value = await entry.handler({
          name: frame.name,
          method: frame.method,
          query: frame.query,
          ...(frame.body !== undefined ? { body: frame.body } : {}),
        });
      } catch (err) {
        return errorFrame(
          frame.id,
          "handler_error",
          err instanceof Error ? err.message : String(err),
        );
      }

      // 只探不可信的返回值:不可序列化(如循环引用)→ handler_error,避免悬挂主进程 pending。
      // 结果帧其余字段均为原语,`ctx.send` 到线时单次序列化即可(不再整帧双探)。
      try {
        JSON.stringify(value);
      } catch (err) {
        return errorFrame(
          frame.id,
          "handler_error",
          `route result is not JSON-serializable: ${String(err)}`,
        );
      }

      return {
        type: RESULT_TYPE,
        id: frame.id,
        ok: true,
        ...(value !== undefined ? { result: value } : {}),
      };
    },
  };
}
