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
  mode: "none" | "session_key";
  email: string | null;
  name: string | null;
}

// Discriminated union — matches the Rust NotificationRule serde tag
export type NotificationRule =
  | { type: "threshold"; id: string; window: string; at_pct: number }
  | { type: "spike";     id: string; window: string; by_pct: number }
  | { type: "reset_soon"; id: string; window: string; within_mins: number }
  | { type: "recovery";  id: string; window: string; below_pct: number };

export interface Settings {
  launch_at_startup: boolean;
  minimize_to_tray: boolean;
  notifications_enabled: boolean;
  notification_rules: NotificationRule[];
  ntfy_enabled: boolean;
  ntfy_server: string;
  ntfy_topic: string;
  ntfy_rules: NotificationRule[];
  poll_interval_secs: number;
  precise_timestamp: boolean;
  auto_poll: boolean;
  foreground_poll: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  launch_at_startup: false,
  minimize_to_tray: true,
  notifications_enabled: true,
  notification_rules: [],
  ntfy_enabled: false,
  ntfy_server: "https://ntfy.sh",
  ntfy_topic: "claudeometer",
  ntfy_rules: [],
  poll_interval_secs: 60,
  precise_timestamp: false,
  auto_poll: true,
  foreground_poll: true,
};
