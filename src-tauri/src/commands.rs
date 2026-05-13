use crate::claude::{fetch_claude_usage, UsageData};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, async_runtime};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

/// Last successfully fetched usage plus the Unix-ms timestamp of that fetch.
/// Shared between the background poller, fetch_usage, and get_cached_usage.
pub struct UsageCache(pub Mutex<Option<(UsageData, u64)>>);

/// Current Unix time in milliseconds.
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Serialize, Clone)]
pub struct CachedUsage {
    pub data: UsageData,
    pub fetched_at_ms: u64,
}

const KEYRING_SERVICE: &str = "claudeometer";
const KEYRING_ACCOUNT: &str = "session_key";

/// Read the session key from the OS keychain.
/// On first run after an upgrade, migrates a plain-text key from the store
/// into the keychain and removes it from the store file.
pub(crate) fn get_keyring_session_key(store: &tauri_plugin_store::Store<tauri::Wry>) -> Result<String, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keychain unavailable: {e}"))?;

    if let Ok(key) = entry.get_password() {
        return Ok(key);
    }

    // Migration path: key was previously stored in plain text.
    if let Some(key) = store
        .get("session_key")
        .and_then(|v| v.as_str().map(str::to_string))
    {
        let _ = entry.set_password(&key);
        store.delete("session_key");
        let _ = store.save();
        return Ok(key);
    }

    Err("No session key stored".to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthState {
    pub mode: String, // "none" | "session_key"
    pub email: Option<String>,
    pub name: Option<String>,
}

/// A single notification rule. Serde tag = "type" so the JSON looks like
/// {"type":"threshold","id":"abc","window":"five_hour","at_pct":80.0}
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NotificationRule {
    /// Fire when a window's utilization crosses above at_pct (rising edge).
    Threshold { id: String, window: String, at_pct: f64 },
    /// Fire when a window's utilization jumps by >= by_pct since the last poll.
    Spike { id: String, window: String, by_pct: f64 },
    /// Fire when a window will reset within within_mins minutes (falling-edge on the countdown).
    ResetSoon { id: String, window: String, within_mins: u32 },
    /// Fire when a window's utilization crosses below below_pct (falling edge).
    Recovery { id: String, window: String, below_pct: f64 },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    pub launch_at_startup: bool,
    pub show_in_tray: bool,
    pub minimize_to_tray: bool,
    pub notifications_enabled: bool,
    pub notification_rules: Vec<NotificationRule>,
    pub ntfy_enabled: bool,
    pub ntfy_server: String,
    pub ntfy_topic: String,
    pub ntfy_rules: Vec<NotificationRule>,
    pub poll_interval_secs: u64,
    pub precise_timestamp: bool,
    pub hide_cooldown_badge: bool,
    pub show_reset_tooltip: bool,
    pub debug_devtools: bool,
    pub debug_webview_reload: bool,
    pub auto_poll: bool,
    pub foreground_poll: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            launch_at_startup: false,
            show_in_tray: true,
            minimize_to_tray: true,
            notifications_enabled: true,
            notification_rules: vec![],
            ntfy_enabled: false,
            ntfy_server: "https://ntfy.sh".to_string(),
            ntfy_topic: "claudeometer".to_string(),
            ntfy_rules: vec![],
            poll_interval_secs: 60,
            precise_timestamp: false,
            hide_cooldown_badge: false,
            show_reset_tooltip: true,
            debug_devtools: false,
            debug_webview_reload: false,
            auto_poll: true,
            foreground_poll: true,
        }
    }
}

#[tauri::command]
pub async fn get_auth_state(app: AppHandle) -> AuthState {
    let store = app.store("store.json").unwrap();
    let mode = store
        .get("auth_mode")
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "none".to_string());
    let email = store
        .get("email")
        .and_then(|v| v.as_str().map(str::to_string));
    let name = store
        .get("name")
        .and_then(|v| v.as_str().map(str::to_string));
    AuthState { mode, email, name }
}

#[tauri::command]
pub async fn save_session_key(app: AppHandle, key: String) -> Result<AuthState, String> {
    let usage = fetch_claude_usage(&key).await?;
    let email = usage.email.clone();
    let name = usage.name.clone();

    // Store the credential in the OS keychain — never write it to the JSON store.
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keychain unavailable: {e}"))?;
    entry.set_password(&key).map_err(|e| format!("Failed to save to keychain: {e}"))?;

    let store = app.store("store.json").unwrap();
    store.set("auth_mode", "session_key");
    // Ensure any legacy plain-text key is removed
    store.delete("session_key");
    if let Some(ref e) = email {
        store.set("email", e.clone());
    }
    if let Some(ref n) = name {
        store.set("name", n.clone());
    }
    store.save().map_err(|e| e.to_string())?;

    Ok(AuthState {
        mode: "session_key".to_string(),
        email,
        name,
    })
}

#[tauri::command]
pub async fn logout(app: AppHandle) -> Result<(), String> {
    // Remove from OS keychain
    if let Ok(entry) = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        let _ = entry.delete_password();
    }

    let store = app.store("store.json").unwrap();
    store.set("auth_mode", "none");
    store.delete("session_key"); // remove legacy plain-text key if present
    store.delete("email");
    store.delete("name");
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Inner fetch called by the `fetch_usage` command. Extracted so that `?`
/// early-returns only exit this function, letting the command wrapper always
/// emit `refresh-done` regardless of success or failure.
async fn do_fetch_usage(app: &AppHandle) -> Result<UsageData, String> {
    let store = app.store("store.json").unwrap();
    let mode = store
        .get("auth_mode")
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();

    let result = match mode.as_str() {
        "session_key" => {
            let key = get_keyring_session_key(&store)?;
            fetch_claude_usage(&key).await
        }
        _ => Err("Not authenticated".to_string()),
    };

    if let Ok(ref data) = result {
        if let Some(ref name) = data.name {
            store.set("name", serde_json::Value::String(name.clone()));
        }
        if let Some(ref email) = data.email {
            store.set("email", serde_json::Value::String(email.clone()));
        }
        let _ = store.save();
        if let Some(cache) = app.try_state::<UsageCache>() {
            *cache.0.lock().unwrap() = Some((data.clone(), now_ms()));
        }
    }

    result
}

#[tauri::command]
pub async fn fetch_usage(app: AppHandle) -> Result<UsageData, String> {
    let _ = app.emit("refresh-started", ());
    let result = do_fetch_usage(&app).await;
    if result.is_ok() {
        let _ = app.emit("refresh-cooldown", ());
    }
    let _ = app.emit("refresh-done", ());
    result
}

/// Inner fetch for tray-initiated refreshes. Updates the cache and emits
/// `usage-updated` on success. `refresh-cooldown` and `refresh-done` are
/// emitted by the caller so they always fire even on early-return errors.
async fn do_tray_refresh(handle: &AppHandle) -> Result<(), String> {
    let store = handle.store("store.json").map_err(|e| e.to_string())?;
    let mode = store
        .get("auth_mode")
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    if mode != "session_key" {
        return Err("Not authenticated".to_string());
    }
    let key = get_keyring_session_key(&store)?;
    let usage = fetch_claude_usage(&key).await?;
    if let Some(cache) = handle.try_state::<UsageCache>() {
        *cache.0.lock().unwrap() = Some((usage.clone(), now_ms()));
    }
    let _ = handle.emit("usage-updated", &usage);
    Ok(())
}

#[tauri::command]
pub fn get_cached_usage(state: tauri::State<'_, UsageCache>) -> Option<CachedUsage> {
    state.0.lock().unwrap().as_ref().map(|(data, ts)| CachedUsage {
        data: data.clone(),
        fetched_at_ms: *ts,
    })
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Settings {
    let store = app.store("store.json").unwrap();
    let raw = store.get("settings");
    match raw {
        Some(v) => serde_json::from_value(v).unwrap_or_default(),
        None => Settings::default(),
    }
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        let mgr = app.autolaunch();
        if settings.launch_at_startup {
            let _ = mgr.enable();
        } else {
            let _ = mgr.disable();
        }
    }

    // Apply tray visibility immediately — no restart needed.
    if let Some(tray_state) = app.try_state::<crate::TrayState>() {
        if let Some(ref tray) = *tray_state.0.lock().unwrap() {
            let _ = tray.set_visible(settings.show_in_tray);
        }
    }
    if !settings.show_in_tray {
        if let Some(w) = app.get_webview_window("tray-menu") {
            let _ = w.hide();
        }
    }

    let store = app.store("store.json").unwrap();
    store.set(
        "settings",
        serde_json::to_value(&settings).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn send_ntfy(
    server: String,
    topic: String,
    title: String,
    body: String,
) -> Result<(), String> {
    let url = format!("{}/{}", server.trim_end_matches('/'), topic);
    let resp = reqwest::Client::new()
        .post(&url)
        .header("Title", &title)
        .header("Priority", "default")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("ntfy returned {}", resp.status()));
    }
    Ok(())
}

#[tauri::command]
pub fn show_desktop_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/// Recreate the main window with the same shape as the one declared in
/// tauri.conf.json. Used when the window has been destroyed (e.g. the user
/// closed it with minimize_to_tray turned off).
fn create_main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    match WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Claudeometer")
        .inner_size(380.0, 600.0)
        .resizable(false)
        .center()
        .decorations(false)
        .visible(false)
        .build()
    {
        Ok(w) => {
            crate::attach_main_close_behavior(&w, app.clone());
            Some(w)
        }
        Err(_) => None,
    }
}

/// Bring the main window to the foreground reliably, then hide the tray menu.
///
/// Steps run on the main thread so that:
/// - Our process is still foreground (the tray menu is what's currently
///   focused), which lets Windows actually activate the main window
/// - ShowWindow's VISIBLE flag is set synchronously before set_focus reads it
///
/// We block the worker thread on a channel until the main thread completes,
/// because Tauri commands run on a worker — without blocking, the command
/// would return immediately and JS would advance before the show/focus has
/// actually happened.
fn bring_main_to_front(app: &AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let main = handle
            .get_webview_window("main")
            .or_else(|| create_main_window(&handle));

        if let Some(w) = main {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_always_on_top(true);
            let _ = w.set_focus();
            let _ = w.set_always_on_top(false);
            let _ = tx.send(());
        }

        if let Some(w) = handle.get_webview_window("tray-menu") {
            let _ = w.hide();
        }
    });
    let _ = rx.recv_timeout(std::time::Duration::from_millis(800));
}

#[tauri::command]
pub fn tray_action(app: AppHandle, action: String) -> Result<(), String> {
    match action.as_str() {
        "show" => {
            bring_main_to_front(&app);
            app.emit("tray-navigate", serde_json::json!({ "view": "dashboard" }))
                .map_err(|e| e.to_string())
        }
        "refresh" => {
            let handle = app.clone();
            async_runtime::spawn(async move {
                let _ = handle.emit("refresh-started", ());
                match do_tray_refresh(&handle).await {
                    Ok(()) => { let _ = handle.emit("refresh-cooldown", ()); }
                    Err(e) => { let _ = handle.emit("usage-error", e); }
                }
                let _ = handle.emit("refresh-done", ());
            });
            Ok(())
        }
        "settings" => {
            if app.get_webview_window("main").is_some() {
                // Window is hidden but React is already mounted. Emit the navigation
                // event first so React commits the Settings view while still hidden,
                // then pause long enough for the WebView2 compositor to produce one
                // frame with the new content before we make the window visible.
                let _ = app.emit("tray-navigate", serde_json::json!({ "view": "settings" }));
                std::thread::sleep(std::time::Duration::from_millis(50));
                bring_main_to_front(&app);
            } else {
                // Window was destroyed — React isn't mounted yet, so emit after
                // the window is created and shown.
                bring_main_to_front(&app);
                let _ = app.emit("tray-navigate", serde_json::json!({ "view": "settings" }));
            }
            Ok(())
        }
        "quit" => {
            app.exit(0);
            Ok(())
        }
        other => Err(format!("Unknown tray action: {other}")),
    }
}
