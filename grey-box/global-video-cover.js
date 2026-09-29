// ============================================================
// global-video-cover — CSS theater, NO Fullscreen API
// Page: myflixerfree.net/watch/... (servers 1-5 = varying referential iframes)
// Behavior:
//   1. Collapse/hide everything except the stream player (sibling hiding
//      up the ancestor chain), so the stream box becomes full page.
//   2. Stretch player to full viewport (fixed inset 0, 100vw x 100vh).
//   3. Apply blind: dark, opaque, 11vh tall on a 5vh transparent
//      bottom gap, borderless, click-through.
// Toggle: run again -> restores original inline styles.
// Params at top of script (CFG): h height, g gap, o opacity, c color.
// URL params on the script tag: ?box-top=11&box-bottom=5 (numbers = vh).
//   They set CFG.h = "{box-top}vh" and CFG.g = "{box-bottom}vh".
// Runtime overrides: window.__gvcH / __gvcG / __gvcO / __gvcC (win over URL).
// ============================================================
(() => {
  const COVER_ID = "global-video-cover";
  const STATE_KEY = "__gvc2";

  // ================= PARAMS — edit here =================
  const CFG = {
    h: "11vh",     // blind height (number = vh, or e.g. "15%"); URL: ?box-top=; runtime: window.__gvcH
    g: "5vh",      // transparent gap below blind; URL: ?box-bottom=; runtime: window.__gvcG
    o: 1,          // blind opacity 0..1 (transparency); runtime: window.__gvcO
    c: "#1a1a1a"   // blind color; runtime: window.__gvcC
  };
  // ======================================================

  // URL params (e.g. global-video-cover.js?box-top=11&box-bottom=5)
  // override the CFG defaults above; window.__gvc* still wins at runtime.
  try {
    let src = (document.currentScript && document.currentScript.src) || "";
    if (!src) {
      const scripts = document.getElementsByTagName("script");
      for (let i = scripts.length - 1; i >= 0; i -= 1) {
        if (scripts[i].src && scripts[i].src.indexOf("global-video-cover.js") !== -1) {
          src = scripts[i].src;
          break;
        }
      }
    }
    const q = new URL(src, window.location.href).searchParams;
    const top = parseFloat(q.get("box-top"));
    if (isFinite(top)) CFG.h = top + "vh";
    const bottom = parseFloat(q.get("box-bottom"));
    if (isFinite(bottom)) CFG.g = bottom + "vh";
  } catch (e) {}

  // Toggle OFF: restore every inline style we touched.
  // Also cancel a pending observer re-apply: disconnect() alone does not
  // stop an already-scheduled setTimeout, which would otherwise re-apply
  // right after we restore (2nd click removes then re-applies).
  const prev = window[STATE_KEY];
  if (prev) {
    try { prev.observer.disconnect(); } catch (e) {}
    try { clearTimeout(prev.timer); } catch (e) {}
    try {
      for (const [el, css] of prev.styles) {
        try { el.style.cssText = css; } catch (e) {}
      }
    } catch (e) {}
    const old = document.getElementById(COVER_ID);
    if (old) old.remove();
    window[STATE_KEY] = null;
    return;
  }

  // Save-once map: element -> original inline cssText.
  const styles = new Map();
  const save = (el) => {
    if (el && !styles.has(el)) {
      try { styles.set(el, el.style.cssText); } catch (e) {}
    }
  };

  // Blind geometry overrides (set before running):
  // window.__gvcH = height, default "12vh" (number = vh, or "15%").
  // window.__gvcG = bottom gap, default "4vh" (transparent strip below blind).
  const normU = (v, d) => {
    if (v == null) v = d;
    if (typeof v === "number") v += "vh";
    v = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(v)) v += "vh";
    return v;
  };
  const blindH = () => normU(window.__gvcH ?? CFG.h, "12vh");
  const blindG = () => normU(window.__gvcG ?? CFG.g, "4vh");
  const blindO = () => {
    let o = parseFloat(window.__gvcO ?? CFG.o);
    if (!isFinite(o)) o = CFG.o;
    return Math.min(1, Math.max(0, o));
  };
  const blindC = () => window.__gvcC || CFG.c;

  const attachCover = () => {
    if (document.getElementById(COVER_ID) || !document.body) return;
    const d = document.createElement("div");
    d.id = COVER_ID;
    d.style.cssText = "position:fixed;left:0;right:0;bottom:" + blindG() + ";height:" + blindH() + ";background:" + blindC() + ";opacity:" + blindO() + ";z-index:2147483647;pointer-events:none;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;outline:none;display:block;";
    document.body.appendChild(d);
  };

  // Player discovery: works across Server 1..5 referential iframes.
  const findPlayer = () => {
    const iframes = [...document.querySelectorAll("iframe")].filter((f) => {
      try {
        const r = f.getBoundingClientRect();
        return r.width > 200 && r.height > 120 && getComputedStyle(f).display !== "none";
      } catch (e) { return false; }
    });
    if (iframes.length) {
      iframes.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return (rb.width * rb.height) - (ra.width * ra.height);
      });
      return iframes[0];
    }
    const v = document.querySelector("video");
    if (v) return v;
    // Pre-play placeholder (poster + play button svg), e.g. Next.js hero div.
    let best = null, bestArea = 0;
    for (const d of document.querySelectorAll("main div")) {
      try {
        if (!d.querySelector("svg")) continue;
        const r = d.getBoundingClientRect();
        const area = r.width * r.height;
        if (r.width > 300 && area > bestArea) { bestArea = area; best = d; }
      } catch (e) {}
    }
    return best;
  };

  const apply = () => {
    attachCover();
    const box = findPlayer();
    if (!box) return;

    // 1) Collapse everything else: hide siblings at every level up to <body>.
    // 2) Neutralize transform/filter on ancestors (they would break
    //    position:fixed by becoming the containing block).
    let el = box;
    while (el && el !== document.body && el !== document.documentElement) {
      const p = el.parentElement;
      if (!p) break;
      for (const sib of p.children) {
        if (sib !== el && sib.id !== COVER_ID && sib.tagName !== "SCRIPT" && sib.tagName !== "STYLE") {
          save(sib);
          try { sib.style.setProperty("display", "none", "important"); }
          catch (e) { sib.style.display = "none"; }
        }
      }
      if (p !== document.body && p !== document.documentElement) {
        save(p);
        try {
          p.style.setProperty("transform", "none", "important");
          p.style.setProperty("filter", "none", "important");
          p.style.setProperty("perspective", "none", "important");
          p.style.setProperty("overflow", "visible", "important");
          p.style.setProperty("border-radius", "0", "important");
        } catch (e) {}
      }
      el = p;
    }

    // 3) Stream full page + borderless.
    save(box);
    try {
      box.style.setProperty("position", "fixed", "important");
      box.style.setProperty("left", "0", "important");
      box.style.setProperty("top", "0", "important");
      box.style.setProperty("right", "0", "important");
      box.style.setProperty("bottom", "0", "important");
      box.style.setProperty("width", "100vw", "important");
      box.style.setProperty("height", "100vh", "important");
      box.style.setProperty("max-width", "none", "important");
      box.style.setProperty("max-height", "none", "important");
      box.style.setProperty("margin", "0", "important");
      box.style.setProperty("padding", "0", "important");
      box.style.setProperty("border", "0", "important");
      box.style.setProperty("border-radius", "0", "important");
      box.style.setProperty("box-shadow", "none", "important");
      box.style.setProperty("outline", "none", "important");
      box.style.setProperty("overflow", "hidden", "important");
      box.style.setProperty("z-index", "2147483646", "important");
      box.style.setProperty("background", "#000", "important");
    } catch (e) {}

    // Inner iframe/video fills the stretched box.
    const inner = (box.tagName === "IFRAME" || box.tagName === "VIDEO")
      ? box
      : box.querySelector("iframe,video");
    if (inner && inner !== box) {
      save(inner);
      try {
        inner.style.setProperty("width", "100%", "important");
        inner.style.setProperty("height", "100%", "important");
        inner.style.setProperty("border", "0", "important");
        inner.style.setProperty("border-radius", "0", "important");
        inner.style.setProperty("margin", "0", "important");
        inner.style.setProperty("padding", "0", "important");
        inner.style.setProperty("display", "block", "important");
        inner.style.setProperty("background", "#000", "important");
      } catch (e) {}
    }

    // Page base: no scrollbars, black, borderless feel.
    save(document.documentElement);
    try {
      document.documentElement.style.setProperty("overflow", "hidden", "important");
      document.documentElement.style.setProperty("background", "#000", "important");
    } catch (e) {}
    save(document.body);
    try {
      document.body.style.setProperty("margin", "0", "important");
      document.body.style.setProperty("overflow", "hidden", "important");
      document.body.style.setProperty("background", "#000", "important");
    } catch (e) {}

    attachCover();
  };

  // Never use the Fullscreen API in v2 (CSS theater instead). If a previous
  // version left the page in fullscreen, exit it so behavior is predictable.
  if (document.fullscreenElement && document.exitFullscreen) {
    try { document.exitFullscreen(); } catch (e) {}
  }

  apply();

  // Server 1/2/3... switches swap the referential iframe -> re-apply.
  // The debounce timer lives on the state object so toggle-off can cancel it.
  const st = { observer: null, styles, timer: null };
  const observer = new MutationObserver(() => {
    if (st.timer) return;
    st.timer = setTimeout(() => { st.timer = null; try { apply(); } catch (e) {} }, 300);
  });
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  st.observer = observer;
  window[STATE_KEY] = st;
})();
