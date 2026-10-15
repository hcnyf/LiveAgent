//! Redirection Guard 自愈（Windows）。
//!
//! Windows 11 会给「由更高权限进程拉起」的应用进程打上
//! `PROCESS_MITIGATION_REDIRECTION_TRUST_POLICY.EnforceRedirectionTrust`。该策略有
//! 三个致命性质（2026-10-15 本机实测确认）：
//!
//! 1. 开启它的进程**拒绝穿越任何 reparse point**，返回 NTFS 的
//!    `STATUS_UNTRUSTED_MOUNT_POINT`（"The path cannot be traversed because it
//!    contains an untrusted mount point."）。pnpm 的 `node_modules` 全是 junction，
//!    于是应用派生的每一个进程（Bash 工具 → powershell/node/git/pnpm）都读不到模块，
//!    agent 侧 JS 工具链整体失效（表现为 `Cannot find module '@babel/parser'` 之类）。
//! 2. **整棵子进程树继承**——所以问题不在某一个子进程，而在应用自己。
//! 3. **进程无法自行降级**：`SetProcessMitigationPolicy` 返回 ACCESS_DENIED，而
//!    Windows SDK 里也没有在 `CreateProcess` 时清除该位的接口
//!    （`PROC_THREAD_ATTRIBUTE_MITIGATION_POLICY` 没有对应的
//!    `PROCESS_CREATION_MITIGATION_POLICY*_REDIRECTION_*` 宏）。
//!
//! 因此唯一可行的修法是**换一个干净的创建者**：实测由 explorer.exe 创建的进程不带
//! 该位（穿越 junction 正常），而由提权进程拉起的带该位——触发点就是安装器
//! （NSIS 的 `nsis_tauri_utils::RunAsUser`）与被动更新的 MSI
//! （`Impersonate="yes"` + `AUTOLAUNCHAPP`）。
//!
//! 这里在**显示窗口之前**自检，发现带着该位就借 shell 重新拉起自己并退出：shell 创建
//! 出来的实例是干净的，而它不会再触发一次重启（收敛）。放在窗口创建之前做，用户看不到
//! 白屏或窗口跳动。

use std::time::{Duration, SystemTime};

/// `PROCESS_MITIGATION_REDIRECTION_TRUST_POLICY` 的 `EnforceRedirectionTrust` 位。
const ENFORCE_REDIRECTION_TRUST: u32 = 0x1;

/// 自愈重启的冷却窗口：距上次自愈不足这个时长就不再重启。
/// 作用是把「shell 也不干净」这类极端情况下的无限重启收敛成一次尝试。
const RELAUNCH_GUARD_WINDOW: Duration = Duration::from_secs(30);

/// 冷却窗口判定（纯函数，便于单测）。时钟回拨时按「不热」处理——宁可多试一次，
/// 也不要因为时间异常把自己锁死在受限状态。
fn relaunch_guard_is_hot(now: SystemTime, last_relaunch: SystemTime, window: Duration) -> bool {
    now.duration_since(last_relaunch)
        .map(|age| age < window)
        .unwrap_or(false)
}

/// 策略位解码（纯函数，便于单测）：只有 bit0 是 `EnforceRedirectionTrust`。
fn redirection_guard_enforced_from_flags(flags: u32) -> bool {
    flags & ENFORCE_REDIRECTION_TRUST != 0
}

/// 应用**显示窗口之前**调用：若本进程带着 Redirection Guard，就借 shell 重启一次并退出。
/// 非 Windows 平台为空操作。
pub fn ensure_clean_relaunch() {
    #[cfg(windows)]
    windows_impl::ensure_clean_relaunch();
}

#[cfg(windows)]
mod windows_impl {
    use super::{
        relaunch_guard_is_hot, redirection_guard_enforced_from_flags, RELAUNCH_GUARD_WINDOW,
    };
    use std::ffi::c_void;
    use std::path::PathBuf;
    use std::time::SystemTime;

    /// `PROCESS_MITIGATION_POLICY::ProcessRedirectionTrustPolicy`。
    const PROCESS_REDIRECTION_TRUST_POLICY: i32 = 16;
    /// 自愈冷却标记文件（落在 `%TEMP%`，随系统清理，不需要额外维护）。
    const RELAUNCH_GUARD_FILE: &str = "liveagent-redirection-guard-relaunch.stamp";

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn GetProcessMitigationPolicy(
            process: *mut c_void,
            policy: i32,
            buffer: *mut c_void,
            size: usize,
        ) -> i32;
    }

    /// 本进程是否开启了 Redirection Guard。查询失败一律当作「没开」——绝不因为探测
    /// 本身出错而拦住启动。
    fn enforced() -> bool {
        let mut flags: u32 = 0;
        let ok = unsafe {
            GetProcessMitigationPolicy(
                GetCurrentProcess(),
                PROCESS_REDIRECTION_TRUST_POLICY,
                &mut flags as *mut u32 as *mut c_void,
                std::mem::size_of::<u32>(),
            )
        };
        ok != 0 && redirection_guard_enforced_from_flags(flags)
    }

    fn guard_path() -> PathBuf {
        std::env::temp_dir().join(RELAUNCH_GUARD_FILE)
    }

    fn guard_is_hot() -> bool {
        let Ok(modified) = std::fs::metadata(guard_path()).and_then(|meta| meta.modified()) else {
            return false;
        };
        relaunch_guard_is_hot(SystemTime::now(), modified, RELAUNCH_GUARD_WINDOW)
    }

    fn mark_relaunched() {
        let _ = std::fs::write(guard_path(), b"");
    }

    /// 借 shell 创建新实例：`explorer.exe "<exe>"` 会把路径交给已经在跑的 shell，由
    /// shell 真正创建进程。把 explorer.exe 作为本进程的子进程拉起也不影响结果——
    /// 真正的创建者仍是 shell，所以新实例是干净的。
    fn relaunch_via_shell() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|error| error.to_string())?;
        let explorer = std::env::var_os("SystemRoot")
            .map(|root| PathBuf::from(root).join("explorer.exe"))
            .unwrap_or_else(|| PathBuf::from("explorer.exe"));
        std::process::Command::new(explorer)
            .arg(exe)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    fn diag(message: &str) {
        if std::env::var_os("LIVEAGENT_REDIRECTION_GUARD_LOG").is_some() {
            eprintln!("liveagent redirection guard: {message}");
        }
    }

    pub(super) fn ensure_clean_relaunch() {
        if !enforced() {
            return;
        }
        if guard_is_hot() {
            diag("本进程仍带 Redirection Guard，但刚刚已经自愈重启过，不再重试");
            return;
        }
        match relaunch_via_shell() {
            Ok(()) => {
                mark_relaunched();
                diag("本进程带 Redirection Guard（junction 不可穿越），已交由 shell 拉起干净实例");
                // 必须在窗口创建前退出：此时 Tauri 尚未初始化、单实例锁也未获取，
                // 新实例不会被转发到本进程后自己退出。
                std::process::exit(0);
            }
            Err(error) => diag(&format!("自愈重启失败，继续以受限状态启动：{error}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000)
    }

    #[test]
    fn guard_window_is_hot_only_inside_the_window() {
        let window = Duration::from_secs(30);
        assert!(relaunch_guard_is_hot(
            base() + Duration::from_secs(5),
            base(),
            window
        ));
        assert!(!relaunch_guard_is_hot(
            base() + Duration::from_secs(30),
            base(),
            window
        ));
        assert!(!relaunch_guard_is_hot(
            base() + Duration::from_secs(600),
            base(),
            window
        ));
    }

    #[test]
    fn clock_skew_is_treated_as_cold() {
        // 「上次重启」落在未来（时钟回拨）时不能把自己锁死在受限状态。
        assert!(!relaunch_guard_is_hot(
            base(),
            base() + Duration::from_secs(120),
            Duration::from_secs(30)
        ));
    }

    #[test]
    fn only_bit_zero_counts_as_enforced() {
        assert!(redirection_guard_enforced_from_flags(0x1));
        assert!(redirection_guard_enforced_from_flags(0x1 | 0x100));
        assert!(!redirection_guard_enforced_from_flags(0x0));
        assert!(!redirection_guard_enforced_from_flags(0x2));
    }
}
