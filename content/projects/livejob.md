---
title: LiveJob
tagline: Your Mac's terminal on your iPhone: run a command or coding agent under lj, and the phone asks when it needs you.
lang: Go, Swift
tags: end-to-end encryption, terminal emulation, prompt detection, Live Activities
repo:
demo: live
demo_try: Play the relay: rewrite a button, replay an answer or inject keystrokes. lj's own checks refuse each one.
group: tools
order: 20
metric: Home with three live jobs went from ~130 ms to ~7 ms of main-thread time per second
metric_source: CLAUDE.md iOS performance notes, Time Profiler, after moving in-app animation to Core Animation
---
- `lj run -- <cmd>` wraps any command or coding agent in a PTY. The phone shows the terminal live and keeps the job on the Lock Screen, and when the job needs you it asks there with one-tap answers.
- The relay in the middle routes and keeps recent output, but only as ciphertext. Pairing is X25519, proven by a secret in the QR code that never reaches the relay; every frame is AES-256-GCM, bound to its direction; and each one-tap answer is HMAC-signed by the Mac and checked again by the phone. A relay can't read the terminal or type into it.
- Prompt detection reads a virtual terminal, not raw bytes, once the screen has settled: numbered and arrow menus, `(y)` options, `[y/N]` questions and idle agents, each pattern backed by a captured fixture.
- A Go CLI and relay (SQLite, APNs) and a SwiftUI iPhone app with a Live Activity, widgets, a Watch app and a Control Center control.

## How the demo works

lj's own Go packages, compiled to WebAssembly, play one made-up coding-agent session on a simulated clock. A Mac and a phone pair first, with the real key agreement and pairing proof, and the Mac wraps the job's session key for the phone. Then everything the agent prints goes through lj's terminal emulator, is sealed into frames, and crosses a relay that holds only ciphertext; the phone opens each frame and draws the same screen. When the screen settles, lj's prompt detection decides whether the job is waiting, and the Lock Screen card shows its question with signed buttons. Your tap or typed line is sealed by the phone and checked by the Mac's stream code before it reaches the agent. You can also play the relay and try to flip a bit, rewrite a button, replay an answer or inject keystrokes, and watch each one get refused. The PTY, the relay's sockets and Apple's push service can't run in a browser: the agent is a script, the relay is a list, and the phone is played by the same Go packages the iPhone app's tests check against.
