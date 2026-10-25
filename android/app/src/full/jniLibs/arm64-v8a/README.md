# Tier 1 native binaries (aarch64, GPL-2.0 for proot)

Taken unmodified from the Termux package repository (https://packages.termux.dev/apt/termux-main), then relinked with
`patchelf` only to (a) drop the Termux RUNPATH and (b) rename the NEEDED entry `libtalloc.so.2` to `libtalloc.so`
(Android packages native libraries by exact `lib*.so` name).

| Packaged as | Origin (deb) | Upstream license |
|---|---|---|
| libproot.so | proot 5.1.107.101 `usr/bin/proot` | GPL-2.0-or-later |
| libproot_loader.so | proot 5.1.107.101 `usr/libexec/proot/loader` | GPL-2.0-or-later |
| libtalloc.so | libtalloc 2.5.0 `libtalloc.so.2.5.0` | LGPL-3.0-or-later |
| libandroid-shmem.so | libandroid-shmem 0.7 | BSD-3-Clause (LICENSES/libandroid-shmem-BSD-3-Clause.txt) |

Checksums of the files as packaged: SHA256SUMS (this folder). Source: see /SOURCE-OFFER.md.
