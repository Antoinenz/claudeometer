mod claude;
mod commands;

use commands::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    tray::{TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_store::StoreExt;

const TRAY_MENU_W: f64 = 220.0;
const TRAY_MENU_H: f64 = 188.0;

/// Holds the live TrayIcon handle so save_settings can call set_visible() on it.
pub struct TrayState(pub Mutex<Option<TrayIcon>>);

/// Timestamp of the last time the tray menu was hidden by focus-loss.
/// Used to debounce tray-icon clicks so that clicking the icon while the
/// menu is open closes it rather than immediately reopening it.
struct TrayLastHide(Mutex<Option<Instant>>);

/// Timestamp of the last time the tray menu window was made visible.
/// Used to suppress spurious Focused(false) events that WebView2 fires
/// during its own init sequence (which can arrive after Focused(true),
/// defeating the old ever_focused guard).
struct TrayLastShow(Mutex<Option<Instant>>);

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
        .manage(commands::UsageCache(std::sync::Mutex::new(None)))
        .manage(TrayLastHide(Mutex::new(None)))
        .manage(TrayLastShow(Mutex::new(None)))
        .manage(TrayState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_auth_state,
            save_session_key,
            logout,
            fetch_usage,
            get_settings,
            save_settings,
            send_ntfy,
            show_desktop_notification,
            tray_action,
            get_cached_usage,
        ])
        .run(tauri::generate_context!())
        .expect("error running Claudeometer");
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let icon = app.default_window_icon().cloned().unwrap();

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Claudeometer")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button_state: tauri::tray::MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_tray_menu(tray.app_handle(), rect);
            }
        })
        .build(app)?;

    // Apply initial visibility from persisted settings.
    let show = app
        .store("store.json")
        .ok()
        .and_then(|s| s.get("settings"))
        .and_then(|v| v.get("show_in_tray").cloned())
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    if !show {
        let _ = tray.set_visible(false);
    }

    // Store the handle so save_settings can toggle visibility later.
    if let Some(state) = app.try_state::<TrayState>() {
        *state.0.lock().unwrap() = Some(tray);
    }

    Ok(())
}

/// Show the custom tray menu window positioned above (or below) the tray icon,
/// horizontally centered on the icon. If the menu is already visible, hide it.
fn toggle_tray_menu(app: &AppHandle, tray_rect: tauri::Rect) {
    // If the menu was hidden by focus-loss in the last 300ms, the user clicked
    // the tray icon while it was open. Don't reopen — treat it as a close.
    let recently_closed = app
        .try_state::<TrayLastHide>()
        .and_then(|s| *s.0.lock().unwrap())
        .map(|t| t.elapsed().as_millis() < 300)
        .unwrap_or(false);
    if recently_closed {
        return;
    }

    if let Some(w) = app.get_webview_window("tray-menu") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            return;
        }
    }

    // The tray icon's rect is in physical pixels on Windows. Pick a point inside
    // it and look up that monitor's scale factor — this stays correct even when
    // the main window is hidden (which can break main_window.scale_factor()).
    let probe_x = match tray_rect.position {
        tauri::Position::Physical(p) => p.x as f64,
        tauri::Position::Logical(p) => p.x,
    };
    let probe_y = match tray_rect.position {
        tauri::Position::Physical(p) => p.y as f64,
        tauri::Position::Logical(p) => p.y,
    };
    let scale = app
        .monitor_from_point(probe_x, probe_y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);

    let (icon_x, icon_y, icon_w, icon_h) = rect_to_physical(&tray_rect, scale);

    let menu_w_phys = TRAY_MENU_W * scale;
    let menu_h_phys = TRAY_MENU_H * scale;
    let gap = 4.0 * scale;

    let icon_center_x = icon_x + icon_w / 2.0;
    let mut x = icon_center_x - menu_w_phys / 2.0;

    // Place above the icon by default; flip below if there isn't room.
    let space_above = icon_y;
    let below = space_above < menu_h_phys + gap;
    let y = if below {
        icon_y + icon_h + gap
    } else {
        icon_y - menu_h_phys - gap
    };

    // Keep on-screen horizontally if the icon is near a corner.
    if x < 4.0 {
        x = 4.0;
    }

    let arrow = if below { "up" } else { "down" };

    let window = match app.get_webview_window("tray-menu") {
        Some(w) => w,
        None => match build_tray_menu_window(app, arrow) {
            Ok(w) => w,
            Err(_) => return,
        },
    };

    let _ = window.set_position(PhysicalPosition::new(x as i32, y as i32));
    let _ = window.emit(
        "tray-menu-orientation",
        serde_json::json!({ "arrow": arrow }),
    );
    let _ = window.show();
    if let Some(state) = app.try_state::<TrayLastShow>() {
        *state.0.lock().unwrap() = Some(Instant::now());
    }
    let _ = window.set_focus();
}

fn build_tray_menu_window(app: &AppHandle, arrow: &str) -> tauri::Result<tauri::WebviewWindow> {
    let url = format!("index.html#tray-menu-{arrow}");
    let w = WebviewWindowBuilder::new(
        app,
        "tray-menu",
        WebviewUrl::App(url.into()),
    )
    .inner_size(TRAY_MENU_W, TRAY_MENU_H)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .shadow(false)
    .build()?;

    // Auto-hide when the menu loses focus (click outside, alt-tab, etc.).
    // Guard: only hide if the window has been visible for ≥300 ms. WebView2 fires
    // spurious Focused(false) events during initialisation — sometimes even after
    // Focused(true) — so we cannot rely on an "ever_focused" flag alone.
    let w_clone = w.clone();
    w.on_window_event(move |e| {
        if let tauri::WindowEvent::Focused(false) = e {
            let shown_long_enough = w_clone
                .app_handle()
                .try_state::<TrayLastShow>()
                .and_then(|s| *s.0.lock().unwrap())
                .map(|t| t.elapsed().as_millis() >= 300)
                .unwrap_or(false);
            if shown_long_enough {
                if let Some(state) = w_clone.app_handle().try_state::<TrayLastHide>() {
                    *state.0.lock().unwrap() = Some(Instant::now());
                }
                let _ = w_clone.hide();
            }
        }
    });

    Ok(w)
}

fn rect_to_physical(rect: &tauri::Rect, scale: f64) -> (f64, f64, f64, f64) {
    let (x, y) = match rect.position {
        tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
        tauri::Position::Logical(p) => (p.x * scale, p.y * scale),
    };
    let (w, h) = match rect.size {
        tauri::Size::Physical(s) => (s.width as f64, s.height as f64),
        tauri::Size::Logical(s) => (s.width * scale, s.height * scale),
    };
    (x, y, w, h)
}

/// Attach the close-to-tray interceptor to a main window. Called both for
/// the initial window at startup and for any window recreated by the tray
/// menu's Open action.
pub fn attach_main_close_behavior(window: &tauri::WebviewWindow, handle: AppHandle) {
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            let store = handle.store("store.json").ok();
            let get_bool = |key: &str| {
                store.as_ref()
                    .and_then(|s| s.get("settings"))
                    .and_then(|v| v.get(key).cloned())
                    .and_then(|v| v.as_bool())
            };
            let show_in_tray = get_bool("show_in_tray").unwrap_or(true);
            let minimize = get_bool("minimize_to_tray").unwrap_or(true);

            if minimize && show_in_tray {
                api.prevent_close();
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                }
            } else {
                handle.exit(0);
            }
        }
    });
}

fn setup_close_behavior(app: &mut tauri::App) -> tauri::Result<()> {
    let handle = app.handle().clone();
    if let Some(window) = app.get_webview_window("main") {
        attach_main_close_behavior(&window, handle);
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
            match commands::get_keyring_session_key(&store) {
                Ok(k) => claude::fetch_claude_usage(&k).await,
                Err(_) => return,
            }
        }
        _ => return,
    };

    match result {
        Ok(usage) => {
            if let Some(cache) = app.try_state::<commands::UsageCache>() {
                *cache.0.lock().unwrap() = Some((usage.clone(), commands::now_ms()));
            }
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
