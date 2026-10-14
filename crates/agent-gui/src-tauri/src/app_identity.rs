//! 应用身份常量。
//!
//! 显示名的唯一真源是 `tauri.conf.json` 的 `productName`：`build.rs` 读取它并注入
//! `LIVEAGENT_DISPLAY_NAME`，所以改名只需动配置一处。同一份代码要能打出并存的两个包
//! （如 `LiveAgent` 与 `LiveAgent N`），因此**任何用户可见的位置都从这里取名字，
//! 不要再硬编码字面量**。
//!
//! 必须保持 `const` 的字符串（无法用 `format!` 的位置）改用
//! `concat!(..., env!("LIVEAGENT_DISPLAY_NAME"), ...)`，它读的是同一个注入值。

/// 用户可见的应用显示名：托盘悬停提示、窗口标题、系统通知、错误提示等。
pub const APP_DISPLAY_NAME: &str = env!("LIVEAGENT_DISPLAY_NAME");
