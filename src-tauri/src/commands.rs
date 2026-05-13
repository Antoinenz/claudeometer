use crate::claude::{fetch_claude_usage, UsageData};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

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
    pub debug_devtools: bool,
    pub debug_webview_reload: bool,
    pub auto_poll: bool,
    pub foreground_poll: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            launch_at_startup: false,
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

#[tauri::command]
pub async fn fetch_usage(app: AppHandle) -> Result<UsageData, String> {
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
    }

    result
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
