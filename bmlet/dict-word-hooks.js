(function () {
  "use strict";

  // Guard: prevent double-injection (e.g. bookmarklet re-run).
  if (window.__dictWordHook) { return; }
  window.__dictWordHook = true;

  var DICT_BASE_URL    = "https://piotereks.top/esp-dict/?word=";
  var TARGET_WINDOW    = "esp_dict_window";
  var STYLE_ELEMENT_ID = "dict-word-hook-styles";
  var OVERLAY_ID       = "dict-word-hook-overlay";

  var WORD_PATTERN         = createWordPattern();
  var WORD_EXTRACT_PATTERN = createWordExtractPattern();
  var WORD_CHAR_PATTERN    = createWordCharPattern();

  var activeWord     = "";
  var selectionTimer = null;  // desktop mouseup debounce handle
  var touchTimer     = null;  // touch / selectionchange debounce handle

  // ── Regex factories ────────────────────────────────────────────────────────

  function createWordPattern() {
    try {
      return new RegExp("^[\\p{L}\\p{M}]+(?:['\u2019-][\\p{L}\\p{M}]+)*$", "u");
    } catch (e) {
      return /^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[''-][A-Za-zÀ-ÖØ-öø-ÿ]+)*$/;
    }
  }

  function createWordExtractPattern() {
    try {
      return new RegExp("[\\p{L}\\p{M}]+(?:['\u2019-][\\p{L}\\p{M}]+)*", "u");
    } catch (e) {
      return /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[''-][A-Za-zÀ-ÖØ-öø-ÿ]+)*/;
    }
  }

  function createWordCharPattern() {
    // Trailing hyphen is a literal '-', not a range.
    try {
      return new RegExp("[\\p{L}\\p{M}'\u2019-]", "u");
    } catch (e) {
      return /[A-Za-zÀ-ÖØ-öø-ÿ''-]/;
    }
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  function buildUrl(word) {
    return DICT_BASE_URL + encodeURIComponent(word);
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function isEditableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) { return false; }
    var tag = element.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
           element.isContentEditable;
  }

  function shouldSkipNode(parent) {
    if (!parent || parent.nodeType !== Node.ELEMENT_NODE) { return true; }
    var tag = parent.tagName;
    return (
      tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" ||
      tag === "TEXTAREA" || tag === "A" || isEditableElement(parent)
    );
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  function ensureStyles() {
    if (document.getElementById(STYLE_ELEMENT_ID)) { return; }
    var style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent =
      "#" + OVERLAY_ID + "{" +
      "position:fixed;" +
      "z-index:2147483647;" +
      "display:none;" +
      "padding:4px 8px;" +
      "border:0;" +
      "border-radius:999px;" +
      "font-size:12px;" +
      "font-weight:600;" +
      "font-family:Arial,sans-serif;" +
      "color:#fff;" +
      "background:rgba(20,20,20,.88);" +
      "cursor:pointer;" +
      "box-shadow:0 2px 8px rgba(0,0,0,.25);" +
      "backdrop-filter:saturate(140%) blur(2px);" +
      "-webkit-backdrop-filter:saturate(140%) blur(2px);" +
      // Prevent double-tap zoom and text selection on the button itself.
      "touch-action:manipulation;" +
      "user-select:none;" +
      "-webkit-user-select:none;" +
      "}" +
      "#" + OVERLAY_ID + ":hover,#" + OVERLAY_ID + ":focus{" +
      "background:rgba(0,0,0,.95);" +
      "}";
    document.head.appendChild(style);
  }

  // ── Overlay button ─────────────────────────────────────────────────────────

  function ensureOverlayButton() {
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) { return existing; }

    var button = document.createElement("button");
    button.id   = OVERLAY_ID;
    button.type = "button";
    button.textContent = "es-dict";
    button.setAttribute("aria-label", "Open dictionary");
    button.setAttribute("title", "es-dict");

    // Desktop click
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (activeWord) { openDictionary(activeWord); }
      hideOverlay();
    });

    // Touch tap: respond on touchend to skip the 300 ms synthetic-click delay.
    button.addEventListener("touchend", function (event) {
      event.preventDefault();   // suppress the follow-up click event
      event.stopPropagation();  // don't let document touchend handler re-evaluate
      if (activeWord) { openDictionary(activeWord); }
      hideOverlay();
    }, { passive: false });

    (document.body || document.documentElement).appendChild(button);
    return button;
  }

  // ── Word extraction ────────────────────────────────────────────────────────

  function extractWord(text) {
    if (!text) { return ""; }
    var normalized = String(text).trim();
    if (!normalized) { return ""; }

    // Fast path: the whole trimmed string is already a valid single word.
    if (normalized.length <= 80 && WORD_PATTERN.test(normalized)) {
      return normalized;
    }

    // For longer or multi-token input, extract the first word-like token.
    // (No length gate here — we always attempt extraction.)
    var match = normalized.match(WORD_EXTRACT_PATTERN);
    return match ? match[0] : "";
  }

  function getSelectionQuery(text) {
    if (!text) { return ""; }
    var normalized = String(text).trim();
    if (!normalized) { return ""; }
    // For selections longer than 80 chars, extract just the first word.
    if (normalized.length > 80) { return extractWord(normalized); }
    return normalized;
  }

  // ── Selection geometry ─────────────────────────────────────────────────────

  function getSelectionRect(selection) {
    if (!selection || selection.rangeCount === 0) { return null; }
    var range = selection.getRangeAt(0).cloneRange();
    var rect  = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) { return rect; }
    var rects = range.getClientRects();
    return (rects && rects.length) ? rects[0] : null;
  }

  // ── Overlay show / hide ────────────────────────────────────────────────────

  function hideOverlay() {
    var button = document.getElementById(OVERLAY_ID);
    if (button) { button.style.display = "none"; }
    activeWord = "";
  }

  function showOverlay(word, rect) {
    if (!word || !rect) { hideOverlay(); return; }

    var button = ensureOverlayButton();
    var margin = 8;

    // Measure the real rendered button size before committing position.
    // Temporarily make it invisible-but-laid-out so offsetWidth is accurate.
    button.style.visibility = "hidden";
    button.style.display    = "inline-block";
    var bw = button.offsetWidth  || 56;
    var bh = button.offsetHeight || 28;
    button.style.visibility = "";

    var vw = window.innerWidth;
    var vh = window.innerHeight;

    // Centre horizontally over the selection.
    var left = clamp(
      rect.left + rect.width / 2 - bw / 2,
      margin,
      Math.max(margin, vw - bw - margin)
    );

    // Prefer below the selection; fall back above if it would be clipped.
    var top = rect.bottom + margin;
    if (top + bh > vh - margin) {
      top = rect.top - bh - margin;
    }
    top = clamp(top, margin, Math.max(margin, vh - bh - margin));

    button.style.left = Math.round(left) + "px";
    button.style.top  = Math.round(top)  + "px";
    button.setAttribute("title",      "es-dict=" + word);
    button.setAttribute("aria-label", "Open dictionary for " + word);
    activeWord = word;
  }

  // ── Dictionary opener ──────────────────────────────────────────────────────

  function openDictionary(word) {
    if (word) { window.open(buildUrl(word), TARGET_WINDOW); }
  }

  // ── Hit-testing for Alt+click ──────────────────────────────────────────────

  function getWordAtPoint(x, y) {
    var range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
      }
    }

    if (!range || !range.startContainer ||
        range.startContainer.nodeType !== Node.TEXT_NODE) { return ""; }

    var textNode = range.startContainer;
    if (shouldSkipNode(textNode.parentNode)) { return ""; }

    var text = textNode.nodeValue || "";
    if (!text) { return ""; }

    var offset = range.startOffset;
    if (offset >= text.length) { offset = text.length - 1; }

    if (offset < 0 || !WORD_CHAR_PATTERN.test(text.charAt(offset))) {
      if (offset > 0 && WORD_CHAR_PATTERN.test(text.charAt(offset - 1))) {
        offset -= 1;
      } else {
        return "";
      }
    }

    var start = offset;
    var end   = offset + 1;
    while (start > 0          && WORD_CHAR_PATTERN.test(text.charAt(start - 1))) { start -= 1; }
    while (end   < text.length && WORD_CHAR_PATTERN.test(text.charAt(end)))       { end   += 1; }

    return extractWord(text.slice(start, end));
  }

  // ── Core selection → overlay logic ────────────────────────────────────────

  function applySelectionOverlay() {
    // Use document.getSelection() — more reliable than window.getSelection()
    // across browsers, and the spec-correct API.
    var selection = document.getSelection();
    if (!selection || selection.isCollapsed) { hideOverlay(); return; }
    var word = getSelectionQuery(selection.toString());
    if (!word) { hideOverlay(); return; }
    var rect = getSelectionRect(selection);
    if (!rect) { hideOverlay(); return; }
    showOverlay(word, rect);
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  // Desktop: run after current task so the browser has finalised the selection.
  function handleMouseUp(event) {
    if (isEditableElement(event.target)) { hideOverlay(); return; }
    if (selectionTimer) { clearTimeout(selectionTimer); }
    selectionTimer = window.setTimeout(function () {
      selectionTimer = null;
      applySelectionOverlay();
    }, 0);
  }

  // Touch / mobile: selectionchange fires continuously as handles are dragged.
  // Debounce so we only act once the user stops adjusting.
  function handleSelectionChange() {
    if (touchTimer) { clearTimeout(touchTimer); }
    touchTimer = window.setTimeout(function () {
      touchTimer = null;
      var active = document.activeElement;
      if (active && isEditableElement(active)) { return; }
      applySelectionOverlay();
    }, 250);
  }

  // Flush the debounce on finger-up so the overlay appears promptly.
  // A small extra delay lets iOS/Android finalise the selection object.
  function handleTouchEnd(event) {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay && event.target === overlay) { return; }   // button tap handled separately
    if (isEditableElement(event.target)) { hideOverlay(); return; }

    if (touchTimer) { clearTimeout(touchTimer); }
    touchTimer = window.setTimeout(function () {
      touchTimer = null;
      applySelectionOverlay();
    }, 300);
  }

  function onClick(event) {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay && event.target === overlay) { return; }

    // Cancel any pending mouseup check so it cannot re-show the overlay
    // after a click has already dismissed it.
    if (selectionTimer) { clearTimeout(selectionTimer); selectionTimer = null; }

    if (event.altKey) {
      var word = getWordAtPoint(event.clientX, event.clientY);
      if (word) {
        event.preventDefault();
        event.stopPropagation();
        openDictionary(word);
      }
      hideOverlay();
      return;
    }

    hideOverlay();
  }

  function onKeyDown(event) {
    if (event.key === "Escape") { hideOverlay(); return; }

    var isAltD = event.altKey && !event.ctrlKey && !event.metaKey &&
                 (event.key === "d" || event.key === "D");
    if (!isAltD) { return; }
    event.preventDefault();

    var selection    = document.getSelection();
    var selectedWord = getSelectionQuery(selection ? selection.toString() : "");
    if (selectedWord) { openDictionary(selectedWord); hideOverlay(); return; }
    if (activeWord)   { openDictionary(activeWord);   hideOverlay(); }
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    ensureStyles();
    ensureOverlayButton();

    document.addEventListener("mouseup",         handleMouseUp,         false);
    document.addEventListener("selectionchange", handleSelectionChange, false);
    document.addEventListener("touchend",        handleTouchEnd,        false);
    document.addEventListener("click",           onClick,               true);
    document.addEventListener("keydown",         onKeyDown,             false);

    // No capture phase — avoids triggering on scrolls inside child elements.
    window.addEventListener("scroll", hideOverlay, { passive: true });
    window.addEventListener("resize", hideOverlay, false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();