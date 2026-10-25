# Source offer for GPL / LGPL components (Tier 1, "full" flavor)

The "full" build bundles unmodified binaries of **proot** (GPL-2.0-or-later) and **libtalloc** (LGPL-3.0-or-later), plus
Alpine Linux minirootfs 3.24.3 (a collection of packages: busybox, apk-tools, musl and others, mostly GPL-2.0-only / MIT;
exact per-package licenses are in the rootfs under `/lib/apk/db/installed`).

Corresponding source:
- proot 5.1.107.101 (Termux packaging): https://github.com/termux/proot-packages and upstream https://github.com/proot-me/proot
- libtalloc 2.5.0: https://www.samba.org/ftp/talloc/ (Termux packaging: https://github.com/termux/termux-packages)
- libandroid-shmem 0.7: https://github.com/termux/libandroid-shmem
- Alpine packages: https://git.alpinelinux.org/aports/ and https://dl-cdn.alpinelinux.org/alpine/v3.24/main/

If those locations become unavailable, you may request the corresponding source from the project owner for three years
from the distribution date of the binary, as GPL-2.0 section 3(b) requires. Full license texts: `LICENSES/`.

The only change made to any binary: `patchelf --remove-rpath` and one `--replace-needed` (see
`android/app/src/full/jniLibs/arm64-v8a/README.md`). The app only executes these programs; it does not link them into its own code.
