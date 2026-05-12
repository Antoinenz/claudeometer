# Claudeometer

A lightweight desktop app for monitoring your [Claude.ai](https://claude.ai) usage limits in real time.

![Tauri](https://img.shields.io/badge/Tauri_v2-000000?logo=tauri) ![React](https://img.shields.io/badge/React_18-000000?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-000000?logo=typescript)

## Features

- Live usage bars for your 5-hour and 7-day Claude limits
- Automatic background polling with a configurable interval
- Refresh on window focus
- Desktop notifications with customisable rules (threshold, spike, reset soon, recovery)
- [ntfy](https://ntfy.sh) push notification support
- Supports Claude.ai session key authentication

## Getting started

### Prerequisites

- [Rust](https://rustup.rs)
- [Node.js](https://nodejs.org) (v18+)
- Tauri CLI v2: `npm install -g @tauri-apps/cli`

### Run in development

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

## Authentication

Claudeometer uses your Claude.ai **session key** to read usage data.

**How to get your session key:**

1. Open [claude.ai](https://claude.ai) and sign in
2. Open DevTools → Application → Cookies
3. Copy the value of `sessionKey`

Your key is stored locally and never leaves your machine.

## Notifications

Rules are edge-triggered — each rule fires once per crossing rather than on every poll:

| Type | Fires when |
|------|-----------|
| Threshold | Usage rises above a set percentage |
| Spike | Usage jumps by more than a set amount between polls |
| Reset soon | A window is within a set time of resetting |
| Recovery | Usage falls back below a set percentage |

## License

MIT
