mod claude;
mod commands;

use commands::*;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_store::StoreExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            setup_tray(app)?;
            start_polling(app.handle().clone());
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
            // Only fire on left-button-up to avoid double-toggle on click+release
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

fn start_polling(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        loop {
            poll_once(&app).await;
            let interval = get_poll_interval(&app);
            tokio::time::sleep(Duration::from_secs(interval)).await;
        }
    });
}

async fn poll_once(app: &AppHandle) {
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
            check_thresholds(app, &usage).await;
        }
        Err(e) => {
            let _ = app.emit("usage-error", e);
        }
    }
}

async fn check_thresholds(app: &AppHandle, usage: &claude::UsageData) {
    let settings: Settings = app
        .store("store.json")
        .ok()
        .and_then(|s| s.get("settings"))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let Some(pct) = usage.max_utilization() else {
        return;
    };

    if pct < settings.notification_threshold as f64 {
        return;
    }

    let title = "Claude Usage Alert".to_string();
    let body = format!("You've used {pct:.0}% of your usage limit.");

    if settings.desktop_notifications {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification().builder().title(&title).body(&body).show();
    }

    if settings.ntfy_enabled && !settings.ntfy_topic.is_empty() {
        let url = format!(
            "{}/{}",
            settings.ntfy_server.trim_end_matches('/'),
            settings.ntfy_topic
        );
        let _ = reqwest::Client::new()
            .post(&url)
            .header("Title", &title)
            .body(body)
            .send()
            .await;
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
