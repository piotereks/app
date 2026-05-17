(function () {
  "use strict";

  var DICT_BASE_URL = "https://piotereks.top/esp-dict/?word=";
  var TARGET_WINDOW = "esp_dict_window";
  var WORD_PATTERN = createWordPattern();
  var WORD_EXTRACT_PATTERN = createWordExtractPattern();
  var WORD_CHAR_PATTERN = createWordCharPattern();
  var STYLE_ELEMENT_ID = "dict-word-hook-styles";
  var OVERLAY_ID = "dict-word-hook-overlay";
  var activeWord = "";

  function createWordPattern() {
    try {
      return new RegExp("^[\\p{L}\\p{M}]+(?:['\u2019-][\\p{L}\\p{M}]+)*$", "u");
    } catch (error) {
      // Fallback for browsers without Unicode property escapes support.
      return /^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*$/;
    }
  }

  function createWordExtractPattern() {
    try {
      return new RegExp("[\\p{L}\\p{M}]+(?:['\u2019-][\\p{L}\\p{M}]+)*", "u");
    } catch (error) {
      return /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*/;
    }
  }

  function createWordCharPattern() {
    try {
      return new RegExp("[\\p{L}\\p{M}'\u2019-]", "u");
    } catch (error) {
      return /[A-Za-zÀ-ÖØ-öø-ÿ'’-]/;
    }
  }

  function buildUrl(word) {
    return DICT_BASE_URL + encodeURIComponent(word);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ELEMENT_ID)) {
      return;
    }

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
      "}" +
      "#" + OVERLAY_ID + ":hover,#" + OVERLAY_ID + ":focus{" +
      "background:rgba(0,0,0,.95);" +
      "}";

    document.head.appendChild(style);
  }

  function isEditableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    var tag = element.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
  }

  function shouldSkipNode(parent) {
    if (!parent || parent.nodeType !== Node.ELEMENT_NODE) {
      return true;
    }

    var tag = parent.tagName;
    return (
      tag === "SCRIPT" ||
      tag === "STYLE" ||
      tag === "NOSCRIPT" ||
      tag === "TEXTAREA" ||
      tag === "A" ||
      isEditableElement(parent)
    );
  }

  function ensureOverlayButton() {
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      return existing;
    }

    var button = document.createElement("button");
    button.id = OVERLAY_ID;
    button.type = "button";
    button.textContent = "es-dict";
    button.setAttribute("aria-label", "Open dictionary");
    button.setAttribute("title", "es-dict");
    button.addEventListener("click", function (event) {
      event.preventDefault();
      if (activeWord) {
        openDictionary(activeWord);
      }
      hideOverlay();
    });

    (document.body || document.documentElement).appendChild(button);
    return button;
  }

  function extractWord(text) {
    if (!text) {
      return "";
    }

    var normalized = String(text).trim();
    if (!normalized || normalized.length > 80) {
      return "";
    }

    if (WORD_PATTERN.test(normalized)) {
      return normalized;
    }

    var match = normalized.match(WORD_EXTRACT_PATTERN);
    return match ? match[0] : "";
  }

  function getSelectionQuery(text) {
    if (!text) {
      return "";
    }

    var normalized = String(text).trim();
    if (!normalized) {
      return "";
    }

    if (normalized.length > 80) {
      return extractWord(normalized);
    }

    return normalized;
  }

  function getSelectionRect(selection) {
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    var range = selection.getRangeAt(0).cloneRange();
    var rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) {
      return rect;
    }

    var rects = range.getClientRects();
    if (rects && rects.length) {
      return rects[0];
    }

    return null;
  }

  function hideOverlay() {
    var button = document.getElementById(OVERLAY_ID);
    if (button) {
      button.style.display = "none";
    }
    activeWord = "";
  }

  function clamp(value, min, max) {
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
  }

  function showOverlay(word, rect) {
    if (!word || !rect) {
      hideOverlay();
      return;
    }

    var button = ensureOverlayButton();
    var buttonWidth = 48;
    var buttonHeight = 30;
    var left = clamp(rect.left, 8, Math.max(8, window.innerWidth - buttonWidth - 8));
    var top = rect.bottom + 8;
    if (top + buttonHeight > window.innerHeight - 8) {
      top = rect.top - buttonHeight - 8;
    }

    button.style.left = Math.round(left) + "px";
    button.style.top = Math.round(clamp(top, 8, Math.max(8, window.innerHeight - buttonHeight - 8))) + "px";
    button.style.display = "inline-block";
    button.setAttribute("title", "es-dict=" + word);
    button.setAttribute("aria-label", "Open dictionary for " + word);
    activeWord = word;
  }

  function openDictionary(word) {
    if (!word) {
      return;
    }

    window.open(buildUrl(word), TARGET_WINDOW);
  }

  function getWordAtPoint(x, y) {
    var range = null;

    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      var position = document.caretPositionFromPoint(x, y);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.setEnd(position.offsetNode, position.offset);
      }
    }

    if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) {
      return "";
    }

    var textNode = range.startContainer;
    if (shouldSkipNode(textNode.parentNode)) {
      return "";
    }

    var text = textNode.nodeValue || "";
    if (!text) {
      return "";
    }

    var offset = range.startOffset;
    if (offset >= text.length) {
      offset = text.length - 1;
    }

    if (offset < 0 || !WORD_CHAR_PATTERN.test(text.charAt(offset))) {
      if (offset > 0 && WORD_CHAR_PATTERN.test(text.charAt(offset - 1))) {
        offset -= 1;
      } else {
        return "";
      }
    }

    var start = offset;
    var end = offset + 1;

    while (start > 0 && WORD_CHAR_PATTERN.test(text.charAt(start - 1))) {
      start -= 1;
    }
    while (end < text.length && WORD_CHAR_PATTERN.test(text.charAt(end))) {
      end += 1;
    }

    return extractWord(text.slice(start, end));
  }

  function handleSelectionOverlay(event) {
    var target = event.target;
    if (target && isEditableElement(target)) {
      hideOverlay();
      return;
    }

    window.setTimeout(function () {
      var selection = window.getSelection();
      var word = getSelectionQuery(selection ? selection.toString() : "");
      if (!word) {
        hideOverlay();
        return;
      }

      var rect = getSelectionRect(selection);
      if (!rect) {
        hideOverlay();
        return;
      }

      showOverlay(word, rect);
    }, 0);
  }

  function onClick(event) {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay && event.target === overlay) {
      return;
    }

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
    if (event.key === "Escape") {
      hideOverlay();
      return;
    }

    var isAltD =
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === "d" || event.key === "D");

    if (!isAltD) {
      return;
    }

    event.preventDefault();

    var selection = window.getSelection();
    var selectedWord = getSelectionQuery(selection ? selection.toString() : "");
    if (selectedWord) {
      openDictionary(selectedWord);
      hideOverlay();
      return;
    }

    if (activeWord) {
      openDictionary(activeWord);
      hideOverlay();
    }
  }

  function init() {
    ensureStyles();
    ensureOverlayButton();

    document.addEventListener("mouseup", handleSelectionOverlay, false);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, false);
    window.addEventListener("scroll", hideOverlay, true);
    window.addEventListener("resize", hideOverlay, false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
