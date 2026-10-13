//! 系统代理单一真源：设置保存/启动初始化时写入，shell env 注入与
//! 各 reqwest 出网点（本地反代、图片反代、更新检查、技能下载、
//! MCP http/sse transport、Hook / Cron HTTP、网络自检、Image.url 读取）按需读取。
//! reqwest 侧与 shell env 共用 NO_PROXY_DEFAULT：环回地址永不走代理。
//! 凭据绝不进入日志与错误信息（只输出 host:port）。
//! 例外：GitHub 更新链路在应用代理未启用时不做 no_proxy() 收口，而是回退
//! reqwest 默认代理探测（OS 代理环境变量/系统代理设置），见
//! `client_builder_with_os_proxy_fallback()`。

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::Value;
use std::net::Ipv6Addr;
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

const SYSTEM_PROXY_TYPE_HTTP: &str = "http";
pub const SYSTEM_PROXY_TYPE_SOCKS5: &str = "socks5";
const SYSTEM_PROXY_MODE_SYSTEM: &str = "system";
const NO_PROXY_DEFAULT: &str = "localhost,127.0.0.1,::1";
/// OS 代理读取的缓存时长：系统设置面板可能随时改动，但 shell 每执行一条命令
/// 都会问一次代理，不能每次都读注册表/起 gsettings 进程。
const OS_PROXY_CACHE_TTL: Duration = Duration::from_secs(30);
const TRANSPORT_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const TRANSPORT_TCP_KEEPALIVE: Duration = Duration::from_secs(30);
const TRANSPORT_TCP_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
const TRANSPORT_TCP_KEEPALIVE_RETRIES: u32 = 3;
const TRANSPORT_READ_TIMEOUT: Duration = Duration::from_secs(1800);

#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SystemProxyConfig {
    pub enabled: bool,
    /// `"manual"`（默认，缺省即此值）或 `"system"`（跟随 OS 代理设置）。
    pub mode: String,
    #[serde(rename = "type")]
    pub proxy_type: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

impl SystemProxyConfig {
    fn scheme(&self) -> &'static str {
        if self.proxy_type == SYSTEM_PROXY_TYPE_SOCKS5 {
            "socks5h"
        } else {
            "http"
        }
    }

    fn proxy_url(&self) -> String {
        let credentials = if self.username.is_empty() && self.password.is_empty() {
            String::new()
        } else {
            format!(
                "{}:{}@",
                utf8_percent_encode(&self.username, NON_ALPHANUMERIC),
                utf8_percent_encode(&self.password, NON_ALPHANUMERIC)
            )
        };
        format!(
            "{}://{}{}:{}",
            self.scheme(),
            credentials,
            self.url_host(),
            self.port
        )
    }

    fn display_target(&self) -> String {
        format!("{}:{}", self.url_host(), self.port)
    }

    fn url_host(&self) -> String {
        let host = self.host.trim();
        if host.starts_with('[') && host.ends_with(']') {
            return host.to_string();
        }
        if host.parse::<Ipv6Addr>().is_ok() {
            return format!("[{host}]");
        }
        host.to_string()
    }
}

fn host_is_valid(host: &str) -> bool {
    let host = host.trim();
    if host.is_empty()
        || host
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '/' | '\\' | '@' | '#' | '?' | '%'))
    {
        return false;
    }
    if host.starts_with('[') || host.ends_with(']') {
        return host
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
            .is_some_and(|value| value.parse::<Ipv6Addr>().is_ok());
    }
    !host.contains(':') || host.parse::<Ipv6Addr>().is_ok()
}

/// 从 OS 设置读到的代理（三平台统一形态）。
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsProxy {
    /// 代理 URL；`None` = 直连（无系统代理，或检测到 PAC 后按直连处理）。
    pub url: Option<String>,
    /// 生效的例外列表（OS 列表 ∪ 环回默认值，逗号分隔）；仅 `url` 存在时有意义。
    pub no_proxy: Option<String>,
    /// 检测到的自动配置脚本（PAC）地址：存在时 `url` 为 `None`（不解析脚本，按直连处理）。
    pub pac_url: Option<String>,
    /// 来源标记，仅用于诊断与 UI 提示（`windows-registry` / `linux-gsettings` /
    /// `environment` / `none`）。
    pub source: String,
}

impl OsProxy {
    fn none(source: &str) -> Self {
        Self {
            source: source.to_string(),
            ..Self::default()
        }
    }
}

/// 各平台读取层产出的原始片段；选择与归一化逻辑集中在 `resolve_os_proxy`（纯函数）。
#[derive(Clone, Debug, Default)]
struct OsProxyParts {
    enabled: bool,
    http: Option<String>,
    https: Option<String>,
    socks: Option<String>,
    no_proxy: Option<String>,
    pac_url: Option<String>,
    source: &'static str,
}

#[derive(Clone, Debug, Default, PartialEq)]
struct OsProxyEndpoints {
    http: Option<String>,
    https: Option<String>,
    socks: Option<String>,
}

/// 把 `host:port` 归一化为带协议的代理地址；已带 `://` 的原样返回。
fn proxy_url_from_endpoint(scheme: &str, endpoint: &str) -> Option<String> {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        return None;
    }
    if endpoint.contains("://") {
        return Some(endpoint.to_string());
    }
    if !endpoint.contains(':') {
        return None;
    }
    Some(format!("{scheme}://{endpoint}"))
}

/// Windows `ProxyServer`：`host:port`（全协议共用）或 `http=h:p;https=h:p;socks=h:p`。
fn parse_windows_proxy_server(raw: &str) -> OsProxyEndpoints {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return OsProxyEndpoints::default();
    }
    if !trimmed.contains('=') {
        return OsProxyEndpoints {
            http: Some(trimmed.to_string()),
            https: Some(trimmed.to_string()),
            socks: None,
        };
    }
    let mut endpoints = OsProxyEndpoints::default();
    for entry in trimmed.split(';') {
        let Some((key, value)) = entry.split_once('=') else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match key.trim().to_ascii_lowercase().as_str() {
            "http" => endpoints.http = Some(value.to_string()),
            "https" => endpoints.https = Some(value.to_string()),
            "socks" | "socks5" => endpoints.socks = Some(value.to_string()),
            _ => {}
        }
    }
    endpoints
}

/// Windows `ProxyOverride`：`*.local;<local>;10.*` → `*.local,10.*`。
/// `<local>` 是 IE 的"本地地址直连"标记，环回已由 `NO_PROXY_DEFAULT` 覆盖，丢弃。
fn parse_windows_no_proxy(raw: &str) -> Option<String> {
    let items: Vec<&str> = raw
        .split(';')
        .map(str::trim)
        .filter(|item| !item.is_empty() && !item.eq_ignore_ascii_case("<local>"))
        .collect();
    if items.is_empty() {
        None
    } else {
        Some(items.join(","))
    }
}

/// gsettings 的列表值：`['localhost', '127.0.0.0/8']` → `localhost,127.0.0.0/8`。
/// 只有 Linux 读取层与单测需要它（Windows 构建里不存在，避免死代码告警）。
#[cfg(any(target_os = "linux", test))]
fn parse_gsettings_list(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let inner = trimmed
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(trimmed);
    let items: Vec<&str> = inner
        .split(',')
        .map(|item| item.trim().trim_matches(|c| c == '\'' || c == '"'))
        .filter(|item| !item.is_empty())
        .collect();
    if items.is_empty() {
        None
    } else {
        Some(items.join(","))
    }
}

/// OS 例外列表 ∪ `NO_PROXY_DEFAULT`（去重、OS 在前、保序）。
fn merge_no_proxy(os_no_proxy: Option<&str>) -> String {
    let mut entries: Vec<String> = Vec::new();
    let mut push = |item: &str| {
        let item = item.trim();
        if item.is_empty() || entries.iter().any(|existing| existing.eq_ignore_ascii_case(item)) {
            return;
        }
        entries.push(item.to_string());
    };
    if let Some(raw) = os_no_proxy {
        for item in raw.split(',') {
            push(item);
        }
    }
    for item in NO_PROXY_DEFAULT.split(',') {
        push(item);
    }
    entries.join(",")
}

/// 平台片段的统一裁决：PAC 优先（按直连处理并把提示交给 UI），其次 https → http → socks。
fn resolve_os_proxy(parts: OsProxyParts) -> OsProxy {
    let pac_url = parts
        .pac_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if pac_url.is_some() {
        return OsProxy {
            url: None,
            no_proxy: None,
            pac_url,
            source: parts.source.to_string(),
        };
    }
    if !parts.enabled {
        return OsProxy::none(parts.source);
    }
    let url = parts
        .https
        .as_deref()
        .or(parts.http.as_deref())
        .and_then(|endpoint| proxy_url_from_endpoint("http", endpoint))
        .or_else(|| {
            parts
                .socks
                .as_deref()
                .and_then(|endpoint| proxy_url_from_endpoint("socks5h", endpoint))
        });
    if url.is_none() {
        return OsProxy::none(parts.source);
    }
    OsProxy {
        url,
        no_proxy: Some(merge_no_proxy(parts.no_proxy.as_deref())),
        pac_url: None,
        source: parts.source.to_string(),
    }
}

/// 进程环境变量形态：macOS 的主要途径，也是 Linux 上 gsettings 不可用时的回落。
/// `http_proxy`/`https_proxy` 惯常已带协议，裸 `host:port` 按 http 补齐。
/// Windows 两个分支都不用它（有自己的注册表读取），故在 Windows 构建里允许未使用。
#[cfg_attr(windows, allow(dead_code))]
fn read_environment_proxy_parts() -> OsProxyParts {
    let lookup = |names: [&str; 2]| -> Option<String> {
        names
            .iter()
            .find_map(|name| std::env::var(name).ok().filter(|value| !value.trim().is_empty()))
    };
    let http = lookup(["http_proxy", "HTTP_PROXY"]);
    let https = lookup(["https_proxy", "HTTPS_PROXY"]);
    // all_proxy 常被用于 socks5；已带协议的值原样保留。
    let all = lookup(["all_proxy", "ALL_PROXY"]);
    let enabled = http.is_some() || https.is_some() || all.is_some();
    OsProxyParts {
        enabled,
        http,
        https,
        socks: all,
        no_proxy: lookup(["no_proxy", "NO_PROXY"]),
        pac_url: None,
        source: "environment",
    }
}

#[cfg(windows)]
fn read_os_proxy_parts() -> OsProxyParts {
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, KEY_READ, RegCloseKey, RegOpenKeyExW, RegQueryValueExW,
    };
    const INTERNET_SETTINGS_SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn read_string(key: HKEY, name: &str) -> Option<String> {
        let name = wide(name);
        let mut kind = 0u32;
        let mut size = 0u32;
        // 先探长度（lpData 传空），再按所需字节数分配。
        let probe = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null_mut(),
                &mut kind,
                std::ptr::null_mut(),
                &mut size,
            )
        };
        if probe != 0 || size < 2 {
            return None;
        }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null_mut(),
                &mut kind,
                buffer.as_mut_ptr().cast::<u8>(),
                &mut size,
            )
        };
        if status != 0 {
            return None;
        }
        let length = buffer
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..length]))
    }

    fn read_dword(key: HKEY, name: &str) -> Option<u32> {
        let name = wide(name);
        let mut kind = 0u32;
        let mut size = 4u32;
        let mut value = 0u32;
        let status = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null_mut(),
                &mut kind,
                std::ptr::addr_of_mut!(value).cast::<u8>(),
                &mut size,
            )
        };
        if status != 0 { None } else { Some(value) }
    }

    let subkey = wide(INTERNET_SETTINGS_SUBKEY);
    let mut key: HKEY = std::ptr::null_mut();
    let opened = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut key) };
    if opened != 0 {
        return OsProxyParts {
            source: "windows-registry",
            ..Default::default()
        };
    }
    let enabled = read_dword(key, "ProxyEnable").unwrap_or(0) != 0;
    let server = read_string(key, "ProxyServer").unwrap_or_default();
    let override_list = read_string(key, "ProxyOverride").unwrap_or_default();
    let auto_config_url = read_string(key, "AutoConfigURL").unwrap_or_default();
    unsafe { RegCloseKey(key) };
    let endpoints = parse_windows_proxy_server(&server);
    OsProxyParts {
        enabled,
        http: endpoints.http,
        https: endpoints.https,
        socks: endpoints.socks,
        no_proxy: parse_windows_no_proxy(&override_list),
        pac_url: Some(auto_config_url).filter(|value| !value.trim().is_empty()),
        source: "windows-registry",
    }
}

#[cfg(target_os = "linux")]
fn gsettings_get(schema: &str, key: &str) -> Option<String> {
    let output = std::process::Command::new("gsettings")
        .args(["get", schema, key])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let unquoted = raw.trim_matches(|c| c == '\'' || c == '"').trim();
    if unquoted.is_empty() {
        None
    } else {
        Some(unquoted.to_string())
    }
}

#[cfg(target_os = "linux")]
fn read_os_proxy_parts() -> OsProxyParts {
    let mode = gsettings_get("org.gnome.system.proxy", "mode");
    let Some(mode) = mode else {
        return read_environment_proxy_parts();
    };
    let mut parts = OsProxyParts {
        source: "linux-gsettings",
        ..Default::default()
    };
    match mode.as_str() {
        "none" => parts,
        "auto" => {
            parts.pac_url = gsettings_get("org.gnome.system.proxy", "autoconfig-url");
            parts
        }
        "manual" => {
            let endpoint = |schema: &str| -> Option<String> {
                let host = gsettings_get(schema, "host").unwrap_or_default();
                let port = gsettings_get(schema, "port").unwrap_or_default();
                if host.trim().is_empty() || port.trim().is_empty() || port.trim() == "0" {
                    return None;
                }
                Some(format!("{host}:{port}"))
            };
            parts.enabled = true;
            parts.http = endpoint("org.gnome.system.proxy.http");
            parts.https = endpoint("org.gnome.system.proxy.https");
            parts.socks = endpoint("org.gnome.system.proxy.socks");
            parts.no_proxy = gsettings_get("org.gnome.system.proxy", "ignore-hosts")
                .and_then(|raw| parse_gsettings_list(&raw));
            parts
        }
        _ => read_environment_proxy_parts(),
    }
}

/// macOS 只读进程环境变量：GUI 进程拿不到 SCDynamicStore 里的系统代理，且本仓库
/// 没有 macOS 编译验证环境，因此不写 CoreFoundation 读取（有意为之，见 spec ①-3）。
#[cfg(not(any(windows, target_os = "linux")))]
fn read_os_proxy_parts() -> OsProxyParts {
    read_environment_proxy_parts()
}

fn os_proxy_snapshot() -> OsProxy {
    {
        let cached = state()
            .os_proxy
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some((stored_at, proxy)) = cached.as_ref() {
            if stored_at.elapsed() < OS_PROXY_CACHE_TTL {
                return proxy.clone();
            }
        }
    }
    let proxy = resolve_os_proxy(read_os_proxy_parts());
    *state()
        .os_proxy
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some((std::time::Instant::now(), proxy.clone()));
    proxy
}

/// 跟随系统代理的当前读数（设置页提示 + 诊断用）。走同一份 30s 缓存。
pub fn os_proxy_status() -> OsProxy {
    os_proxy_snapshot()
}

#[derive(Clone, Debug, PartialEq)]
enum ProxyMode {
    Disabled,
    /// 跟随 OS 代理设置（reqwest 走默认探测、shell env 由 OS 读数注入）。
    System,
    Enabled(SystemProxyConfig),
    Invalid(String),
}

#[derive(Clone, Debug)]
struct ProxySnapshot {
    revision: u64,
    mode: ProxyMode,
}

#[derive(Clone)]
struct CachedAsyncClient {
    revision: u64,
    client: reqwest::Client,
}

struct SystemProxyState {
    snapshot: RwLock<ProxySnapshot>,
    async_client: RwLock<Option<CachedAsyncClient>>,
    /// 跟随系统代理时的 OS 读数缓存（30s）。
    os_proxy: RwLock<Option<(std::time::Instant, OsProxy)>>,
}

fn state() -> &'static SystemProxyState {
    static STATE: OnceLock<SystemProxyState> = OnceLock::new();
    STATE.get_or_init(|| SystemProxyState {
        snapshot: RwLock::new(ProxySnapshot {
            revision: 0,
            mode: ProxyMode::Disabled,
        }),
        async_client: RwLock::new(None),
        os_proxy: RwLock::new(None),
    })
}

fn parse_proxy_mode(raw: Option<&Value>) -> ProxyMode {
    let Some(raw) = raw else {
        return ProxyMode::Disabled;
    };
    let mut config = match serde_json::from_value::<SystemProxyConfig>(raw.clone()) {
        Ok(config) => config,
        Err(_) => return ProxyMode::Invalid("应用代理配置格式无效".to_string()),
    };
    if !config.enabled {
        return ProxyMode::Disabled;
    }
    if config.mode.trim().eq_ignore_ascii_case(SYSTEM_PROXY_MODE_SYSTEM) {
        // 跟随系统：手动字段整组不参与校验（也不产 proxy_url）。
        return ProxyMode::System;
    }
    config.host = config.host.trim().to_string();
    config.username = config.username.trim().to_string();
    if !matches!(
        config.proxy_type.as_str(),
        SYSTEM_PROXY_TYPE_HTTP | SYSTEM_PROXY_TYPE_SOCKS5
    ) || config.port == 0
        || !host_is_valid(&config.host)
    {
        return ProxyMode::Invalid("应用代理已启用，但地址、端口或类型无效".to_string());
    }
    match build_proxy(&config) {
        Ok(_) => ProxyMode::Enabled(config),
        Err(error) => ProxyMode::Invalid(error),
    }
}

pub fn set_config(raw: Option<&Value>) {
    let mode = parse_proxy_mode(raw);
    let mut snapshot = state()
        .snapshot
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    // 设置保存每次都会刷新代理状态；只有配置真实变化才 bump revision，
    // 否则按 revision 重建的消费方（client 缓存、MCP 运行时）会被无关保存误伤。
    if snapshot.mode == mode {
        return;
    }
    snapshot.revision = snapshot.revision.wrapping_add(1);
    snapshot.mode = mode;
    drop(snapshot);
    *state()
        .async_client
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    // 切到"跟随系统"时立刻丢掉旧读数：用户刚在系统设置里改过代理的话，
    // 这一次保存就应当反映出来，而不是等 30s 缓存过期。
    *state()
        .os_proxy
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
}

/// 当前代理配置的变更计数。长驻连接（如 MCP client）在建立时记录，
/// 复用前与当前值比较即可感知代理配置变更并重建。
/// 直接在读锁下拷贝 u64，不克隆整个快照（本函数在 MCP 命令路径上高频调用）。
pub fn revision() -> u64 {
    state()
        .snapshot
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .revision
}

fn current_snapshot() -> ProxySnapshot {
    state()
        .snapshot
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
}

fn shell_proxy_envs_for_mode(mode: &ProxyMode) -> Result<Vec<(String, String)>, String> {
    // System：把 OS 读数翻译成同一组变量；系统没配代理（或检测到 PAC）时
    // 不注入任何变量 = 子进程直连（也保留它自己继承来的环境）。
    if let ProxyMode::System = mode {
        let os = os_proxy_snapshot();
        let Some(proxy_url) = os.url else {
            return Ok(Vec::new());
        };
        return Ok(proxy_envs_for_url(
            &proxy_url,
            os.no_proxy.as_deref().unwrap_or(NO_PROXY_DEFAULT),
        ));
    }
    let config = match mode {
        ProxyMode::Disabled => return Ok(Vec::new()),
        ProxyMode::Invalid(error) => return Err(error.clone()),
        ProxyMode::Enabled(config) => config,
        ProxyMode::System => unreachable!("handled above"),
    };
    Ok(proxy_envs_for_url(&config.proxy_url(), NO_PROXY_DEFAULT))
}

fn proxy_envs_for_url(proxy_url: &str, no_proxy: &str) -> Vec<(String, String)> {
    let mut envs = Vec::with_capacity(8);
    for key in [
        "HTTP_PROXY",
        "http_proxy",
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        envs.push((key.to_string(), proxy_url.to_string()));
    }
    for key in ["NO_PROXY", "no_proxy"] {
        envs.push((key.to_string(), no_proxy.to_string()));
    }
    envs
}

pub fn shell_proxy_envs() -> Result<Vec<(String, String)>, String> {
    shell_proxy_envs_for_mode(&current_snapshot().mode)
}

fn build_proxy(config: &SystemProxyConfig) -> Result<reqwest::Proxy, String> {
    reqwest::Proxy::all(config.proxy_url())
        // 环回地址豁免须与 shell env 注入的 NO_PROXY 一致，
        // 否则本地上游（如 127.0.0.1 的 MCP server）会被错误送进代理。
        .map(|proxy| proxy.no_proxy(reqwest::NoProxy::from_string(NO_PROXY_DEFAULT)))
        .map_err(|_| format!("应用代理地址无效：{}", config.display_target()))
}

/// async 出网 client 的传输层默认值：本地反代上游直连 client（`proxy.rs`）与
/// 本模块产出的全部 async builder（含承载 LLM 代理流量的 `cached_client()`）共用；
/// 调用方之后显式设置的同名选项（如 `connect_timeout`）会覆盖这里。
/// - TCP keepalive 约 60s 判定死对端（macOS/Linux；Windows 不支持设置重试次数，
///   固定 10 次探测，约 130s），但只探测第一跳：走应用代理时探测的是到本地回环
///   代理（Clash/V2Ray 等）的连接，代理到上游那段断了它感知不到。
/// - `read_timeout` 是单次读的空闲超时（读到数据即重置），作为死流兜底；
///   reqwest 0.13 在收到响应头之前也按它计时。必须长于 LLM 流任何合法的
///   静默阶段（首 token 前的长推理、上游排队、中转缓冲整段输出的 pro 档模型等），
///   否则会切断正常回复并让重试重付整段推理，所以取 30 分钟。
pub(crate) fn with_transport_defaults(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    builder
        .connect_timeout(TRANSPORT_CONNECT_TIMEOUT)
        .tcp_keepalive(TRANSPORT_TCP_KEEPALIVE)
        .tcp_keepalive_interval(TRANSPORT_TCP_KEEPALIVE_INTERVAL)
        .tcp_keepalive_retries(TRANSPORT_TCP_KEEPALIVE_RETRIES)
        .read_timeout(TRANSPORT_READ_TIMEOUT)
}

fn async_client_builder_for_mode(mode: &ProxyMode) -> Result<reqwest::ClientBuilder, String> {
    match mode {
        // 跟随系统：不调 no_proxy()，交给 reqwest 的 OS 代理探测
        // （system-proxy 默认特性：Windows 注册表 / macOS 系统设置 / 环境变量）。
        ProxyMode::System => Ok(with_transport_defaults(reqwest::Client::builder())),
        _ => {
            let builder = with_transport_defaults(reqwest::Client::builder().no_proxy());
            match mode {
                ProxyMode::Disabled => Ok(builder),
                ProxyMode::Invalid(error) => Err(error.clone()),
                ProxyMode::Enabled(config) => Ok(builder.proxy(build_proxy(config)?)),
                ProxyMode::System => unreachable!("handled above"),
            }
        }
    }
}

fn blocking_client_builder_for_mode(
    mode: &ProxyMode,
) -> Result<reqwest::blocking::ClientBuilder, String> {
    match mode {
        ProxyMode::System => Ok(reqwest::blocking::Client::builder()),
        _ => {
            let builder = reqwest::blocking::Client::builder().no_proxy();
            match mode {
                ProxyMode::Disabled => Ok(builder),
                ProxyMode::Invalid(error) => Err(error.clone()),
                ProxyMode::Enabled(config) => Ok(builder.proxy(build_proxy(config)?)),
                ProxyMode::System => unreachable!("handled above"),
            }
        }
    }
}

pub fn cached_client() -> Result<reqwest::Client, String> {
    let snapshot = current_snapshot();
    {
        let cached = state()
            .async_client
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(cached) = cached
            .as_ref()
            .filter(|client| client.revision == snapshot.revision)
        {
            return Ok(cached.client.clone());
        }
    }
    let client = async_client_builder_for_mode(&snapshot.mode)?
        .build()
        .map_err(|_| "创建应用代理 HTTP 客户端失败".to_string())?;
    let current_revision = current_snapshot().revision;
    if current_revision == snapshot.revision {
        *state()
            .async_client
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(CachedAsyncClient {
            revision: snapshot.revision,
            client: client.clone(),
        });
    }
    Ok(client)
}

fn os_proxy_fallback_builder_for_mode(mode: &ProxyMode) -> Result<reqwest::ClientBuilder, String> {
    match mode {
        // 不调 no_proxy()：保留 reqwest 默认代理探测（OS 代理环境变量与
        // macOS/Windows 系统代理设置，system-proxy 默认特性），无系统代理即直连。
        ProxyMode::Disabled => Ok(with_transport_defaults(reqwest::Client::builder())),
        mode => async_client_builder_for_mode(mode),
    }
}

/// GitHub 更新链路专用：应用代理启用时与其他出网点一致走应用代理（配置无效
/// 同样 fail fast）；未启用时回退 OS 系统代理探测而不是强制直连，尽可能保证
/// GitHub 更新地址可达。其余出网点仍用 `cached_client()`/
/// `blocking_client_builder()` 的显式 no_proxy 语义。
pub fn client_builder_with_os_proxy_fallback() -> Result<reqwest::ClientBuilder, String> {
    os_proxy_fallback_builder_for_mode(&current_snapshot().mode)
}

pub fn blocking_client_builder() -> Result<reqwest::blocking::ClientBuilder, String> {
    blocking_client_builder_for_mode(&current_snapshot().mode)
}

/// 供自建 TCP 隧道（如 SSH 传输）复用应用代理：`Ok(None)` 表示未启用（直连），
/// `Err` 表示已启用但配置无效（调用方 fail fast），`Ok(Some)` 返回配置副本。
/// 跟随系统模式同样返回 `Ok(None)`：这条路径只认显式的 host:port 配置，
/// OS 代理由 reqwest 侧自行探测（见 `async_client_builder_for_mode`）。
pub fn current_config() -> Result<Option<SystemProxyConfig>, String> {
    match current_snapshot().mode {
        ProxyMode::Disabled | ProxyMode::System => Ok(None),
        ProxyMode::Invalid(error) => Err(error),
        ProxyMode::Enabled(config) => Ok(Some(config)),
    }
}

/// 异步版 `blocking_client_builder()`：显式 no_proxy 语义,供需要自定义
/// 超时/重定向等选项、无法直接复用 `cached_client()` 的出网点使用。
pub fn async_client_builder() -> Result<reqwest::ClientBuilder, String> {
    async_client_builder_for_mode(&current_snapshot().mode)
}

/// Resolved proxy URL for consumers that configure their own HTTP client rather
/// than using `cached_client()`/`blocking_client_builder()` (e.g.
/// `tauri-plugin-updater`, which only accepts a `Url` on its builder).
/// `Ok(None)` means the app proxy is
/// disabled — the GitHub update path deliberately leaves its client on reqwest's
/// default proxy detection then (OS proxy env vars / system proxy settings),
/// mirroring `client_builder_with_os_proxy_fallback()`.
pub fn current_proxy_url() -> Result<Option<reqwest::Url>, String> {
    match current_snapshot().mode {
        // 跟随系统：把"探测"留给消费方自己的 client（updater 只在拿到 URL 时
        // 才设代理，None 正好等于"不设、用默认探测"）。
        ProxyMode::Disabled | ProxyMode::System => Ok(None),
        ProxyMode::Invalid(error) => Err(error),
        ProxyMode::Enabled(config) => reqwest::Url::parse(&config.proxy_url())
            .map(Some)
            .map_err(|_| format!("应用代理地址无效：{}", config.display_target())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config(value: Value) -> SystemProxyConfig {
        match parse_proxy_mode(Some(&value)) {
            ProxyMode::Enabled(config) => config,
            mode => panic!("expected enabled proxy config, got {mode:?}"),
        }
    }

    #[test]
    fn proxy_url_http_without_credentials() {
        let parsed = config(json!({
            "enabled": true, "type": "http", "host": "proxy.local", "port": 8080,
            "username": "", "password": ""
        }));
        assert_eq!(parsed.proxy_url(), "http://proxy.local:8080");
    }

    #[test]
    fn proxy_url_socks5_uses_socks5h_and_percent_encodes_credentials() {
        let parsed = config(json!({
            "enabled": true, "type": "socks5", "host": "10.0.0.1", "port": 1080,
            "username": "user@corp", "password": "p@ss:w0rd"
        }));
        assert_eq!(
            parsed.proxy_url(),
            "socks5h://user%40corp:p%40ss%3Aw0rd@10.0.0.1:1080"
        );
    }

    #[test]
    fn proxy_url_brackets_ipv6_hosts() {
        let parsed = config(json!({
            "enabled": true, "type": "http", "host": "::1", "port": 8080
        }));
        assert_eq!(parsed.proxy_url(), "http://[::1]:8080");
    }

    #[test]
    fn manual_mode_is_the_default_and_system_mode_skips_manual_validation() {
        // 旧存档缺 mode → 走手动分支（零迁移）。
        let legacy = config(json!({
            "enabled": true, "type": "http", "host": "proxy.local", "port": 8080
        }));
        assert_eq!(legacy.mode, "");

        // 跟随系统：手动字段可以全是空的，也不产生 proxy_url。
        assert_eq!(
            parse_proxy_mode(Some(&json!({ "enabled": true, "mode": "system" }))),
            ProxyMode::System
        );
        // 关闭时 mode 不生效。
        assert_eq!(
            parse_proxy_mode(Some(&json!({ "enabled": false, "mode": "system" }))),
            ProxyMode::Disabled
        );
        // 未知 mode 回落手动分支（并因字段无效报错）。
        assert!(matches!(
            parse_proxy_mode(Some(&json!({ "enabled": true, "mode": "wat", "host": "", "port": 0 }))),
            ProxyMode::Invalid(_)
        ));
    }

    #[test]
    fn windows_proxy_server_parses_plain_and_per_protocol_forms() {
        assert_eq!(
            parse_windows_proxy_server("127.0.0.1:7890"),
            OsProxyEndpoints {
                http: Some("127.0.0.1:7890".to_string()),
                https: Some("127.0.0.1:7890".to_string()),
                socks: None,
            }
        );
        assert_eq!(
            parse_windows_proxy_server("http=10.0.0.1:8080;https=10.0.0.1:8443;socks=10.0.0.1:1080;ftp=1.2.3.4:21"),
            OsProxyEndpoints {
                http: Some("10.0.0.1:8080".to_string()),
                https: Some("10.0.0.1:8443".to_string()),
                socks: Some("10.0.0.1:1080".to_string()),
            }
        );
        assert_eq!(parse_windows_proxy_server("  "), OsProxyEndpoints::default());
    }

    #[test]
    fn windows_proxy_override_drops_the_local_marker() {
        assert_eq!(
            parse_windows_no_proxy("*.local;<local>;10.*;192.168.*"),
            Some("*.local,10.*,192.168.*".to_string())
        );
        assert_eq!(parse_windows_no_proxy("<local>"), None);
        assert_eq!(parse_windows_no_proxy(""), None);
    }

    #[test]
    fn gsettings_lists_and_endpoints_normalize() {
        assert_eq!(
            parse_gsettings_list("['localhost', '127.0.0.0/8', '::1']"),
            Some("localhost,127.0.0.0/8,::1".to_string())
        );
        assert_eq!(parse_gsettings_list("[]"), None);
        assert_eq!(
            proxy_url_from_endpoint("http", "127.0.0.1:7890"),
            Some("http://127.0.0.1:7890".to_string())
        );
        assert_eq!(
            proxy_url_from_endpoint("http", "http://127.0.0.1:7890"),
            Some("http://127.0.0.1:7890".to_string())
        );
        // 缺端口无法成 URL；空串也返回 None。
        assert_eq!(proxy_url_from_endpoint("http", "127.0.0.1"), None);
        assert_eq!(proxy_url_from_endpoint("http", "  "), None);
    }

    #[test]
    fn no_proxy_union_keeps_os_entries_first_and_dedupes() {
        assert_eq!(
            merge_no_proxy(Some("10.0.0.0/8,localhost")),
            "10.0.0.0/8,localhost,127.0.0.1,::1"
        );
        assert_eq!(merge_no_proxy(None), NO_PROXY_DEFAULT);
        // 大小写不敏感去重，避免 NO_PROXY 里出现两份 LocalHost。
        assert_eq!(merge_no_proxy(Some("LOCALHOST")), "LOCALHOST,127.0.0.1,::1");
    }

    #[test]
    fn os_proxy_resolution_prefers_https_then_socks_and_reports_pac() {
        // https 端点优先（同为 HTTP 代理语义，用 http:// 表达）。
        let resolved = resolve_os_proxy(OsProxyParts {
            enabled: true,
            http: Some("10.0.0.1:8080".to_string()),
            https: Some("10.0.0.1:8443".to_string()),
            socks: Some("10.0.0.1:1080".to_string()),
            no_proxy: Some("*.local".to_string()),
            pac_url: None,
            source: "windows-registry",
        });
        assert_eq!(resolved.url, Some("http://10.0.0.1:8443".to_string()));
        assert_eq!(resolved.no_proxy, Some("*.local,localhost,127.0.0.1,::1".to_string()));
        assert_eq!(resolved.pac_url, None);

        // 只有 socks → socks5h。
        let socks_only = resolve_os_proxy(OsProxyParts {
            enabled: true,
            socks: Some("127.0.0.1:1080".to_string()),
            source: "linux-gsettings",
            ..Default::default()
        });
        assert_eq!(socks_only.url, Some("socks5h://127.0.0.1:1080".to_string()));

        // PAC：不解析、按直连处理，只把提示带出去。
        let pac = resolve_os_proxy(OsProxyParts {
            enabled: true,
            http: Some("10.0.0.1:8080".to_string()),
            pac_url: Some("http://wpad/wpad.dat".to_string()),
            source: "windows-registry",
            ..Default::default()
        });
        assert_eq!(pac.url, None);
        assert_eq!(pac.no_proxy, None);
        assert_eq!(pac.pac_url, Some("http://wpad/wpad.dat".to_string()));

        // 未启用：不产 URL，也不产例外列表。
        let disabled = resolve_os_proxy(OsProxyParts {
            enabled: false,
            http: Some("10.0.0.1:8080".to_string()),
            no_proxy: Some("*.local".to_string()),
            source: "windows-registry",
            ..Default::default()
        });
        assert_eq!(disabled, OsProxy::none("windows-registry"));
    }

    #[test]
    fn system_mode_emits_envs_from_the_os_reading() {
        // 直接验证"OS 读数 → 环境变量"这一层的形状（不依赖本机是否真配了代理）。
        let envs = proxy_envs_for_url("http://127.0.0.1:7890", "10.0.0.0/8,localhost,127.0.0.1,::1");
        let lookup = |key: &str| {
            envs.iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value.as_str())
        };
        assert_eq!(lookup("HTTP_PROXY"), Some("http://127.0.0.1:7890"));
        assert_eq!(lookup("all_proxy"), Some("http://127.0.0.1:7890"));
        assert_eq!(lookup("NO_PROXY"), Some("10.0.0.0/8,localhost,127.0.0.1,::1"));
        assert_eq!(lookup("no_proxy"), Some("10.0.0.0/8,localhost,127.0.0.1,::1"));
    }

    #[test]
    fn invalid_enabled_configs_fail_instead_of_becoming_disabled() {
        assert!(matches!(
            parse_proxy_mode(Some(&json!({
                "enabled": false, "type": "http", "host": "proxy.local", "port": 8080
            }))),
            ProxyMode::Disabled
        ));
        for value in [
            json!({
            "enabled": true, "type": "http", "host": "", "port": 8080
            }),
            json!({
            "enabled": true, "type": "http", "host": "proxy.local", "port": 0
            }),
            json!({
            "enabled": true, "type": "http", "host": "bad host/@", "port": 8080
            }),
            json!({
                "enabled": true, "type": "https", "host": "proxy.local", "port": 8080
            }),
        ] {
            let mode = parse_proxy_mode(Some(&value));
            assert!(matches!(mode, ProxyMode::Invalid(_)));
            assert!(async_client_builder_for_mode(&mode).is_err());
            assert!(blocking_client_builder_for_mode(&mode).is_err());
            // 更新链路的回退 builder 同样不许把 Invalid 静默降级为直连/系统代理。
            assert!(os_proxy_fallback_builder_for_mode(&mode).is_err());
            assert!(shell_proxy_envs_for_mode(&mode).is_err());
        }
    }

    #[test]
    fn os_proxy_fallback_builder_accepts_disabled_and_enabled_modes() {
        assert!(os_proxy_fallback_builder_for_mode(&ProxyMode::Disabled).is_ok());
        let enabled = parse_proxy_mode(Some(&json!({
            "enabled": true, "type": "http", "host": "proxy.local", "port": 8080
        })));
        assert!(matches!(enabled, ProxyMode::Enabled(_)));
        assert!(os_proxy_fallback_builder_for_mode(&enabled).is_ok());
    }

    #[test]
    fn transport_defaults_build_for_every_usable_mode() {
        let modes = [
            ProxyMode::Disabled,
            parse_proxy_mode(Some(&json!({
                "enabled": true, "type": "http", "host": "proxy.local", "port": 8080
            }))),
            parse_proxy_mode(Some(&json!({
                "enabled": true, "type": "socks5", "host": "127.0.0.2", "port": 1080
            }))),
        ];
        for mode in &modes {
            assert!(matches!(mode, ProxyMode::Disabled | ProxyMode::Enabled(_)));
            // 传输层默认值不得让任何可用模式（含更新链路回退 builder）建 client 失败；
            // read_timeout 是 Debug 里唯一可观测的字段，借它确认默认值已挂上。
            for builder in [
                async_client_builder_for_mode(mode).expect("async builder"),
                os_proxy_fallback_builder_for_mode(mode).expect("fallback builder"),
            ] {
                let client = builder.build().expect("client with transport defaults");
                assert!(format!("{client:?}").contains("read_timeout"));
            }
        }
    }

    #[test]
    fn proxy_mode_equality_drives_set_config_dedupe() {
        let config = json!({
            "enabled": true, "type": "http", "host": "proxy.local", "port": 8080
        });
        // set_config 以 ProxyMode 相等与否决定是否 bump revision：
        // 同配置重复保存必须判等，任一字段变化必须判不等。
        assert_eq!(
            parse_proxy_mode(Some(&config)),
            parse_proxy_mode(Some(&config))
        );
        let changed_port = json!({
            "enabled": true, "type": "http", "host": "proxy.local", "port": 8081
        });
        assert_ne!(
            parse_proxy_mode(Some(&config)),
            parse_proxy_mode(Some(&changed_port))
        );
        assert_eq!(parse_proxy_mode(None), ProxyMode::Disabled);
    }

    #[test]
    fn shell_proxy_envs_cover_all_variables() {
        let mode = parse_proxy_mode(Some(&json!({
            "enabled": true, "type": "socks5", "host": "127.0.0.2", "port": 1080,
            "username": "", "password": ""
        })));
        let envs = shell_proxy_envs_for_mode(&mode).expect("proxy envs");
        let map: std::collections::HashMap<_, _> = envs.iter().cloned().collect();
        assert_eq!(envs.len(), 8);
        for key in [
            "HTTP_PROXY",
            "http_proxy",
            "HTTPS_PROXY",
            "https_proxy",
            "ALL_PROXY",
            "all_proxy",
        ] {
            assert_eq!(
                map.get(key).map(String::as_str),
                Some("socks5h://127.0.0.2:1080")
            );
        }
        for key in ["NO_PROXY", "no_proxy"] {
            assert_eq!(map.get(key).map(String::as_str), Some(NO_PROXY_DEFAULT));
        }
        assert!(shell_proxy_envs_for_mode(&ProxyMode::Disabled)
            .expect("disabled proxy envs")
            .is_empty());
    }

    #[test]
    fn current_proxy_url_reflects_mode() {
        set_config(None);
        assert_eq!(current_proxy_url().expect("disabled proxy url"), None);

        set_config(Some(&json!({
            "enabled": true, "type": "http", "host": "proxy.local", "port": 8080
        })));
        assert_eq!(
            current_proxy_url()
                .expect("enabled proxy url")
                .map(|url| url.to_string()),
            Some("http://proxy.local:8080/".to_string())
        );

        set_config(Some(&json!({
            "enabled": true, "type": "http", "host": "bad host/@", "port": 8080
        })));
        assert!(current_proxy_url().is_err());

        // reset so other tests in this module observe the default disabled state
        set_config(None);
    }
}
