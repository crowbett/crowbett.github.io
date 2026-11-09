---
title: stash
tagline: Deduplicating, encrypted, incremental backups to a folder or network share.
lang: Rust
tags: content-defined chunking, deduplication, authenticated encryption, backups
repo:
demo: live
demo_try: Edit the harbour log in the middle and back up again; only the chunks around your edit are stored.
group: storage
order: 12
metric: 803.5 MiB backed up in 2.28 s, stored 2.33x smaller; an unchanged rerun takes 0.60 s
metric_source: README benchmark, Windows 11, 16 cores, local SSD, warm OS cache, 5,439 files
---
- FastCDC content-defined chunking with a Gear table derived from the repository key, so an edit in the middle of a large file re-stores only the chunks around it.
- Every chunk is compressed with zstd and sealed with XChaCha20-Poly1305 under a keyed BLAKE3 id; passphrases unlock key slots through Argon2id.
- Unchanged files are reused from the parent snapshot by size, mtime and file id without being read.
- Prune deletes nothing until the new index is durable and refuses to run if any snapshot is unreadable; `check --read-data` re-authenticates every byte.

## How the demo works

stash's own chunker, crypto and pack code, compiled from Rust to WebAssembly, keeps one repository in your tab: packs live in memory instead of a folder, and nonces, salts and the master key come from a seeded stream so every run is reproducible. Chunks average 256 B instead of 1 MiB so a page of text splits into many, Argon2id runs at the smallest cost stash accepts (8 MiB, 1 pass, 1 lane), and a backup here stores chunks only, without the tree and snapshot documents the real tool also writes.
