# Credits

No third-party source code was copied into this repository. The projects below were named in the task brief as references. **They were not read, run or copied from during this build**; the design follows the brief's own specification. Licenses were checked via the GitHub API only.

| Project | License | Use |
|---|---|---|
| nanobrowser (github.com/nanobrowser/nanobrowser) | Apache-2.0 | Referenced in the brief. Not read. Nothing copied. |
| browser-use (github.com/browser-use/browser-use) | MIT | Referenced in the brief. Not read. Nothing copied. |
| cheahjs/free-llm-api-resources | n/a (list; repository not reachable under that name when checked) | Referenced in the brief. Not read. No data copied; model lists are fetched live from providers. |
| capacitorjs.com docs | n/a | Referenced in the brief. Plugin API usage follows the installed package's type definitions. |
| cazala/webgpu-skill | no license file found | Not used or copied. The optional local model uses web-llm instead. |
| REA (morluto/rea) | MIT | Not installed or run. |

Product concepts (persistent memory, chat thread, user-made panels, web-task agent, scheduled tasks, projects, opt-in morning brief,
approval before major actions, never sending passwords/cards to the model) come from the public pages of hark.com and the Claude Duet
article. Their apps, binaries and private APIs were not examined. All names, UI, copy and code here are original.

## Bundled components (full license texts in `LICENSES/`)

| Component | Version | License | Where |
|---|---|---|---|
| React, react-dom | 19.3.1 | MIT | UI |
| Zod | 4.6.7 | MIT | core |
| tldts | 7.4.19 | MIT (`LICENSES/tldts-MIT.txt`) | core |
| fflate | 0.8.3 | MIT (`LICENSES/fflate-MIT.txt`) | Tier 0 zip |
| quickjs-emscripten-core + @jitl/quickjs-singlefile-browser-release-sync | 0.32.0 | MIT (`LICENSES/quickjs-emscripten-MIT.txt`); QuickJS itself is MIT | Tier 0 scripts |
| Capacitor | 8.5.3 | MIT | Android |
| AndroidX (appcompat, core, work, ...) | see `android/variables.gradle` | Apache-2.0 (`LICENSES/Apache-2.0.txt`) | Android |
| @mlc-ai/web-llm (only with `KRISH_LOCAL_MODEL=1`) | 0.2.86 | Apache-2.0 | optional local model |
| proot, proot loader (full flavor) | 5.1.107.101 | GPL-2.0-or-later (`LICENSES/proot-GPL-2.0.txt`, `LICENSES/GPL-2.0.txt`) | Tier 1 |
| libtalloc (full flavor) | 2.5.0 | LGPL-3.0-or-later | Tier 1 |
| libandroid-shmem (full flavor) | 0.7 | BSD-3-Clause (`LICENSES/libandroid-shmem-BSD-3-Clause.txt`) | Tier 1 |
| Alpine Linux minirootfs (full flavor) | 3.24.3 | mixed; mostly GPL-2.0-only and MIT | Tier 1 |
| Electron | 45.0.0 | MIT | desktop |

GPL/LGPL source offer: `SOURCE-OFFER.md`.
