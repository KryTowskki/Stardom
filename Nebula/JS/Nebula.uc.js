// ==UserScript==
// @name           nebula-core.uc.js
// @description    Central engine for Nebula (Cleaned & Lightweight Version)
// @author         JustAdumbPrsn
// @version        v3.5
// @include        main
// @grant          none
// ==/UserScript==

(function() {
  'use strict';

  if (window.Nebula) {
    try { window.Nebula.destroy(); } catch {}
  }

  window.Nebula = {
    _modules: [],
    _initialized: false,

    logger: {
      _prefix: '[Nebula]',
      log(msg) { console.log(`${this._prefix} ${msg}`); },
      warn(msg) { console.warn(`${this._prefix} ${msg}`); },
      error(msg) { console.error(`${this._prefix} ${msg}`); }
    },

    runOnLoad(callback) {
      if (document.readyState === 'complete') callback();
      else document.addEventListener('DOMContentLoaded', callback, { once: true });
    },

    register(ModuleClass) {
      const name = ModuleClass?.name || 'UnnamedModule';
      if (!ModuleClass) {
        this.logger.warn(`Module "${name}" is not defined, skipping registration.`);
        return;
      }
      if (this._modules.find(m => m._name === name)) {
        this.logger.warn(`Module "${name}" already registered.`);
        return;
      }

      let instance;
      try {
        instance = new ModuleClass();
      } catch (err) {
        this.logger.error(`Module "${name}" failed to construct:\n${err}`);
        return;
      }

      instance._name = name;
      this._modules.push(instance);

      if (this._initialized && typeof instance.init === 'function') {
        try {
          instance.init();
        } catch (err) {
          this.logger.error(`Module "${name}" failed to init:\n${err}`);
        }
      }
    },

    getModule(name) {
      return this._modules.find(m => m._name === name);
    },

    observePresence(selector, attrName) {
      const update = () => {
        const found = !!document.querySelector(selector);
        document.documentElement.toggleAttribute(attrName, found);
      };
      const observer = new MutationObserver(update);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      update();
      return observer;
    },

    init() {
      this.logger.log('⏳ Initializing core...');
      this._initialized = true;
      this.runOnLoad(() => {
        this._modules.forEach(m => {
          try {
            m.init?.();
          } catch (err) {
            this.logger.error(`Module "${m._name}" failed to init:\n${err}`);
          }
        });
      });
      window.addEventListener('unload', () => this.destroy(), { once: true });
    },

    destroy() {
      this._modules.forEach(m => {
        try {
          m.destroy?.();
        } catch (err) {
          this.logger.error(`Module "${m._name}" failed to destroy:\n${err}`);
        }
      });
      this.logger.log('🧹 All modules destroyed.');
      delete window.Nebula;
    },

    debug: {
      listModules() {
        return Nebula._modules.map(m => m._name || 'Unnamed');
      },
      destroyModule(name) {
        const mod = Nebula._modules.find(m => m._name === name);
        try {
          mod?.destroy?.();
        } catch (err) {
          Nebula.logger.error(`Module "${name}" failed to destroy:\n${err}`);
        }
      },
      reload() {
        Nebula.destroy();
        location.reload();
      }
    }
  };

  // ========== NebulaPolyfillModule ==========
  class NebulaPolyfillModule {
    constructor() {
      this.root = document.documentElement;
      this.compactObserver = null;
      this.modeObserver = null;

      this.updateFaviconColor = this.updateFaviconColor.bind(this);
    }

    async init() {
      if (!window.gBrowser) {
        await new Promise(resolve => {
          const check = setInterval(() => {
            if (window.gBrowser?.tabContainer) {
              clearInterval(check);
              resolve();
            }
          }, 50);
        });
      }

      // Compact mode detection
      this.compactObserver = Nebula.observePresence(
        '[zen-compact-mode="true"]',
        "nebula-compact-mode"
      );

      // Toolbar mode detection
      this.modeObserver = new MutationObserver(() => this.updateToolbarModes());
      this.modeObserver.observe(this.root, { attributes: true });
      this.updateToolbarModes();

      // Favicon color detection
      gBrowser.tabContainer.addEventListener("TabSelect", this.updateFaviconColor);
      gBrowser.tabContainer.addEventListener("TabAttrModified", this.updateFaviconColor);

      this.updateFaviconColor();
      Nebula.logger.log("✅ [Polyfill] Detection active.");
    }

    updateToolbarModes() {
      const hasSidebar = this.root.hasAttribute("zen-sidebar-expanded");
      const isSingle = this.root.hasAttribute("zen-single-toolbar");

      this.root.toggleAttribute("nebula-single-toolbar", isSingle);
      this.root.toggleAttribute("nebula-multi-toolbar", hasSidebar && !isSingle);
      this.root.toggleAttribute("nebula-collapsed-toolbar", !hasSidebar && !isSingle);
    }

    async updateFaviconColor(e) {
      if (e?.type === "TabAttrModified" && !e.detail.changed.includes("image")) return;

      const tab = gBrowser.selectedTab;
      const iconUrl = tab?.getAttribute("image");
      if (!iconUrl) return;

      if (this._faviconTimeout) clearTimeout(this._faviconTimeout);
      this._faviconTimeout = setTimeout(async () => {
        try {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = iconUrl;
          await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });

          const size = 16;
          if (!this._faviconCanvas) {
            this._faviconCanvas = document.createElement("canvas");
            this._faviconCanvas.width = size;
            this._faviconCanvas.height = size;
            this._faviconCtx = this._faviconCanvas.getContext("2d");
          }

          const ctx = this._faviconCtx;
          ctx.clearRect(0, 0, size, size);
          ctx.drawImage(img, 0, 0, size, size);

          const data = ctx.getImageData(0, 0, size, size).data;
          const counts = [];

          for (let i = 0; i < data.length; i += 4) {
            const [r, g, b, a] = [data[i], data[i+1], data[i+2], data[i+3]];
            if (a < 128) continue;
            const key = `${r & 0xFC},${g & 0xFC},${b & 0xFC}`;
            const index = counts.findIndex(c => c.key === key);
            if (index >= 0) counts[index].freq++;
            else counts.push({ key, r, g, b, freq: 1 });
          }

          let best = null;
          let brightCandidate = null;

          for (let c of counts) {
            const hsl = this.rgbToHsl(c.r, c.g, c.b);
            const vibrancy = hsl.s * (1 - Math.abs(0.5 - hsl.l) * 2);
            const brightness = (0.299*c.r + 0.587*c.g + 0.114*c.b) / 255;
            const score = c.freq * vibrancy * brightness;

            if (!best || score > best.score) best = { ...c, score, brightness, hsl };
            if (brightness > 0.5) {
              if (!brightCandidate || score > brightCandidate.score) brightCandidate = { ...c, score, brightness, hsl };
            }
          }

          if (best && (best.r + best.g + best.b) < 300 && brightCandidate) best = brightCandidate;

          if (best) {
            let { r, g, b, hsl } = best;
            const sum = r + g + b;
            if (sum < 180) {
              let newL = Math.max(hsl.l, 0.4);
              newL = Math.min(newL * 1.6, 0.8);
              let newS = Math.min(hsl.s * 1.2, 1);
              ({ r, g, b } = this.hslToRgb(hsl.h, newS, newL));
            }

            const finalColor = `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
            this.root.style.setProperty("--nebula-selected-favicon-color", finalColor);
          }

        } catch(err) {
          console.error("[NebulaPolyfill] Favicon color error:", err);
        }
      }, 100);
    }

    hslToRgb(h, s, l) {
      let r, g, b;
      if (s === 0) {
        r = g = b = l;
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
      }
      return { r: r*255, g: g*255, b: b*255 };
    }

    rgbToHsl(r, g, b) {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;

      if (max === min) {
        h = s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
      }
      return { h, s, l };
    }

    destroy() {
      this.compactObserver?.disconnect();
      this.modeObserver?.disconnect();

      if (window.gBrowser) {
        gBrowser.tabContainer.removeEventListener("TabSelect", this.updateFaviconColor);
        gBrowser.tabContainer.removeEventListener("TabAttrModified", this.updateFaviconColor);
      }

      this.root.removeAttribute("nebula-single-toolbar");
      this.root.removeAttribute("nebula-multi-toolbar");
      this.root.removeAttribute("nebula-collapsed-toolbar");

      Nebula.logger.log("🧹 [Polyfill] Destroyed.");
    }
  }

  // ========== NebulaGradientSliderModule ==========
  class NebulaGradientSliderModule {
    constructor() {
      this.root = document.documentElement;
      this.gradientSlider = null;
      this._patched = false;
      this._sliderHandler = this.sync.bind(this);
      this._origMethods = new WeakMap();
    }

    init() {
      this._waitFor(() => document.querySelector("#PanelUI-zen-gradient-generator-opacity"), (slider) => {
        this.gradientSlider = slider;
        slider.min = 0.0;
        slider.addEventListener("input", this._sliderHandler);

        this.sync();
        this._patchThemePicker();
      });
    }

    _waitFor(fn, callback, maxRetries = 40) {
      let retries = maxRetries;
      const tryFind = () => {
        const el = fn();
        if (el) return callback(el);
        if (retries-- > 0) {
          requestAnimationFrame(tryFind);
        } else {
          Nebula.logger.error("❌ [GradientSlider] Target not found.");
        }
      };
      tryFind();
    }

    sync() {
      if (!this.gradientSlider) return;
      const val = +this.gradientSlider.value;
      this.root.style.setProperty("--nebula-gradient-opacity", val === 0 ? "0" : null);
    }

    _patchThemePicker() {
      if (this._patched) return;

      this._waitFor(
        () => window.nsZenThemePicker?.prototype || window.browser?.gZenThemePicker?.constructor?.prototype,
        (proto) => {
          if (!proto?.blendWithWhiteOverlay) return;

          this._origMethods.set(proto, proto.blendWithWhiteOverlay);
          const moduleInstance = this;

          proto.blendWithWhiteOverlay = function(baseColor, opacity) {
            const val = +moduleInstance.gradientSlider?.value ?? opacity;
            if (val === 0) {
              if (Array.isArray(baseColor)) {
                return `rgba(${baseColor.join(",")},0)`;
              }
              if (typeof baseColor === "string" && baseColor.startsWith("rgb")) {
                return baseColor.replace(/rgb(a)?\(([^)]+)\)/, "rgba($2, 0)");
              }
              return "rgba(0,0,0,0)";
            }
            return moduleInstance._origMethods.get(proto).call(this, baseColor, opacity);
          };

          this._patched = true;
          Nebula.logger.log("✅ [GradientSlider] Patched blendWithWhiteOverlay");
        }
      );
    }

    destroy() {
      if (this.gradientSlider) {
        this.gradientSlider.removeEventListener("input", this._sliderHandler);
        this.gradientSlider = null;
      }

      if (this._patched) {
        const proto = window.nsZenThemePicker?.prototype || window.browser?.gZenThemePicker?.constructor?.prototype;
        if (proto && this._origMethods.has(proto)) {
          proto.blendWithWhiteOverlay = this._origMethods.get(proto);
          this._origMethods.delete(proto);
        }
        this._patched = false;
      }

      this.root.style.removeProperty("--nebula-gradient-opacity");
      Nebula.logger.log("🧹 [GradientSlider] Destroyed");
    }
  }

  // Register Only Necessary Modules
  Nebula.register(NebulaPolyfillModule);
  Nebula.register(NebulaGradientSliderModule);

  // Start engine
  Nebula.init();
})();