> **This repository has moved into one monorepo.**
>
> The BornCode plugins — agent customization, desktop control, auto-continue,
> auto-shutdown, browser use, session instructions, session sync, and the side
> chat — now live in
> **[`borncode-app/dsh-borncode`](https://github.com/borncode-app/dsh-borncode)**,
> one repository with one Plugins entry.
>
> | this repo | new home |
> |---|---|
> | `dsh-agent-customizer` | `packages/dsh-agent-customizer` |
> | `dsh-agent-desktop` | `packages/dsh-agent-desktop` |
> | `dsh-auto-continue` | `packages/dsh-auto-continue` |
> | `dsh-auto-shutdown` | `packages/dsh-auto-shutdown` |
> | `dsh-browser-use` | `packages/dsh-browser-use` |
> | `dsh-session-instructions` | `packages/dsh-session-instructions` |
> | `dsh-session-sync` | `packages/dsh-session-sync` |
> | `dsh-side-chat` | `packages/dsh-side-chat` |
>
> The code and its history are unchanged; only the repository is shared. Install
> `dsh-borncode` instead of the individual bundles. This repository stays open
> so the old links keep working.
<div align="center">
  <img src="icon.svg" alt="" width="72" height="72">
  <h1>dsh-auto-shutdown</h1>
  <p><b>Powers the computer down after the work finishes â€” with the operating system's own cancelable countdown.</b></p>
  <p>
    <a href="https://github.com/borncode-app/dsh-auto-shutdown/releases"><img alt="release" src="https://img.shields.io/github/v/release/borncode-app/dsh-auto-shutdown?style=flat-square&color=6C4BF6"></a>
    <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-3DA639?style=flat-square"></a>
    <img alt="plugin" src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-6C4BF6?style=flat-square">
    <img alt="default" src="https://img.shields.io/badge/default-off-8957e5?style=flat-square">
  </p>
</div>

---

## What it does

Long agent runs end the same way: the work is done, the machine sits awake for hours. This plugin asks the
operating system to power the computer down once a **root** session finishes its work â€” using the system's own
shutdown, so the countdown window is visible and `shutdown /a` still cancels it.

It ships **off**, because a deployment should never start powering down computers on its own.

## Features

- **Root sessions only** â€” a subagent finishing does not count; the whole turn has to be over.
- **The OS does the shutdown** â€” Windows' native countdown dialog (or your platform's equivalent), not a hidden call.
- **Cancelable** â€” the countdown is real time you can still act in, and `shutdown /a` aborts it.
- **Bounded countdown** â€” `minDelaySeconds` / `maxDelaySeconds` clamp whatever is configured.
- **Custom message** â€” `message` is what the OS shows next to its own dialog.
- **Runtime switch** â€” the Settings toggle stores its choice in `state.json`; the bundle default stays off.

## Requirements

| | |
|---|---|
| DeepSeek Harness | 0.2.x (Web GUI) |
| Runtime | Node 24, supplied by the Harness runtime |
| Platform | Windows (uses `shutdown /s /t`); the toggle is inert where no equivalent command exists |

## Install

```bash
git clone https://github.com/borncode-app/dsh-auto-shutdown.git dsh-auto-shutdown
```

Then in DSH: **Plugins** â†’ install the bundle from that directory, or:

```
plugin_manager install_bundle target=C:\path\to\dsh-auto-shutdown
```

Restart once, then flip the switch in **Settings** when you actually want it.

## Configuration

| field | default | meaning |
|---|---|---|
| `endpoint` | `/plugins/auto-shutdown` | Path the Web GUI reads and posts the toggle to |
| `enabled` | `false` | Off by default; the user turns this on deliberately |
| `delaySeconds` | `120` | Countdown the OS shows before powering down |
| `minDelaySeconds` | `30` | Shortest countdown the plugin will arm |
| `maxDelaySeconds` | `3600` | Longest countdown the plugin will arm |
| `message` | *(see patch)* | Note Windows shows next to its countdown dialog |

## How it works

1. The host row watches session lifecycle events.
2. When a **root** session reaches its finished state and `enabled` is true, it clamps `delaySeconds` into
   the allowed range and hands the countdown to the OS.
3. If anything else arrives in the meantime, you cancel with `shutdown /a` â€” the plugin never hides that window.

## Files

| file | role |
|---|---|
| `index.js` | host row: lifecycle watch, delay clamping, OS call |
| `client.js` | the Settings toggle and its stored state |
| `cordis.patch.yml` | the bundle patch that inserts the row |
| `locale/{en,th,zh}.json` | UI strings |
| `icon.svg` | plugin icon |
| `test/` | `host-logic.test.mjs`, `client-render.test.mjs` |

## à¸ à¸²à¸©à¸²à¹„à¸—à¸¢

à¹€à¸¡à¸·à¹ˆà¸­ session à¸«à¸¥à¸±à¸à¸—à¸³à¸‡à¸²à¸™à¹€à¸ªà¸£à¹‡à¸ˆ plugin à¸™à¸µà¹‰à¸ˆà¸°à¸ªà¸±à¹ˆà¸‡ **à¸›à¸´à¸”à¹€à¸„à¸£à¸·à¹ˆà¸­à¸‡** à¸œà¹ˆà¸²à¸™à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸‚à¸­à¸‡ OS à¹€à¸­à¸‡ à¸—à¸³à¹ƒà¸«à¹‰à¸¡à¸µà¸«à¸™à¹‰à¸²à¸•à¹ˆà¸²à¸‡à¸™à¸±à¸šà¸–à¸­à¸¢à¸«à¸¥à¸±à¸‡
à¸—à¸µà¹ˆà¸¡à¸­à¸‡à¹€à¸«à¹‡à¸™à¹„à¸”à¹‰ à¹à¸¥à¸°à¸¢à¸à¹€à¸¥à¸´à¸à¹„à¸”à¹‰à¸”à¹‰à¸§à¸¢ `shutdown /a`

- à¸™à¸±à¸šà¹€à¸‰à¸žà¸²à¸° **root session** à¸—à¸µà¹ˆà¸ˆà¸šà¸‡à¸²à¸™ â€” subagent à¸—à¸³à¸‡à¸²à¸™à¹€à¸ªà¸£à¹‡à¸ˆà¹„à¸¡à¹ˆà¸™à¸±à¸š
- à¸„à¹ˆà¸²à¹€à¸£à¸´à¹ˆà¸¡à¸•à¹‰à¸™à¸„à¸·à¸­ **à¸›à¸´à¸”** à¸•à¹‰à¸­à¸‡à¹„à¸›à¹€à¸›à¸´à¸”à¸—à¸µà¹ˆà¸«à¸™à¹‰à¸² Settings à¹€à¸­à¸‡ (à¹€à¸ˆà¸•à¸™à¸²: à¹„à¸¡à¹ˆà¹ƒà¸«à¹‰ deployment à¸›à¸´à¸”à¹€à¸„à¸£à¸·à¹ˆà¸­à¸‡à¹€à¸­à¸‡à¹‚à¸”à¸¢à¸žà¸¥à¸à¸²à¸£)
- à¸›à¸£à¸±à¸šà¹€à¸§à¸¥à¸²à¹„à¸”à¹‰à¸”à¹‰à¸§à¸¢ `delaySeconds` (clamp à¸£à¸°à¸«à¸§à¹ˆà¸²à¸‡ `minDelaySeconds` â€“ `maxDelaySeconds`)
- à¹ƒà¸Šà¹‰à¹„à¸”à¹‰à¸šà¸™ Windows

## License

[MIT](LICENSE) Â© 2026 BornCode
