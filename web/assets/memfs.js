// An in-memory file system for demo binaries. Go's js/wasm port sends every
// os call to globalThis.fs in Node's callback style; the browser has none, so
// this supplies one that lives as long as the worker. Callbacks run
// synchronously, so a Go call into it never waits on the event loop.
// Loaded before wasm_exec.js, which keeps an existing globalThis.fs.
(() => {
  const constants = { O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_TRUNC: 512, O_APPEND: 1024, O_DIRECTORY: 65536 };
  const S_IFDIR = 0o040000;
  const S_IFREG = 0o100000;
  const fail = (code) => Object.assign(new Error(code), { code });
  const decoder = new TextDecoder("utf-8");

  let nextIno = 1;
  function inode(dir, mode) {
    const t = Date.now();
    return { dir, mode: mode & 0o7777, ino: nextIno++, kids: dir ? new Map() : null, data: new Uint8Array(0), size: 0, mtime: t, ctime: t };
  }
  const root = inode(true, 0o755);
  root.kids.set("tmp", inode(true, 0o777));

  function resolve(...parts) {
    const out = [];
    for (const p of parts) {
      if (p.startsWith("/")) out.length = 0;
      for (const seg of p.split("/")) {
        if (seg === "" || seg === ".") continue;
        if (seg === "..") out.pop();
        else out.push(seg);
      }
    }
    return "/" + out.join("/");
  }
  const segments = (p) => resolve(p).split("/").filter(Boolean);

  function lookup(p) {
    let n = root;
    for (const seg of segments(p)) {
      if (!n.dir) throw fail("ENOTDIR");
      n = n.kids.get(seg);
      if (!n) throw fail("ENOENT");
    }
    return n;
  }

  // parentOf returns the directory that holds p and p's last name.
  function parentOf(p) {
    const segs = segments(p);
    if (segs.length === 0) throw fail("EBUSY");
    const name = segs.pop();
    const dir = lookup("/" + segs.join("/"));
    if (!dir.dir) throw fail("ENOTDIR");
    return [dir, name];
  }

  function stat(n) {
    return {
      dev: 1, ino: n.ino, mode: (n.dir ? S_IFDIR : S_IFREG) | n.mode, nlink: 1, uid: 0, gid: 0, rdev: 0,
      size: n.dir ? 4096 : n.size, blksize: 4096, blocks: Math.ceil(n.size / 512),
      atimeMs: n.mtime, mtimeMs: n.mtime, ctimeMs: n.ctime,
      isDirectory: () => n.dir,
    };
  }

  const MAX_SIZE = 2 ** 30; // far beyond any demo; larger is EFBIG, not an allocation failure
  function resize(n, size) {
    if (!Number.isSafeInteger(size) || size < 0) throw fail("EINVAL");
    if (size > MAX_SIZE) throw fail("EFBIG");
    if (size > n.data.length) {
      const grown = new Uint8Array(Math.max(size, n.data.length * 2, 256));
      grown.set(n.data.subarray(0, n.size));
      n.data = grown;
    } else if (size < n.size) {
      n.data.fill(0, size, n.size);
    }
    n.size = size;
    n.mtime = Date.now();
  }

  const fds = new Map();
  let nextFd = 3;
  function file(fd) {
    const f = fds.get(fd);
    if (!f) throw fail("EBADF");
    return f;
  }

  let out = "";
  function console(buf) {
    out += decoder.decode(buf, { stream: true });
    const nl = out.lastIndexOf("\n");
    if (nl !== -1) {
      globalThis.console.log(out.slice(0, nl));
      out = out.slice(nl + 1);
    }
    return buf.length;
  }

  const ops = {
    open(p, flags, mode) {
      const access = flags & 3;
      let n;
      try {
        n = lookup(p);
      } catch (e) {
        if (e.code !== "ENOENT" || !(flags & constants.O_CREAT)) throw e;
        const [dir, name] = parentOf(p);
        n = inode(false, mode);
        dir.kids.set(name, n);
        dir.mtime = n.mtime;
        flags &= ~constants.O_EXCL;
      }
      if (flags & constants.O_CREAT && flags & constants.O_EXCL) throw fail("EEXIST");
      if (flags & constants.O_DIRECTORY && !n.dir) throw fail("ENOTDIR");
      if (n.dir && access !== constants.O_RDONLY) throw fail("EISDIR");
      if (flags & constants.O_TRUNC && access !== constants.O_RDONLY) resize(n, 0);
      const fd = nextFd++;
      fds.set(fd, { n, pos: 0, read: access !== constants.O_WRONLY, write: access !== constants.O_RDONLY, append: !!(flags & constants.O_APPEND) });
      return fd;
    },
    close(fd) { file(fd); fds.delete(fd); },
    read(fd, buf, off, len, pos) {
      const f = file(fd);
      if (f.n.dir) throw fail("EISDIR");
      if (!f.read) throw fail("EBADF");
      const at = pos ?? f.pos;
      const n = Math.max(0, Math.min(len, f.n.size - at));
      buf.set(f.n.data.subarray(at, at + n), off);
      if (pos === null || pos === undefined) f.pos += n;
      return n;
    },
    write(fd, buf, off, len, pos) {
      if (fd === 1 || fd === 2) return console(buf.subarray(off, off + len));
      const f = file(fd);
      if (!f.write) throw fail("EBADF");
      const at = f.append ? f.n.size : pos ?? f.pos;
      if (at + len > f.n.size) resize(f.n, at + len);
      f.n.data.set(buf.subarray(off, off + len), at);
      f.n.mtime = Date.now();
      if (pos === null || pos === undefined) f.pos = at + len;
      return len;
    },
    fstat(fd) { return stat(file(fd).n); },
    stat(p) { return stat(lookup(p)); },
    lstat(p) { return stat(lookup(p)); },
    fsync(fd) { file(fd); },
    ftruncate(fd, len) {
      const f = file(fd);
      if (!f.write) throw fail("EINVAL");
      resize(f.n, len);
    },
    truncate(p, len) {
      const n = lookup(p);
      if (n.dir) throw fail("EISDIR");
      resize(n, len);
    },
    mkdir(p, mode) {
      const [dir, name] = parentOf(p);
      if (dir.kids.has(name)) throw fail("EEXIST");
      const n = inode(true, mode);
      dir.kids.set(name, n);
      dir.mtime = n.mtime;
    },
    readdir(p) {
      const n = lookup(p);
      if (!n.dir) throw fail("ENOTDIR");
      return [...n.kids.keys()];
    },
    rename(from, to) {
      const [fdir, fname] = parentOf(from);
      const n = fdir.kids.get(fname);
      if (!n) throw fail("ENOENT");
      const [tdir, tname] = parentOf(to);
      if (n.dir && (resolve(to) + "/").startsWith(resolve(from) + "/") && resolve(to) !== resolve(from)) throw fail("EINVAL");
      const old = tdir.kids.get(tname);
      if (old === n) return;
      if (old && old.dir && !n.dir) throw fail("EISDIR");
      if (old && !old.dir && n.dir) throw fail("ENOTDIR");
      if (old && old.dir && old.kids.size > 0) throw fail("ENOTEMPTY");
      fdir.kids.delete(fname);
      tdir.kids.set(tname, n);
      fdir.mtime = tdir.mtime = Date.now();
    },
    unlink(p) {
      const [dir, name] = parentOf(p);
      const n = dir.kids.get(name);
      if (!n) throw fail("ENOENT");
      if (n.dir) throw fail("EISDIR");
      dir.kids.delete(name);
    },
    rmdir(p) {
      const [dir, name] = parentOf(p);
      const n = dir.kids.get(name);
      if (!n) throw fail("ENOENT");
      if (!n.dir) throw fail("ENOTDIR");
      if (n.kids.size > 0) throw fail("ENOTEMPTY");
      dir.kids.delete(name);
    },
    chmod(p, mode) { lookup(p).mode = mode & 0o7777; },
    fchmod(fd, mode) { file(fd).n.mode = mode & 0o7777; },
    chown(p) { lookup(p); },
    fchown(fd) { file(fd); },
    lchown(p) { lookup(p); },
    utimes(p, atime, mtime) { lookup(p).mtime = mtime * 1000; },
    link() { throw fail("ENOSYS"); },
    symlink() { throw fail("ENOSYS"); },
    readlink() { throw fail("ENOSYS"); },
  };

  const fs = { constants, writeSync: (fd, buf) => console(buf) };
  for (const [name, op] of Object.entries(ops)) {
    fs[name] = (...args) => {
      const cb = args.pop();
      let res;
      try {
        res = op(...args);
      } catch (e) {
        if (!e.code) throw e;
        cb(e);
        return;
      }
      cb(null, res);
    };
  }

  const enosys = () => { throw fail("ENOSYS"); };
  globalThis.fs = fs;
  globalThis.path = { resolve };
  globalThis.process ??= {
    getuid: () => -1, getgid: () => -1, geteuid: () => -1, getegid: () => -1, getgroups: enosys,
    pid: -1, ppid: -1, umask: enosys, cwd: () => "/", chdir: enosys,
  };
})();
