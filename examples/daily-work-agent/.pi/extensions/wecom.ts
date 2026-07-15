/**
 * Project-level WeCom extension for daily-work-agent.
 * Re-exports @blksails/pi-web-wecom so pi resource-loader discovers it under .pi/extensions/
 * when cwd is this agent directory and the project is trusted.
 *
 * Tools: wecom_send, wecom_send_file, wecom_send_menu, wecom_get_binding, wecom_gateway_health
 * Requires pi-gateway at PI_GATEWAY_BASE_URL (default http://127.0.0.1:7930).
 */
export { default } from "../../../../packages/wecom-extension/src/index.ts";
