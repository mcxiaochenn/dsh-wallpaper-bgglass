// dsh-wallpaper — browser half.
//
// A sidebar panel that turns a local image into the DSH page background:
//
//   · the panel lists one wallpaper (picked from disk, or dropped on the page)
//   · the wallpaper gets an opacity and a gaussian-blur setting
//   · sidebar, top bar and dialogs become glass surfaces with their own
//     fill opacity and backdrop blur, each adjustable on its own
//   · image and settings survive reloads (IndexedDB + localStorage)
//
// The background is pure CSS: the shell frame (the element that owns the
// `[data-shell-overlay]` child) gets the image as a background layer and a
// scrim built from the palette's base colour, so the opacity always blends
// toward the theme instead of toward an unknown canvas colour. Glass surfaces
// override the palette tokens they already paint with, so the host keeps
// owning layout, radii, borders and content.
window.__ModuleLoader__.load({
  id: 'dsh-wallpaper-bgglass',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useRef, useState, useSyncExternalStore } = React;

    /** Main-panel id, also the sidebar.panellist cell id. */
    const PANEL_ID = 'dsh-wallpaper-bgglass';
    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-wallpaper-bgglass';
    /** Marker on the injected stylesheet, so HMR cannot stack duplicates. */
    const STYLE_ID = 'dsh-wallpaper-bgglass/styles.css';
    // Storage identity predates the public project name: keep it stable so a
    // wallpaper picked before this rename keeps loading after an upgrade.
    /** localStorage key for the settings document (JSON). */
    const SETTINGS_KEY = 'dsh-wallpaper/settings';
    /** Legacy key: opacity alone, before the settings document existed. */
    const LEGACY_OPACITY_KEY = 'dsh-wallpaper/opacity';
    const DB_NAME = 'dsh-wallpaper';
    const STORE_NAME = 'assets';
    const RECORD_KEY = 'current';
    /** Host route serving the bundled fallback wallpaper. */
    const DEFAULT_ROUTE = '/api/dsh-wallpaper-bgglass/default';
    /** Refuse absurd files rather than freezing the renderer on decode. */
    const MAX_BYTES = 32 * 1024 * 1024;
    /** Canvas caps for the blurred rendition. */
    const BLUR_RENDER_WIDTH = 1920;
    const BLUR_RENDER_HEIGHT = 1440;

    /**
     * Shipped defaults: the author's own configuration (wallpaper at 65 % with
     * an 8 px blur, every UI surface fully transparent behind a 25 px backdrop
     * blur). Users change any of them in the panel; the values persist locally.
     */
    const DEFAULT_SETTINGS = Object.freeze({
      /** Wallpaper visibility (percent). 100 = full image, 0 = base colour only. */
      opacity: 65,
      /** Gaussian blur of the wallpaper itself (CSS pixels). */
      blur: 8,
      /** One set of values for every UI surface instead of the per-surface ones. */
      uniform: true,
      uniformOpacity: 0,
      uniformBlur: 25,
      /** Sidebar column fill opacity and backdrop blur. */
      sidebarOpacity: 0,
      sidebarBlur: 25,
      /** Top bar (window caption row, conversation header) fill opacity and blur. */
      topbarOpacity: 0,
      topbarBlur: 25,
      /** Modal dialogs and the settings panel fill opacity and backdrop blur. */
      dialogOpacity: 0,
      dialogBlur: 25,
      /** True once the user removed the bundled wallpaper; it must not come back. */
      defaultCleared: false,
    });

    const NUMERIC_KEYS = Object.keys(DEFAULT_SETTINGS)
      .filter((key) => key !== 'uniform' && key !== 'defaultCleared');

    // ---- styles -----------------------------------------------------------
    const CSS = [
      // Snapshot the palette colours on `body`: custom properties compute there
      // (the token sheet declares its palettes on body and its dark override on
      // body[data-ds-dark-theme]), so the frame inherits concrete colours even
      // after the local bg-base override below turns base surfaces transparent.
      'body{',
      '--dsh-wallpaper-base:var(--dsw-alias-bg-base,#151517);',
      '--dsh-wallpaper-page-fill:var(--dsw-alias-bg-base,#151517);',
      '--dsh-wallpaper-sidebar-fill:var(--dsw-specific-sidebar-fill,#f9fafb);',
      '--dsh-wallpaper-dialog-fill:var(--dsw-alias-bg-layer-2,#fff);',
      '}',
      // The shell frame is the only element with a direct [data-shell-overlay]
      // child. Painting there (instead of the document body) keeps the wallpaper
      // under every column; the local bg-base override makes the centre column
      // and every base surface reveal the frame behind it.
      'html[data-dsh-wallpaper="on"] :has(> [data-shell-overlay]){',
      '--dsw-alias-bg-base:transparent;',
      'background-color:var(--dsh-wallpaper-base)!important;',
      'background-image:linear-gradient(color-mix(in srgb,var(--dsh-wallpaper-base) var(--dsh-wallpaper-scrim-alpha,65%),transparent),color-mix(in srgb,var(--dsh-wallpaper-base) var(--dsh-wallpaper-scrim-alpha,65%),transparent)),var(--dsh-wallpaper-image,none)!important;',
      'background-position:center center!important;',
      'background-size:cover!important;',
      'background-repeat:no-repeat!important;',
      '}',
      // Glass surfaces paint through the palette token the host already uses,
      // and the ::before layer supplies backdrop blur plus (for panels that do
      // not paint a token-backed fill) the translucent fill itself.
      'html[data-dsh-wallpaper="on"] :has(> [data-slot="sidebar"]){',
      'position:relative;isolation:isolate;',
      'background-color:transparent!important;',
      '--dsw-specific-sidebar-fill:color-mix(in srgb,var(--dsh-wallpaper-sidebar-fill) var(--dsh-wallpaper-sidebar-alpha,100%),transparent);',
      '}',
      // z-index:-1 keeps the blur layer above the column background but below
      // the sidebar content, so the wallpaper blurs and the text does not.
      'html[data-dsh-wallpaper="on"] :has(> [data-slot="sidebar"])::before{',
      'content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;',
      'backdrop-filter:var(--dsh-wallpaper-sidebar-backdrop,none);',
      '}',
      'html[data-dsh-wallpaper="on"] [data-slot="conversation.header"] header{',
      'position:relative;isolation:isolate;background-color:transparent!important;',
      '}',
      'html[data-dsh-wallpaper="on"] [data-slot="conversation.header"] header::before{',
      'content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;',
      'background-color:color-mix(in srgb,var(--dsh-wallpaper-page-fill) var(--dsh-wallpaper-topbar-alpha,100%),transparent);',
      'backdrop-filter:var(--dsh-wallpaper-topbar-backdrop,none);',
      '}',
      // Windows draws its caption row through the frame pseudo-element.
      'html[data-dsh-wallpaper="on"][data-windows-titlebar] :has(> [data-shell-overlay])::before{',
      'background-color:color-mix(in srgb,var(--dsh-wallpaper-sidebar-fill) var(--dsh-wallpaper-topbar-alpha,100%),transparent)!important;',
      'backdrop-filter:var(--dsh-wallpaper-topbar-backdrop,none);',
      '}',
      // Host modal dialogs and the settings panel: role=dialog + aria-modal.
      'html[data-dsh-wallpaper="on"] [role="dialog"][aria-modal="true"]{',
      'position:relative;isolation:isolate;background-color:transparent!important;',
      '}',
      'html[data-dsh-wallpaper="on"] [role="dialog"][aria-modal="true"]::before{',
      'content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;',
      'background-color:color-mix(in srgb,var(--dsh-wallpaper-dialog-fill) var(--dsh-wallpaper-dialog-alpha,100%),transparent);',
      'backdrop-filter:var(--dsh-wallpaper-dialog-backdrop,none);',
      '}',
      // ---- page -----------------------------------------------------------
      '.dwp_page{box-sizing:border-box;display:flex;flex:1 1 auto;flex-direction:column;min-height:0;width:100%;overflow:auto;padding:28px 32px 48px}',
      '.dwp_inner{display:flex;flex-direction:column;gap:18px;width:100%;max-width:760px;margin:0 auto}',
      '.dwp_head{display:flex;flex-direction:column;gap:4px}',
      '.dwp_title{margin:0;font-size:20px;line-height:28px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dwp_sub{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
      '.dwp_card{display:flex;flex-direction:column;gap:16px;padding:18px;border-radius:var(--dsw-radius-lg,12px);border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);transition:border-color .15s ease}',
      '.dwp_cardDrop{border-color:var(--dsw-alias-brand-primary)}',
      '.dwp_cardTitle{margin:0;font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dwp_cardHint{margin:0;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary)}',
      '.dwp_row{display:flex;align-items:center;gap:16px;min-width:0}',
      '.dwp_thumbWrap{flex:none}',
      '.dwp_thumb{display:block;width:168px;height:95px;object-fit:cover;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.dwp_thumbEmpty{display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}',
      '.dwp_meta{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.dwp_metaTitle{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);word-break:break-all}',
      '.dwp_metaHint{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary)}',
      '.dwp_actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
      '.dwp_btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 14px;border-radius:var(--dsw-radius-md,8px);border:.5px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}',
      '.dwp_btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dwp_btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}',
      '.dwp_btnPrimary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}',
      '.dwp_btnPrimary:hover{background:var(--dsw-alias-brand-primary);filter:brightness(.96)}',
      '.dwp_file{display:none}',
      '.dwp_controls{display:flex;flex-direction:column;gap:12px}',
      '.dwp_control{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.dwp_controlHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px}',
      '.dwp_controlLabel{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.dwp_controlValue{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dwp_range{width:100%;accent-color:var(--dsw-alias-brand-primary);margin:0}',
      '.dwp_range:disabled{opacity:.5;cursor:default}',
      '.dwp_uniform{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 0 14px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.dwp_uniformCopy{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.dwp_switch{box-sizing:border-box;position:relative;flex:none;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}',
      '.dwp_switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}',
      '.dwp_switch:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}',
      '.dwp_switchThumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-switch-thumb,var(--dsw-alias-label-primary-foreground));transition:transform .12s ease}',
      '.dwp_switch[aria-checked="true"] .dwp_switchThumb{background:var(--dsw-alias-label-primary-foreground,#fff);transform:translateX(16px)}',
      '.dwp_surfaces{display:flex;flex-direction:column;gap:4px}',
      '.dwp_surface{display:grid;grid-template-columns:104px minmax(0,1fr) minmax(0,1fr);align-items:center;gap:16px;padding:12px 0;border-top:.5px solid var(--dsw-alias-border-l1)}',
      '.dwp_surface:first-child{border-top:none;padding-top:0}',
      '.dwp_surfaceName{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '@media (max-width:640px){.dwp_surface{grid-template-columns:minmax(0,1fr);align-items:stretch;gap:10px}.dwp_surfaceName{font-weight:600}}',
      '.dwp_error{margin:0;font-size:12.5px;line-height:19px;color:var(--dsw-alias-state-error-primary)}',
      '.dwp_icon{display:block;flex:none}',
    ].join('\n');

    // ---- dictionaries -----------------------------------------------------
    const zh = {
      'panel.label': '壁纸',
      'page.title': '壁纸',
      'page.subtitle': '选择本地磁盘上的图片作为 DSH 页面背景，并分别调整壁纸与界面元素的不透明度、模糊程度。',
      'page.choose': '选择图片',
      'page.replace': '更换图片',
      'page.clear': '移除壁纸',
      'page.empty': '还没有设置壁纸',
      'page.untitled': '本地图片',
      'page.defaultWallpaper': '内置壁纸',
      'page.useDefault': '使用内置壁纸',
      'page.hint': '支持 PNG、JPEG、WebP、GIF 等格式，也可以把图片直接拖进本页；图片保存在当前浏览器中。',
      'page.opacity': '壁纸不透明度',
      'page.blur': '壁纸模糊',
      'surfaces.title': '界面元素',
      'surfaces.hint': '这些元素覆盖在壁纸之上；不透明度越低越透出壁纸，背景模糊用于柔化透出的画面。',
      'surfaces.sidebar': '侧边栏',
      'surfaces.topbar': '顶栏',
      'surfaces.dialog': '对话框',
      'surfaces.uniform': '统一调整所有界面元素',
      'surfaces.uniformHint': '开启后，用两个滑块同时设置侧边栏、顶栏和对话框。',
      'common.opacity': '不透明度',
      'common.blur': '模糊',
      'error.notImage': '请选择图片文件。',
      'error.tooLarge': '图片过大（上限 32 MB）。',
      'error.defaultFailed': '内置壁纸加载失败，请选择本地图片。',
      'error.loadFailed': '读取已保存的壁纸失败。',
      'error.saveFailed': '保存壁纸失败，本次打开期间仍会生效。',
    };
    const en = {
      'panel.label': 'Wallpaper',
      'page.title': 'Wallpaper',
      'page.subtitle': 'Use an image from local disk as the DSH page background, and tune the wallpaper and the UI surfaces separately.',
      'page.choose': 'Choose image',
      'page.replace': 'Replace image',
      'page.clear': 'Remove wallpaper',
      'page.empty': 'No wallpaper selected',
      'page.untitled': 'Local image',
      'page.defaultWallpaper': 'Bundled wallpaper',
      'page.useDefault': 'Use bundled wallpaper',
      'page.hint': 'PNG, JPEG, WebP, or GIF. You can also drop an image on this page; it stays in this browser.',
      'page.opacity': 'Wallpaper opacity',
      'page.blur': 'Wallpaper blur',
      'surfaces.title': 'UI surfaces',
      'surfaces.hint': 'These surfaces sit over the wallpaper: lower opacity to let it through, and blur the backdrop to soften it.',
      'surfaces.sidebar': 'Sidebar',
      'surfaces.topbar': 'Top bar',
      'surfaces.dialog': 'Dialogs',
      'surfaces.uniform': 'Apply to all surfaces',
      'surfaces.uniformHint': 'When on, two sliders drive the sidebar, top bar and dialogs together.',
      'common.opacity': 'Opacity',
      'common.blur': 'Blur',
      'error.notImage': 'Please choose an image file.',
      'error.tooLarge': 'The image is too large (32 MB max).',
      'error.defaultFailed': 'The bundled wallpaper could not be loaded; choose a local image instead.',
      'error.loadFailed': 'Failed to load the saved wallpaper.',
      'error.saveFailed': 'The wallpaper could not be saved; it still applies to this session.',
    };

    // ---- document state ---------------------------------------------------
    let snapshot = Object.freeze({
      ready: false,
      hasImage: false,
      /** True while the shown image is the bundled fallback, not a user file. */
      isDefault: false,
      url: null,
      name: '',
      settings: DEFAULT_SETTINGS,
      error: null,
    });
    const listeners = new Set();
    let currentUrl = null;
    let currentBlob = null;
    let displayToken = 0;
    let blurTimer = null;
    let disposed = false;

    function getSnapshot() {
      return snapshot;
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function readSettings() {
      const settings = { ...DEFAULT_SETTINGS };
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw !== null) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.uniform === 'boolean') settings.uniform = parsed.uniform;
          if (typeof parsed.defaultCleared === 'boolean') settings.defaultCleared = parsed.defaultCleared;
          for (const key of NUMERIC_KEYS) {
            const value = Number(parsed[key]);
            if (Number.isFinite(value)) settings[key] = clamp(Math.round(value), 0, key.endsWith('Blur') ? 40 : 100);
          }
        } else {
          const legacy = Number.parseInt(localStorage.getItem(LEGACY_OPACITY_KEY), 10);
          if (Number.isFinite(legacy)) settings.opacity = clamp(legacy, 0, 100);
        }
      } catch (error) {
        // Unreadable storage just means the defaults.
      }
      return settings;
    }

    function writeSettings() {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot.settings));
      } catch (error) {
        // Not persisted; the current session still uses the new value.
      }
    }

    /** Reflect the current state onto the document root. */
    function syncDocument() {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      const settings = snapshot.settings;
      const backdrop = (px) => (px > 0 ? `blur(${px}px)` : 'none');
      const alphaOf = (value) => (settings.uniform ? settings.uniformOpacity : value);
      const blurOf = (value) => (settings.uniform ? settings.uniformBlur : value);
      root.style.setProperty('--dsh-wallpaper-scrim-alpha', `${100 - settings.opacity}%`);
      root.style.setProperty('--dsh-wallpaper-sidebar-alpha', `${alphaOf(settings.sidebarOpacity)}%`);
      root.style.setProperty('--dsh-wallpaper-sidebar-backdrop', backdrop(blurOf(settings.sidebarBlur)));
      root.style.setProperty('--dsh-wallpaper-topbar-alpha', `${alphaOf(settings.topbarOpacity)}%`);
      root.style.setProperty('--dsh-wallpaper-topbar-backdrop', backdrop(blurOf(settings.topbarBlur)));
      root.style.setProperty('--dsh-wallpaper-dialog-alpha', `${alphaOf(settings.dialogOpacity)}%`);
      root.style.setProperty('--dsh-wallpaper-dialog-backdrop', backdrop(blurOf(settings.dialogBlur)));
      if (snapshot.url === null) {
        root.style.removeProperty('--dsh-wallpaper-image');
        root.removeAttribute('data-dsh-wallpaper');
        return;
      }
      root.style.setProperty('--dsh-wallpaper-image', `url("${snapshot.url}")`);
      root.setAttribute('data-dsh-wallpaper', 'on');
    }

    function publish(patch) {
      if (disposed) return;
      snapshot = Object.freeze({ ...snapshot, ...patch });
      syncDocument();
      for (const listener of [...listeners]) listener();
    }

    function revokeUrl() {
      if (currentUrl !== null) {
        URL.revokeObjectURL(currentUrl);
        currentUrl = null;
      }
    }

    /** Recompute the display URL for the current blob and blur radius. */
    async function refreshImage() {
      const token = ++displayToken;
      const blob = currentBlob;
      if (blob === null) {
        revokeUrl();
        publish({ hasImage: false, url: null });
        return;
      }
      const blur = snapshot.settings.blur;
      let url;
      try {
        url = await renderWallpaper(blob, blur);
      } catch (error) {
        url = URL.createObjectURL(blob);
      }
      if (disposed || token !== displayToken) {
        URL.revokeObjectURL(url);
        return;
      }
      revokeUrl();
      currentUrl = url;
      publish({ hasImage: true, url, error: null });
    }

    /**
     * Object URL for the wallpaper at the requested blur radius. Blur is drawn
     * on a canvas (a background-image cannot be filtered directly); the image is
     * over-painted beyond the canvas edges so the blur never samples transparency,
     * and the radius is divided by the CSS `cover` scale so the slider reads in
     * display pixels rather than source pixels.
     */
    async function renderWallpaper(blob, blurPx) {
      if (!(blurPx > 0) || typeof createImageBitmap !== 'function') return URL.createObjectURL(blob);
      const bitmap = await createImageBitmap(blob);
      try {
        const sourceWidth = Math.max(1, bitmap.width);
        const sourceHeight = Math.max(1, bitmap.height);
        const viewportWidth = Math.max(1, window.innerWidth || sourceWidth);
        const viewportHeight = Math.max(1, window.innerHeight || sourceHeight);
        // background-size: cover grows the image until it fills the viewport.
        const cover = Math.max(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
        const scale = Math.min(1, BLUR_RENDER_WIDTH / sourceWidth, BLUR_RENDER_HEIGHT / sourceHeight);
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const radius = Math.max(0.1, (blurPx / Math.max(cover, 0.05)) * scale);
        const pad = Math.ceil(radius * 2) + 2;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (context === null) return URL.createObjectURL(blob);
        context.filter = `blur(${radius.toFixed(2)}px)`;
        context.drawImage(bitmap, -pad, -pad, width + pad * 2, height + pad * 2);
        const rendered = await new Promise((resolve) => {
          canvas.toBlob((value) => resolve(value), 'image/webp', 0.92);
        });
        return rendered === null ? URL.createObjectURL(blob) : URL.createObjectURL(rendered);
      } finally {
        bitmap.close?.();
      }
    }

    /**
     * Show one image (user file or bundled wallpaper).
     * @param blob - image bytes.
     * @param name - file name to display; empty for the bundled wallpaper.
     * @param isDefault - true when this is the bundled fallback.
     */
    function applyImage(blob, name, isDefault = false) {
      currentBlob = blob;
      publish({ name: name || '', isDefault });
      void refreshImage();
    }

    function setSetting(key, value) {
      if (key === 'uniform') {
        const uniform = value === true;
        if (snapshot.settings.uniform === uniform) return;
        publish({ settings: { ...snapshot.settings, uniform } });
        writeSettings();
        return;
      }
      if (!NUMERIC_KEYS.includes(key)) return;
      const limit = key.endsWith('Blur') ? 40 : 100;
      const next = clamp(Math.round(Number(value)), 0, limit);
      if (!Number.isFinite(next) || snapshot.settings[key] === next) return;
      const settings = { ...snapshot.settings, [key]: next };
      publish({ settings });
      writeSettings();
      if (key === 'blur') {
        if (blurTimer !== null) clearTimeout(blurTimer);
        blurTimer = setTimeout(() => {
          blurTimer = null;
          void refreshImage();
        }, 140);
      }
    }

    // ---- local storage of the image --------------------------------------
    function openDatabase() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('indexedDB is unavailable'));
          return;
        }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    function transact(mode, run) {
      return openDatabase().then((database) => new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let result;
        const request = run(store);
        if (request) request.onsuccess = () => {
          result = request.result;
        };
        transaction.oncomplete = () => {
          database.close();
          resolve(result);
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error);
        };
      }));
    }

    const readRecord = () => transact('readonly', (store) => store.get(RECORD_KEY));
    const writeRecord = (record) => transact('readwrite', (store) => store.put(record, RECORD_KEY));
    const deleteRecord = () => transact('readwrite', (store) => store.delete(RECORD_KEY));

    function isImageFile(file) {
      if (typeof file.type === 'string' && file.type.indexOf('image/') === 0) return true;
      return /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name || '');
    }

    /** Fetch the bundled fallback wallpaper from this plugin's host route. */
    async function loadDefaultWallpaper() {
      const response = await fetch(DEFAULT_ROUTE, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!(blob.size > 0)) throw new Error('empty bundled wallpaper');
      applyImage(blob, '', true);
    }

    /** Load the stored wallpaper (or the bundled fallback) before first render. */
    async function boot() {
      publish({ settings: readSettings() });
      let record;
      try {
        record = await readRecord();
      } catch (error) {
        publish({ error: 'loadFailed' });
      }
      if (disposed) return;
      if (record && record.blob instanceof Blob) {
        applyImage(record.blob, record.name || '');
        publish({ ready: true });
        return;
      }
      if (snapshot.settings.defaultCleared === false) {
        try {
          await loadDefaultWallpaper();
        } catch (error) {
          publish({ error: 'defaultFailed' });
        }
      }
      publish({ ready: true });
    }

    /** Accept one picked or dropped file. */
    function chooseFile(file) {
      if (!file) return;
      if (!isImageFile(file)) {
        publish({ error: 'notImage' });
        return;
      }
      if (file.size > MAX_BYTES) {
        publish({ error: 'tooLarge' });
        return;
      }
      applyImage(file, file.name || '');
      if (snapshot.settings.defaultCleared) {
        publish({ settings: { ...snapshot.settings, defaultCleared: false } });
        writeSettings();
      }
      writeRecord({ blob: file, name: file.name || '', type: file.type || '' }).catch(() => {
        publish({ error: 'saveFailed' });
      });
    }

    /** Show the bundled wallpaper again after the user removed it. */
    async function useDefaultWallpaper() {
      try {
        await loadDefaultWallpaper();
        publish({ settings: { ...snapshot.settings, defaultCleared: false } });
        writeSettings();
      } catch (error) {
        publish({ error: 'defaultFailed' });
      }
    }

    function clearWallpaper() {
      currentBlob = null;
      displayToken += 1;
      revokeUrl();
      const settings = { ...snapshot.settings, defaultCleared: true };
      publish({ hasImage: false, isDefault: false, url: null, name: '', error: null, settings });
      writeSettings();
      deleteRecord().catch(() => {});
    }

    // ---- components -------------------------------------------------------
    function WallpaperIcon({ size = 16 }) {
      return h('svg', {
        className: 'dwp_icon',
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      },
      h('rect', { x: 2.1, y: 3.1, width: 11.8, height: 9.8, rx: 2 }),
      h('circle', { cx: 5.9, cy: 6.6, r: 1.15 }),
      h('path', { d: 'M2.6 11.4 6.2 8.3l2.3 2 2-1.8 2.9 2.9' }));
    }

    function RangeControl({ label, value, min, max, step = 1, unit, onChange }) {
      return h('label', { className: 'dwp_control' },
        h('span', { className: 'dwp_controlHead' },
          h('span', { className: 'dwp_controlLabel' }, label),
          h('span', { className: 'dwp_controlValue' }, `${value}${unit}`)),
        h('input', {
          className: 'dwp_range',
          type: 'range',
          min,
          max,
          step,
          value,
          'aria-label': label,
          onChange: (event) => onChange(Number(event.currentTarget.value)),
        }));
    }

    function SurfaceRow({ name, opacity, blur, onOpacity, onBlur, t }) {
      return h('div', { className: 'dwp_surface' },
        h('span', { className: 'dwp_surfaceName' }, name),
        h(RangeControl, {
          label: t('common.opacity'), value: opacity, min: 0, max: 100, unit: '%',
          onChange: onOpacity,
        }),
        h(RangeControl, {
          label: t('common.blur'), value: blur, min: 0, max: 40, unit: ' px',
          onChange: onBlur,
        }));
    }

    function WallpaperPanel(props) {
      const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
      const inputRef = useRef(null);
      const [dragging, setDragging] = useState(false);
      const t = typeof props.t === 'function' ? props.t : translate;
      const settings = snap.settings;

      const onFile = useCallback((event) => {
        const input = event.currentTarget;
        const file = input.files && input.files[0];
        input.value = '';
        if (file) chooseFile(file);
      }, []);

      const onDrop = useCallback((event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) chooseFile(file);
      }, []);

      const onDragOver = useCallback((event) => {
        event.preventDefault();
        setDragging(true);
      }, []);

      const onDragLeave = useCallback((event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setDragging(false);
      }, []);

      return h('section', {
        className: 'dwp_page',
        onDragOver,
        onDragLeave,
        onDrop,
      },
      h('div', { className: 'dwp_inner' },
        h('header', { className: 'dwp_head' },
          h('h1', { className: 'dwp_title' }, t('page.title')),
          h('p', { className: 'dwp_sub' }, t('page.subtitle'))),
        h('div', { className: 'dwp_card' + (dragging ? ' dwp_cardDrop' : '') },
          h('div', { className: 'dwp_row' },
            h('div', { className: 'dwp_thumbWrap' },
              snap.url === null
                ? h('div', { className: 'dwp_thumb dwp_thumbEmpty' }, h(WallpaperIcon, { size: 24 }))
                : h('img', { className: 'dwp_thumb', src: snap.url, alt: '' })),
            h('div', { className: 'dwp_meta' },
              h('div', { className: 'dwp_metaTitle' },
                snap.hasImage
                  ? (snap.name || (snap.isDefault ? t('page.defaultWallpaper') : t('page.untitled')))
                  : t('page.empty')),
              h('div', { className: 'dwp_metaHint' }, t('page.hint')))),
          h('div', { className: 'dwp_actions' },
            h('button', {
              type: 'button',
              className: 'dwp_btn dwp_btnPrimary',
              onClick: () => { if (inputRef.current !== null) inputRef.current.click(); },
            }, snap.hasImage ? t('page.replace') : t('page.choose')),
            snap.hasImage
              ? h('button', {
                type: 'button',
                className: 'dwp_btn',
                onClick: clearWallpaper,
              }, t('page.clear'))
              : h('button', {
                type: 'button',
                className: 'dwp_btn',
                onClick: () => { void useDefaultWallpaper(); },
              }, t('page.useDefault')),
            h('input', {
              ref: inputRef,
              className: 'dwp_file',
              type: 'file',
              accept: 'image/*',
              onChange: onFile,
              tabIndex: -1,
              'aria-hidden': true,
            })),
          h('div', { className: 'dwp_controls' },
            h(RangeControl, {
              label: t('page.opacity'), value: settings.opacity, min: 0, max: 100, unit: '%',
              onChange: (value) => setSetting('opacity', value),
            }),
            h(RangeControl, {
              label: t('page.blur'), value: settings.blur, min: 0, max: 40, unit: ' px',
              onChange: (value) => setSetting('blur', value),
            })),
          snap.error === null
            ? null
            : h('p', { className: 'dwp_error', role: 'alert' }, t(`error.${snap.error}`))),
        h('div', { className: 'dwp_card' },
          h('div', { className: 'dwp_head' },
            h('h2', { className: 'dwp_cardTitle' }, t('surfaces.title')),
            h('p', { className: 'dwp_cardHint' }, t('surfaces.hint'))),
          h('div', { className: 'dwp_uniform' },
            h('div', { className: 'dwp_uniformCopy' },
              h('span', { className: 'dwp_surfaceName' }, t('surfaces.uniform')),
              h('span', { className: 'dwp_cardHint' }, t('surfaces.uniformHint'))),
            h('button', {
              type: 'button',
              role: 'switch',
              'aria-checked': settings.uniform,
              className: 'dwp_switch',
              'aria-label': t('surfaces.uniform'),
              onClick: () => setSetting('uniform', !settings.uniform),
            }, h('span', { className: 'dwp_switchThumb' }))),
          settings.uniform
            ? h('div', { className: 'dwp_controls' },
              h(RangeControl, {
                label: t('common.opacity'), value: settings.uniformOpacity, min: 0, max: 100, unit: '%',
                onChange: (value) => setSetting('uniformOpacity', value),
              }),
              h(RangeControl, {
                label: t('common.blur'), value: settings.uniformBlur, min: 0, max: 40, unit: ' px',
                onChange: (value) => setSetting('uniformBlur', value),
              }))
            : h('div', { className: 'dwp_surfaces' },
              h(SurfaceRow, {
                name: t('surfaces.sidebar'),
                opacity: settings.sidebarOpacity,
                blur: settings.sidebarBlur,
                onOpacity: (value) => setSetting('sidebarOpacity', value),
                onBlur: (value) => setSetting('sidebarBlur', value),
                t,
              }),
              h(SurfaceRow, {
                name: t('surfaces.topbar'),
                opacity: settings.topbarOpacity,
                blur: settings.topbarBlur,
                onOpacity: (value) => setSetting('topbarOpacity', value),
                onBlur: (value) => setSetting('topbarBlur', value),
                t,
              }),
              h(SurfaceRow, {
                name: t('surfaces.dialog'),
                opacity: settings.dialogOpacity,
                blur: settings.dialogBlur,
                onOpacity: (value) => setSetting('dialogOpacity', value),
                onBlur: (value) => setSetting('dialogBlur', value),
                t,
              })))));
    }

    // Locale subscription captured from the plugin context, so an in-place
    // language switch re-renders the panel instead of freezing the old words.
    let subscribeLocale = () => () => {};
    let localeSnapshot = () => 0;
    /** Fallback translator until the plugin context binds the real one. */
    let translate = (key) => key;

    function installStyles() {
      const existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']');
      if (existing !== null) return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = '@local/dsh-wallpaper';
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => tag.remove();
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        translate = t;

        ctx.effect(
          () => ctx.locale.register(NS, { zh, en }),
          'dsh-wallpaper-bgglass: dictionaries',
        );
        if (typeof ctx.locale.subscribe === 'function' && typeof ctx.locale.getSnapshot === 'function') {
          subscribeLocale = (listener) => ctx.locale.subscribe(listener);
          localeSnapshot = () => ctx.locale.getSnapshot();
        } else if (typeof ctx.on === 'function') {
          subscribeLocale = (listener) => ctx.on('locale/change', listener);
          localeSnapshot = () => (typeof ctx.locale.getLocale === 'function' ? ctx.locale.getLocale() : 0);
        }

        ctx.effect(() => installStyles(), 'dsh-wallpaper-bgglass: stylesheet');

        ctx.effect(() => {
          boot();
          // The blur radius is baked into the rendered image against the current
          // `cover` scale, so a viewport change regenerates it once the resize settles.
          const onResize = () => {
            if (snapshot.settings.blur <= 0) return;
            if (blurTimer !== null) clearTimeout(blurTimer);
            blurTimer = setTimeout(() => {
              blurTimer = null;
              void refreshImage();
            }, 300);
          };
          window.addEventListener('resize', onResize);
          return () => {
            window.removeEventListener('resize', onResize);
            disposed = true;
            if (blurTimer !== null) clearTimeout(blurTimer);
            revokeUrl();
            const root = document.documentElement;
            root.style.removeProperty('--dsh-wallpaper-image');
            for (const name of [
              '--dsh-wallpaper-scrim-alpha',
              '--dsh-wallpaper-sidebar-alpha',
              '--dsh-wallpaper-sidebar-backdrop',
              '--dsh-wallpaper-topbar-alpha',
              '--dsh-wallpaper-topbar-backdrop',
              '--dsh-wallpaper-dialog-alpha',
              '--dsh-wallpaper-dialog-backdrop',
            ]) root.style.removeProperty(name);
            root.removeAttribute('data-dsh-wallpaper');
          };
        }, 'dsh-wallpaper-bgglass: background state');

        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.inject('sidebar.panellist', () => {
          const stopPanel = ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            locale: NS,
          }, WallpaperPanel);
          let stopEntry;
          try {
            stopEntry = ctx.slots.register({
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              label: () => t('panel.label'),
              locale: NS,
            }, WallpaperIcon);
          } catch (error) {
            stopPanel();
            throw error;
          }
          return () => {
            stopEntry();
            stopPanel();
          };
        })), 'dsh-wallpaper-bgglass: sidebar entry and panel');
      },
    };
  },
});
