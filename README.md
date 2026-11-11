<div align="center">
  <img src="icon.svg" alt="" width="72" height="72">
  <h1>dsh-auto-shutdown</h1>
  <p><b>Powers the computer down after the work finishes — with the operating system's own cancelable countdown.</b></p>
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
operating system to power the computer down once a **root** session finishes its work — using the system's own
shutdown, so the countdown window is visible and `shutdown /a` still cancels it.

It ships **off**, because a deployment should never start powering down computers on its own.

## Features

- **Root sessions only** — a subagent finishing does not count; the whole turn has to be over.
- **The OS does the shutdown** — Windows' native countdown dialog (or your platform's equivalent), not a hidden call.
- **Cancelable** — the countdown is real time you can still act in, and `shutdown /a` aborts it.
- **Bounded countdown** — `minDelaySeconds` / `maxDelaySeconds` clamp whatever is configured.
- **Custom message** — `message` is what the OS shows next to its own dialog.
- **Runtime switch** — the Settings toggle stores its choice in `state.json`; the bundle default stays off.

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

Then in DSH: **Plugins** → install the bundle from that directory, or:

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
3. If anything else arrives in the meantime, you cancel with `shutdown /a` — the plugin never hides that window.

## Files

| file | role |
|---|---|
| `index.js` | host row: lifecycle watch, delay clamping, OS call |
| `client.js` | the Settings toggle and its stored state |
| `cordis.patch.yml` | the bundle patch that inserts the row |
| `locale/{en,th,zh}.json` | UI strings |
| `icon.svg` | plugin icon |
| `test/` | `host-logic.test.mjs`, `client-render.test.mjs` |

## ภาษาไทย

เมื่อ session หลักทำงานเสร็จ plugin นี้จะสั่ง **ปิดเครื่อง** ผ่านคำสั่งของ OS เอง ทำให้มีหน้าต่างนับถอยหลัง
ที่มองเห็นได้ และยกเลิกได้ด้วย `shutdown /a`

- นับเฉพาะ **root session** ที่จบงาน — subagent ทำงานเสร็จไม่นับ
- ค่าเริ่มต้นคือ **ปิด** ต้องไปเปิดที่หน้า Settings เอง (เจตนา: ไม่ให้ deployment ปิดเครื่องเองโดยพลการ)
- ปรับเวลาได้ด้วย `delaySeconds` (clamp ระหว่าง `minDelaySeconds` – `maxDelaySeconds`)
- ใช้ได้บน Windows

## License

[MIT](LICENSE) © 2026 BornCode
