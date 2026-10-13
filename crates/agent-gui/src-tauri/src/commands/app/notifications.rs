//! 会话类系统通知（会话完成 / 会话出错 / 权限请求）的发送面。
//!
//! 只做"发一条系统通知"与"查询/申请权限"两件事：**过滤逻辑在前端**
//! （`src/lib/system/notifications.ts`）——单项开关存在前端设置里，而"窗口是否有
//! 焦点"也必须问前端的窗口状态。
//!
//! 为什么不直接让前端 `invoke("plugin:notification|notify")`：JS 侧的插件包
//! （`@tauri-apps/plugin-notification`）本仓库并未安装，走自家命令可以保持参数
//! 形状与错误信息都在 Rust 侧受编译期约束，也避免为了一个调用再拉一个 npm 依赖。

use tauri_plugin_notification::{NotificationExt, PermissionState};

/// 当前通知权限：`granted` / `denied` / `prompt`。
#[tauri::command]
pub async fn notification_permission_state(app: tauri::AppHandle) -> Result<String, String> {
    permission_state_label(app.notification().permission_state())
}

/// 请求通知权限：首次发送前的显式申请；被拒后前端只展示原因，不反复弹。
#[tauri::command]
pub async fn request_notification_permission(app: tauri::AppHandle) -> Result<String, String> {
    permission_state_label(app.notification().request_permission())
}

/// 发一条系统通知。标题与正文由前端按当前语言本地化后传入。
#[tauri::command]
pub async fn send_system_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| format!("发送系统通知失败：{error}"))
}

fn permission_state_label(
    state: Result<PermissionState, tauri_plugin_notification::Error>,
) -> Result<String, String> {
    let state = state.map_err(|error| format!("查询通知权限失败：{error}"))?;
    let label = match state {
        PermissionState::Granted => "granted",
        PermissionState::Denied => "denied",
        // Prompt 以及将来新增的取值都按"还没定"处理。
        _ => "prompt",
    };
    Ok(label.to_string())
}
