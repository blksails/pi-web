//! Pane WebView 中继（spec isolated-panes 任务 5.2，Req 9.3/9.4）。
//!
//! Rust 侧只做「instanceId+epoch 绑定 + webview 标签鉴权」的信封路由：`message` 为
//! `serde_json::Value` 原样透传，不解析、不改写协议消息。协议语义（握手、epoch 幂等、
//! 授权、错误码）全部在 TS 两端（panes-kit `adapters/tauri.ts` / `adapters/tauri-bootstrap.ts`）。
//!
//! 授权面：
//! - `pane_relay_bind` / `pane_relay_unbind` / `pane_relay_to_guest` 仅宿主主窗口可调
//!   （`allow-pane-relay-host`，挂 `capabilities/default.json`）；
//! - `pane_relay_to_host` 仅 pane webview 可调（`allow-pane-relay-guest`，挂
//!   `capabilities/panes.json` 的 `pane-*` 标签），且调用方标签必须等于绑定标签。
//!
//! epoch 规则（与 TS `createRelayPanePort` / Guest bridge 对齐）：
//! - 绑定单调：同 instanceId 以更低 epoch 重绑被拒（旧 handle 迟到的 bind 无效）；
//! - 解绑须 epoch 匹配：已被更高 epoch 重绑时，旧 handle 的 dispose 不误伤新绑定；
//! - 上行 epoch 0 = 握手前 `pane:ready`，放行（是否消费由 TS 端按绑定过滤）。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::window::MAIN_WINDOW_LABEL;

/// Rust → 宿主主窗口的上行事件名（与 panes-kit `TAURI_PANE_RELAY_HOST_EVENT` 一致）。
pub const HOST_EVENT: &str = "pane-relay-host";
/// Rust → pane webview 的下行事件名（与 panes-kit `TAURI_PANE_RELAY_GUEST_EVENT` 一致）。
pub const GUEST_EVENT: &str = "pane-relay-guest";

/// 原生 IPC 信封：只包路由标识，`message` 原样透传（Req 9.3）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayEnvelope {
    pub instance_id: String,
    pub epoch: u64,
    pub message: serde_json::Value,
}

/// 稳定错误码（跨 IPC 以字符串呈现，TS 端可依码分支）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayError {
    NotHost,
    Unbound,
    StaleEpoch,
    LabelMismatch,
}

impl std::fmt::Display for RelayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            RelayError::NotHost => "PANE_RELAY_NOT_HOST",
            RelayError::Unbound => "PANE_RELAY_UNBOUND",
            RelayError::StaleEpoch => "PANE_RELAY_STALE_EPOCH",
            RelayError::LabelMismatch => "PANE_RELAY_LABEL_MISMATCH",
        })
    }
}

#[derive(Debug)]
struct Binding {
    epoch: u64,
    label: String,
}

/// 纯逻辑绑定表（不依赖 tauri 运行时，可单测）。
#[derive(Debug, Default)]
pub struct PaneRelayRegistry {
    bindings: HashMap<String, Binding>,
}

impl PaneRelayRegistry {
    /// 绑定（或以不低于既有 epoch 重绑）。
    pub fn bind(&mut self, instance_id: &str, epoch: u64, label: &str) -> Result<(), RelayError> {
        if let Some(existing) = self.bindings.get(instance_id) {
            if epoch < existing.epoch {
                return Err(RelayError::StaleEpoch);
            }
        }
        self.bindings.insert(
            instance_id.to_owned(),
            Binding {
                epoch,
                label: label.to_owned(),
            },
        );
        Ok(())
    }

    /// 仅当 epoch 匹配才解绑。
    pub fn unbind(&mut self, instance_id: &str, epoch: u64) {
        if self.bindings.get(instance_id).map(|b| b.epoch) == Some(epoch) {
            self.bindings.remove(instance_id);
        }
    }

    /// 宿主 → Guest：校验绑定与 epoch，返回目标 webview 标签。
    pub fn guest_target(&self, envelope: &RelayEnvelope) -> Result<&str, RelayError> {
        let binding = self
            .bindings
            .get(&envelope.instance_id)
            .ok_or(RelayError::Unbound)?;
        if binding.epoch != envelope.epoch {
            return Err(RelayError::StaleEpoch);
        }
        Ok(&binding.label)
    }

    /// Guest → 宿主：调用方标签必须等于绑定标签；epoch 0（`pane:ready`）放行。
    pub fn accept_from_guest(
        &self,
        envelope: &RelayEnvelope,
        caller_label: &str,
    ) -> Result<(), RelayError> {
        let binding = self
            .bindings
            .get(&envelope.instance_id)
            .ok_or(RelayError::Unbound)?;
        if binding.label != caller_label {
            return Err(RelayError::LabelMismatch);
        }
        if envelope.epoch != 0 && envelope.epoch != binding.epoch {
            return Err(RelayError::StaleEpoch);
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct PaneRelayState(pub Mutex<PaneRelayRegistry>);

fn require_host(label: &str) -> Result<(), String> {
    if label == MAIN_WINDOW_LABEL {
        Ok(())
    } else {
        Err(RelayError::NotHost.to_string())
    }
}

fn lock<'a>(
    state: &'a tauri::State<'_, PaneRelayState>,
) -> Result<std::sync::MutexGuard<'a, PaneRelayRegistry>, String> {
    state.0.lock().map_err(|_| "PANE_RELAY_POISONED".to_string())
}

#[tauri::command]
pub fn pane_relay_bind(
    window: tauri::Window,
    state: tauri::State<'_, PaneRelayState>,
    instance_id: String,
    epoch: u64,
    label: String,
) -> Result<(), String> {
    require_host(window.label())?;
    lock(&state)?
        .bind(&instance_id, epoch, &label)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pane_relay_unbind(
    window: tauri::Window,
    state: tauri::State<'_, PaneRelayState>,
    instance_id: String,
    epoch: u64,
) -> Result<(), String> {
    require_host(window.label())?;
    lock(&state)?.unbind(&instance_id, epoch);
    Ok(())
}

#[tauri::command]
pub fn pane_relay_to_guest(
    window: tauri::Window,
    app: AppHandle,
    state: tauri::State<'_, PaneRelayState>,
    envelope: RelayEnvelope,
) -> Result<(), String> {
    require_host(window.label())?;
    let label = lock(&state)?
        .guest_target(&envelope)
        .map(str::to_owned)
        .map_err(|e| e.to_string())?;
    app.emit_to(label.as_str(), GUEST_EVENT, &envelope)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pane_relay_to_host(
    webview: tauri::Webview,
    app: AppHandle,
    state: tauri::State<'_, PaneRelayState>,
    envelope: RelayEnvelope,
) -> Result<(), String> {
    lock(&state)?
        .accept_from_guest(&envelope, webview.label())
        .map_err(|e| e.to_string())?;
    app.emit_to(MAIN_WINDOW_LABEL, HOST_EVENT, &envelope)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(instance_id: &str, epoch: u64) -> RelayEnvelope {
        RelayEnvelope {
            instance_id: instance_id.into(),
            epoch,
            message: serde_json::json!({ "type": "pane:lifecycle", "state": "visible" }),
        }
    }

    #[test]
    fn bind_is_epoch_monotonic_and_rebind_replaces_label() {
        let mut reg = PaneRelayRegistry::default();
        reg.bind("editor-1", 1, "pane-editor-1").unwrap();
        // 旧 handle 迟到的低 epoch 绑定被拒。
        assert_eq!(reg.bind("editor-1", 0, "pane-x"), Err(RelayError::StaleEpoch));
        // reload：更高 epoch 重绑生效。
        reg.bind("editor-1", 2, "pane-editor-1").unwrap();
        assert_eq!(reg.guest_target(&envelope("editor-1", 2)).unwrap(), "pane-editor-1");
        assert_eq!(reg.guest_target(&envelope("editor-1", 1)), Err(RelayError::StaleEpoch));
    }

    #[test]
    fn unbind_requires_matching_epoch() {
        let mut reg = PaneRelayRegistry::default();
        reg.bind("editor-1", 2, "pane-editor-1").unwrap();
        // 旧 handle（epoch 1）的 dispose 不得误伤新绑定。
        reg.unbind("editor-1", 1);
        assert!(reg.guest_target(&envelope("editor-1", 2)).is_ok());
        reg.unbind("editor-1", 2);
        assert_eq!(reg.guest_target(&envelope("editor-1", 2)), Err(RelayError::Unbound));
    }

    #[test]
    fn guest_uplink_enforces_label_and_epoch() {
        let mut reg = PaneRelayRegistry::default();
        reg.bind("editor-1", 3, "pane-editor-1").unwrap();
        assert!(reg.accept_from_guest(&envelope("editor-1", 3), "pane-editor-1").is_ok());
        // 握手前 pane:ready（epoch 0）放行。
        assert!(reg.accept_from_guest(&envelope("editor-1", 0), "pane-editor-1").is_ok());
        // 他人 webview 冒名被拒；旧 epoch 被拒；未绑定被拒。
        assert_eq!(
            reg.accept_from_guest(&envelope("editor-1", 3), "pane-other"),
            Err(RelayError::LabelMismatch)
        );
        assert_eq!(
            reg.accept_from_guest(&envelope("editor-1", 2), "pane-editor-1"),
            Err(RelayError::StaleEpoch)
        );
        assert_eq!(
            reg.accept_from_guest(&envelope("ghost", 1), "pane-ghost"),
            Err(RelayError::Unbound)
        );
    }

    #[test]
    fn envelope_roundtrips_message_verbatim_in_camel_case() {
        // Req 9.3：中继不解析、不改写。序列化字段名与 TS 信封（camelCase）逐字一致。
        let src = serde_json::json!({
            "instanceId": "editor-1",
            "epoch": 2,
            "message": { "type": "pane:result", "requestId": "editor-1:9", "ok": true, "data": { "深": [1, 2, 3] } }
        });
        let parsed: RelayEnvelope = serde_json::from_value(src.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), src);
    }

    /// 静态声明一致性（仿 `credential_acl_identifiers_are_declared_and_capability_wired`）：
    /// 真正的运行期 ACL 需要真实 webview，`cargo test` 进程内无宿主环境；此处锁定
    /// permission 声明与两份 capability 的挂载不漂移。
    #[test]
    fn pane_relay_acl_identifiers_are_declared_and_capabilities_wired() {
        let toml_src = include_str!("../permissions/pane-relay.toml");
        for identifier in ["allow-pane-relay-host", "allow-pane-relay-guest"] {
            assert!(
                toml_src.contains(&format!("identifier = \"{identifier}\"")),
                "permissions/pane-relay.toml 应声明 {identifier}"
            );
        }
        for cmd in [
            "pane_relay_bind",
            "pane_relay_unbind",
            "pane_relay_to_guest",
            "pane_relay_to_host",
        ] {
            assert!(
                toml_src.contains(cmd),
                "permissions/pane-relay.toml 应在某条 permission 的 commands.allow 中列出 {cmd}"
            );
        }

        let perms_of = |src: &str| -> Vec<String> {
            let cap: serde_json::Value = serde_json::from_str(src).expect("capability 应是合法 JSON");
            cap["permissions"]
                .as_array()
                .expect("capability 应含 permissions 数组")
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        };
        // 宿主主窗口:host 侧命令。
        let default_perms = perms_of(include_str!("../capabilities/default.json"));
        assert!(default_perms.contains(&"allow-pane-relay-host".to_string()));
        assert!(!default_perms.contains(&"allow-pane-relay-guest".to_string()));
        // pane webview:仅上行 + 事件监听,不得拿到 host 侧命令。
        let panes_cap: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/panes.json")).unwrap();
        assert_eq!(panes_cap["windows"], serde_json::json!(["pane-*"]));
        let panes_perms = perms_of(include_str!("../capabilities/panes.json"));
        assert!(panes_perms.contains(&"allow-pane-relay-guest".to_string()));
        assert!(panes_perms.contains(&"core:event:allow-listen".to_string()));
        assert!(!panes_perms.contains(&"allow-pane-relay-host".to_string()));
    }
}
