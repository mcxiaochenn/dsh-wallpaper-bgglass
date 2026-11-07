# dsh-wallpaper-bgglass

[英文说明 / English](README.en.md)

![check](https://github.com/mcxiaochenn/dsh-wallpaper-bgglass/actions/workflows/check.yml/badge.svg)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web GUI 换本地壁纸，并把侧边栏、顶栏、对话框调成一套可调的毛玻璃。

左侧栏会多一个「壁纸」入口：选一张本地图片作为页面背景，壁纸本身有独立的不透明度和高斯模糊；界面元素可以逐个调，也可以一键统一调。安装即用，内置一张默认壁纸。

> 适配 DSH 0.2.2-rc.1（desktop profile 实测）。实现依赖宿主的 DOM 契约，大版本升级后若玻璃效果失效，先看下面的「实现原理」。

## 特性

- 左侧栏「壁纸」入口，中间列是完整的壁纸设置页
- 本地图片：选择文件或直接拖进页面；存在浏览器 IndexedDB，不上传、不联网
- 壁纸本身：不透明度（向主题底色混合）+ 高斯模糊（canvas 预渲染，滑块按显示像素换算）
- 毛玻璃表面，每项独立可调：**侧边栏**、**顶栏**（Windows 标题栏条 + 会话 header）、**对话框**（含设置面板）
  - 不透明度：100% 保持主题原样，越低越透出壁纸
  - 模糊：背景模糊半径，只模糊壁纸、不糊文字
- **统一调整开关**：打开后两个滑块同时驱动上面三处
- 深浅色自适应：颜色全部取 `--dsw-*` token 快照后用 `color-mix` 混色，不写死颜色
- 内置一张默认壁纸（`assets/default-wallpaper.webp`），首次安装即可用；移除后不会自己回来，也可以随时「使用内置壁纸」
- 默认值就是作者本人的配置：壁纸 65% + 模糊 8px；界面元素统一 0% + 25px
- 中英双语界面，跟随 DSH 语言

## 安装

要求：DSH 0.2.0-rc.1 及以上，profile 里包含 Web GUI（`dsh-web-app`）。

### 从 npm 安装（推荐）

```text
plugin_manager install_bundle dsh-wallpaper-bgglass
```

> 仓库名和 npm 包名统一为 `dsh-wallpaper-bgglass`；早期的 `dsh-wallpaper-bg` / `dsh-wallpaper-glass` 两个名字在 npm 上分别被其他插件占用。

安装完刷新页面（桌面端 `Ctrl+R`，必要时 `Ctrl+Shift+R`）。插件管理页里会显示「壁纸 / Wallpaper」。

### 中国大陆镜像加速

插件管理器在 profile 目录里跑 pnpm，会读取你本机的 npm/pnpm registry 配置。访问 npm 官方源慢或超时，先切国内镜像再重试：

```powershell
# npm
npm config set registry https://registry.npmmirror.com

# 或者 pnpm
pnpm config set registry https://registry.npmmirror.com
```

然后重新执行 `plugin_manager install_bundle dsh-wallpaper-bgglass`。

想只对这次安装生效，也可以在 profile 目录写一个 `.npmrc`：

```ini
registry=https://registry.npmmirror.com
```

镜像只影响下载；插件本身不联网，壁纸图片也只存在本机浏览器里。

### 从源码安装（开发）

```powershell
git clone https://github.com/mcxiaochenn/dsh-wallpaper-bgglass.git
```

把**目录**交给插件管理器（绝对路径）：

```text
plugin_manager install_bundle C:\path\to\dsh-wallpaper-bgglass
```

本地目录是 `link:` 方式安装，改完代码刷新页面即生效，不用重装。

### 卸载

```text
plugin_manager remove_bundle dsh-wallpaper-bgglass
```

## 使用

1. 点左侧栏的壁纸图标，打开壁纸页。
2. 「选择图片」挑一张本地图片，或直接把图片拖进面板。
3. 拖动「壁纸不透明度」「壁纸模糊」调背景观感。
4. 在「界面元素」里分别调侧边栏、顶栏、对话框；想一次改完就打开「统一调整所有界面元素」。
5. 不想要了可以「移除壁纸」；想换回内置图就点「使用内置壁纸」。

去掉壁纸后，界面元素设置会保留，但只有存在壁纸时才生效。

## 默认值与内置壁纸

- 默认设置：壁纸 65% / 模糊 8px，统一调整开启，界面元素 0% / 25px。
- 内置壁纸随包分发，只作为首次安装的默认背景（作者自用图）。MIT 协议只覆盖代码，图片本身按原作者版权处理；想换成自己的图，替换 `assets/default-wallpaper.webp`（Host 路由会按文件内容直接返回）。

## 存储

| 内容 | 位置 |
| --- | --- |
| 用户选择的图片 | 浏览器 IndexedDB：`dsh-wallpaper` / `assets` / `current` |
| 全部设置 | 浏览器 localStorage：`dsh-wallpaper/settings` |
| 内置壁纸 | 插件包内 `assets/default-wallpaper.webp`，由 Host 路由提供 |

存储键名沿用项目早期名字（`dsh-wallpaper`）以保持升级后旧数据可读。图片属于当前 origin：用 `127.0.0.1` 和 `localhost` 打开同一个 DSH 会看到不同的存储。

## 实现原理

DSH 的 Web GUI 没有官方的壁纸扩展点，这里全部落在宿主真实的 DOM 契约上：

| 目标 | 钩子 | 做法 |
| --- | --- | --- |
| 页面背景 | `:has(> [data-shell-overlay])`（唯一的 shell frame） | 以图层方式画壁纸 + 主题底色做 scrim，同时把 frame 内的 `--dsw-alias-bg-base` 置为 `transparent`，让中间列/base 表面透出壁纸 |
| 侧边栏 | `:has(> [data-slot="sidebar"])`（侧边栏列） | 覆盖该列的 `--dsw-specific-sidebar-fill` 为半透明色，并用 `::before` 做背景模糊 |
| 顶栏 | `html[data-windows-titlebar]` 下 frame 的 `::before`；Web 模式下的 `[data-slot="conversation.header"] header` | 同上，标题栏条与会话 header 共享一套数值 |
| 对话框 | `[role="dialog"][aria-modal="true"]` | 宿主 modal 和设置面板都走这个 role；半透明底色 + `::before` 背景模糊 |
| 内置壁纸 | Host 路由 `GET /api/dsh-wallpaper-bgglass/default` | 直接返回包内 `assets/default-wallpaper.webp`，不往 JS 里塞 base64 |

几个关键决定：

- **颜色来自 token**：在 `body` 上把 `--dsw-alias-bg-base`、`--dsw-specific-sidebar-fill`、`--dsw-alias-bg-layer-2` 快照成自定义属性，再 `color-mix(..., transparent)` 出半透明色，所以深浅色切换、第三方主题都跟着走。
- **模糊层必须在内容下面**：`isolation: isolate` + `::before { z-index: -1 }`。少了这一步，定位层会盖在内容上方，连文字一起糊掉。
- **壁纸模糊是预渲染**：CSS `background-image` 不能直接 `filter`，所以用 canvas 的 `ctx.filter = blur()` 画一张模糊图；半径按 `background-size: cover` 的缩放比例换算，让滑块数值接近屏幕上的视觉像素。
- **内置壁纸由 Host 路由提供**：Client 首次没有本地图片时取它；路由和 DSH 的 Web 服务同源，DSH 以 loopback 运行时不会额外暴露。

## 兼容性与限制

- 只在 DSH 0.2.2-rc.1 的 desktop profile 实测；宿主 DOM/class 结构变化可能导致毛玻璃失效（壁纸本身受影响较小）。
- 图片上限 32 MB；模糊版本的渲染画布上限 1920×1440，避免大图卡渲染进程。
- 浏览器禁用 IndexedDB 时壁纸只在当前会话有效。
- 第三方主题若重定义上面用到的 token，毛玻璃观感会随主题变化，这是预期行为。
- 仓库名与 npm 包名一致：`dsh-wallpaper-bgglass`。

## 开发

```powershell
npm run check    # 清单、文件、patch、locale、默认图片、客户端语法自检（零依赖）
npm pack --dry-run   # 看 npm 包内容
```

仓库只包含插件本体，没有构建步骤；改 `client.js`（浏览器侧）或 `index.js`（Host 侧）后刷新页面即可，Host 侧改动需要重启 DSH 才会重新加载。

CI（`.github/workflows/check.yml`）跑 `node --check` 和 `npm run check`。

### 发布到 npm（staged publishing）

npm 账号需要先开启 2FA。发布走 npm 的暂存审批流程，机器人只负责上传、人来确认：

1. bump `package.json` 版本，提交并推送。
2. 发 GitHub Release（或手动 `gh workflow run publish.yml`）。workflow 用仓库 Secret `NPM_TOKEN`（Granular token，权限选 **Read and write (stage only)**）执行 `npm stage publish --provenance`，把版本放进暂存区。
3. 本地审批（需要 OTP）：

```powershell
npx npm@latest stage list
npx npm@latest stage approve <stage-id> --registry=https://registry.npmjs.org
npx npm@latest stage reject <stage-id> --registry=https://registry.npmjs.org   # 不想要就拒掉
```

审批通过后才正式发布（`npm stage approve` 要求账号已开 2FA，会走浏览器验证或 `--otp`）。`npm stage` 需要 npm ≥ 12，workflow 里会先 `npm install -g npm@latest`。

本地直接发布（比如首次创建包）就是常规的 `npm publish --access public`，npm 会要求 2FA 验证；发布前会跑 `prepublishOnly` 里的自检。

## License

MIT © 2026 辰渊尘（[mcxiaochenn](https://github.com/mcxiaochenn)）

内置壁纸 `assets/default-wallpaper.webp` 为作者自用图，不包含在 MIT 授权内。
