mod claude;
mod commands;

use commands::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_store::StoreExt;

/// Tracks utilization and reset-countdown values from the previous poll
/// so we can implement edge-triggered notification rules.
struct PollState {
    prev_util: HashMap<String, f64>,
    prev_reset_mins: HashMap<String, f64>,
}

impl Default for PollState {
    fn default() -> Self {
        Self {
            prev_util: HashMap::new(),
            prev_reset_mins: HashMap::new(),
        }
    }
}

type SharedPollState = Arc<Mutex<PollState>>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let poll_state: SharedPollState = Arc::new(Mutex::new(PollState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            setup_tray(app)?;
            start_polling(app.handle().clone(), poll_state);
            setup_close_behavior(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_auth_state,
            save_session_key,
            save_api_key,
            logout,
            fetch_usage,
            get_settings,
            save_settings,
            send_ntfy,
            show_desktop_notification,
        ])
        .run(tauri::generate_context!())
        .expect("error running Claudeometer");
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Claudeometer", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let icon = app.default_window_icon().cloned().unwrap();

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Claudeometer")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => toggle_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn setup_close_behavior(app: &mut tauri::App) -> tauri::Result<()> {
    let handle = app.handle().clone();
    if let Some(window) = app.get_webview_window("main") {
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let minimize = handle
                    .store("store.json")
                    .ok()
                    .and_then(|s| s.get("settings"))
                    .and_then(|v| v.get("minimize_to_tray").cloned())
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);

                if minimize {
                    api.prevent_close();
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
            }
        });
    }
    Ok(())
}

fn start_polling(app: AppHandle, poll_state: SharedPollState) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        loop {
            poll_once(&app, &poll_state).await;
            let interval = get_poll_interval(&app);
            tokio::time::sleep(Duration::from_secs(interval)).await;
        }
    });
}

async fn poll_once(app: &AppHandle, poll_state: &SharedPollState) {
    let store = match app.store("store.json") {
        Ok(s) => s,
        Err(_) => return,
    };

    let auto_poll = store
        .get("settings")
        .and_then(|v| v.get("auto_poll").cloned())
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    if !auto_poll {
        return;
    }

    let mode = store
        .get("auth_mode")
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();

    if mode == "none" {
        return;
    }

    let result = match mode.as_str() {
        "session_key" => {
            let key = store
                .get("session_key")
                .and_then(|v| v.as_str().map(str::to_string));
            match key {
                Some(k) => claude::fetch_claude_usage(&k).await,
                None => return,
            }
        }
        "api_key" => {
            let key = store
                .get("api_key")
                .and_then(|v| v.as_str().map(str::to_string));
            match key {
                Some(k) => claude::verify_api_key(&k).await,
                None => return,
            }
        }
        _ => return,
    };

    match result {
        Ok(usage) => {
            let _ = app.emit("usage-updated", &usage);
            check_notification_rules(app, &usage, poll_state).await;
        }
        Err(e) => {
            let _ = app.emit("usage-error", e);
        }
    }
}

// ── Rule evaluation ──────────────────────────────────────────────────────────

fn window_utilizations(usage: &claude::UsageData) -> HashMap<String, f64> {
    let mut map = HashMap::new();
    if let Some(ref w) = usage.five_hour {
        map.insert("five_hour".to_string(), w.utilization);
    }
    if let Some(ref w) = usage.seven_day {
        map.insert("seven_day".to_string(), w.utilization);
    }
    if let Some(ref w) = usage.seven_day_sonnet {
        map.insert("seven_day_sonnet".to_string(), w.utilization);
    }
    map
}

fn window_reset_mins(usage: &claude::UsageData) -> HashMap<String, f64> {
    let mut map = HashMap::new();
    let windows: [(&str, &Option<claude::UsageWindow>); 3] = [
        ("five_hour", &usage.five_hour),
        ("seven_day", &usage.seven_day),
        ("seven_day_sonnet", &usage.seven_day_sonnet),
    ];
    for (key, window) in &windows {
        if let Some(w) = window {
            if let Some(ref resets_at) = w.resets_at {
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(resets_at) {
                    let mins =
                        (dt.timestamp() - chrono::Utc::now().timestamp()) as f64 / 60.0;
                    map.insert(key.to_string(), mins.max(0.0));
                }
            }
        }
    }
    map
}

fn get_util(window: &str, map: &HashMap<String, f64>) -> f64 {
    if window == "any" {
        map.values().copied().fold(0.0_f64, f64::max)
    } else {
        map.get(window).copied().unwrap_or(0.0)
    }
}

fn rule_fires(
    rule: &NotificationRule,
    cur_util: &HashMap<String, f64>,
    cur_reset: &HashMap<String, f64>,
    prev_util: &HashMap<String, f64>,
    prev_reset: &HashMap<String, f64>,
) -> bool {
    // All edge-triggered rules are suppressed on the very first poll (prev is empty)
    // to prevent a burst of notifications on app start.
    match rule {
        NotificationRule::Threshold { window, at_pct, .. } => {
            if prev_util.is_empty() { return false; }
            let cur = get_util(window, cur_util);
            let prev = get_util(window, prev_util);
            cur >= *at_pct && prev < *at_pct
        }
        NotificationRule::Spike { window, by_pct, .. } => {
            if prev_util.is_empty() { return false; }
            let cur = get_util(window, cur_util);
            let prev = get_util(window, prev_util);
            cur > prev && (cur - prev) >= *by_pct
        }
        NotificationRule::ResetSoon { window, within_mins, .. } => {
            if prev_reset.is_empty() { return false; }
            let cur = cur_reset.get(window.as_str()).copied().unwrap_or(f64::MAX);
            let prev = prev_reset.get(window.as_str()).copied().unwrap_or(f64::MAX);
            let threshold = *within_mins as f64;
            cur <= threshold && prev > threshold
        }
        NotificationRule::Recovery { window, below_pct, .. } => {
            if prev_util.is_empty() { return false; }
            let cur = get_util(window, cur_util);
            let prev = get_util(window, prev_util);
            cur <= *below_pct && prev > *below_pct
        }
    }
}

fn window_label(window: &str) -> &str {
    match window {
        "five_hour" => "5-hour",
        "seven_day" => "7-day",
        "seven_day_sonnet" => "7-day Sonnet",
        _ => "usage",
    }
}

fn rule_message(rule: &NotificationRule, cur_util: &HashMap<String, f64>) -> (String, String) {
    match rule {
        NotificationRule::Threshold { window, at_pct, .. } => {
            let val = get_util(window, cur_util);
            (
                "Claude Usage Alert".to_string(),
                format!(
                    "{} usage reached {:.0}% (threshold: {:.0}%)",
                    window_label(window), val, at_pct
                ),
            )
        }
        NotificationRule::Spike { window, by_pct, .. } => {
            let val = get_util(window, cur_util);
            (
                "Claude Usage Spike".to_string(),
                format!(
                    "{} usage jumped by {:.0}% — now at {:.0}%",
                    window_label(window), by_pct, val
                ),
            )
        }
        NotificationRule::ResetSoon { window, within_mins, .. } => {
            let label = if *within_mins >= 60 {
                format!("{}h", within_mins / 60)
            } else {
                format!("{within_mins}m")
            };
            (
                "Claude Limit Resetting".to_string(),
                format!("{} limit resets within {}", window_label(window), label),
            )
        }
        NotificationRule::Recovery { window, below_pct, .. } => {
            let val = get_util(window, cur_util);
            (
                "Claude Usage Recovered".to_string(),
                format!(
                    "{} usage dropped to {:.0}% (below {:.0}%)",
                    window_label(window), val, below_pct
                ),
            )
        }
    }
}

async fn check_notification_rules(
    app: &AppHandle,
    usage: &claude::UsageData,
    state: &SharedPollState,
) {
    let settings: Settings = app
        .store("store.json")
        .ok()
        .and_then(|s| s.get("settings"))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let cur_util = window_utilizations(usage);
    let cur_reset = window_reset_mins(usage);

    // Snapshot prev values without holding the lock across any await
    let (prev_util, prev_reset) = {
        let s = state.lock().unwrap();
        (s.prev_util.clone(), s.prev_reset_mins.clone())
    };

    // Desktop notifications (only when enabled)
    if settings.notifications_enabled {
        for rule in &settings.notification_rules {
            if rule_fires(rule, &cur_util, &cur_reset, &prev_util, &prev_reset) {
                let (title, body) = rule_message(rule, &cur_util);
                use tauri_plugin_notification::NotificationExt;
                let _ = app.notification().builder().title(&title).body(&body).show();
            }
        }
    }

    // ntfy notifications
    if settings.ntfy_enabled && !settings.ntfy_topic.is_empty() {
        for rule in &settings.ntfy_rules {
            if rule_fires(rule, &cur_util, &cur_reset, &prev_util, &prev_reset) {
                let (title, body) = rule_message(rule, &cur_util);
                let url = format!(
                    "{}/{}",
                    settings.ntfy_server.trim_end_matches('/'),
                    settings.ntfy_topic,
                );
                let _ = reqwest::Client::new()
                    .post(&url)
                    .header("Title", &title)
                    .header("Priority", "default")
                    .body(body)
                    .send()
                    .await;
            }
        }
    }

    // Update state after all awaits are done
    {
        let mut s = state.lock().unwrap();
        s.prev_util = cur_util;
        s.prev_reset_mins = cur_reset;
    }
}

fn get_poll_interval(app: &AppHandle) -> u64 {
    app.store("store.json")
        .ok()
        .and_then(|s| s.get("settings"))
        .and_then(|v| v.get("poll_interval_secs").cloned())
        .and_then(|v| v.as_u64())
        .unwrap_or(60)
}
