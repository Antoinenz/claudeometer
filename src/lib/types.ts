export interface UsageWindow {
  utilization: number;
  resets_at: string | null;
}

export interface UsageData {
  five_hour: UsageWindow | null;
  seven_day: UsageWindow | null;
  seven_day_sonnet: UsageWindow | null;
  org_name: string | null;
  name: string | null;
  email: string | null;
  fetched_at: string;
  source: string;
}

export interface AuthState {
  mode: "none" | "session_key" | "api_key";
  email: string | null;
  name: string | null;
}

export interface Settings {
  launch_at_startup: boolean;
  minimize_to_tray: boolean;
  desktop_notifications: boolean;
  notification_threshold: number;
  poll_interval_secs: number;
  ntfy_enabled: boolean;
  ntfy_server: string;
  ntfy_topic: string;
  precise_timestamp: boolean;
  auto_poll: boolean;
  foreground_poll: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  launch_at_startup: false,
  minimize_to_tray: true,
  desktop_notifications: true,
  notification_threshold: 80,
  poll_interval_secs: 60,
  ntfy_enabled: false,
  ntfy_server: "https://ntfy.sh",
  ntfy_topic: "claudeometer",
  precise_timestamp: false,
  auto_poll: true,
  foreground_poll: true,
};
