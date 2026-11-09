---
title: stash
tagline: Deduplicating, encrypted, incremental backups to a folder or network share.
lang: Rust
tags: content-defined chunking, deduplication, authenticated encryption, backups
repo:
demo: live
demo_try: Insert a line mid-file and back up. Only the chunks around your line are new; the rest of the file is linked, not stored again.
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

stash's own chunker, crypto and pack code, compiled from Rust to WebAssembly, keeps one repository in your tab. A small file tree changes day by day (log lines appended, a paragraph inserted, a file copied, renamed, deleted), and each snapshot sends every file through stash's backup, even unchanged ones, which the real tool skips by size and mtime. The strips are the chunk boundaries the binary drew; only chunks the repository has not seen are compressed, sealed and stored, and the rest are linked. Insert your own line into any file to see which chunks it touches, restore a snapshot to have every chunk authenticated and every file hash-checked, or flip one bit of a pack and watch the restore refuse it.

Packs live in memory instead of a folder, nonces and keys come from a seeded stream so runs repeat, chunks average 256 B to 1 KiB instead of 1 MiB so small files split into many, each file's new chunks go into a pack of their own, and a snapshot here stores chunks only, without the tree and snapshot documents the real tool also writes.
