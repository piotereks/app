(function () {
  "use strict";

  var DICT_BASE_URL = "https://piotereks.top/esp-dict/?word=";
  var TARGET_WINDOW = "esp_dict_window";
  var WORD_PATTERN = createWordPattern();
  var STYLE_ELEMENT_ID = "dict-word-hook-styles";

  function createWordPattern() {
    try {
      return new RegExp("[\\p{L}\\p{M}]+(?:['\u2019-][\\p{L}\\p{M}]+)*", "gu");
    } catch (error) {
      // Fallback for browsers without Unicode property escapes support.
      return /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g;
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
      ".dict-word-hook{" +
      "cursor:pointer;" +
      "display:inline-block;" +
      "position:relative;" +
      "line-height:inherit;" +
      "}" +
      ".dict-word-hook:hover,.dict-word-hook:focus{" +
      "text-decoration:underline !important;" +
      "text-underline-offset:2px;" +
      "}" +
      ".dict-word-hook:hover::after,.dict-word-hook:focus::after{" +
      "content:'dict';" +
      "position:absolute;" +
      "left:50%;" +
      "transform:translateX(-50%);" +
      "bottom:100%;" +
      "margin-bottom:2px;" +
      "padding:0 4px;" +
      "font-size:10px;" +
      "line-height:1.3;" +
      "font-family:sans-serif;" +
      "background:#222;" +
      "color:#fff;" +
      "border-radius:3px;" +
      "z-index:2147483647;" +
      "box-shadow:0 1px 2px rgba(0,0,0,.35);" +
      "white-space:nowrap;" +
      "pointer-events:none;" +
      "}";

    document.head.appendChild(style);
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
      tag === "A"
    );
  }

  function wrapWordsInTextNode(textNode) {
    var text = textNode.nodeValue;
    if (!text || !WORD_PATTERN.test(text)) {
      WORD_PATTERN.lastIndex = 0;
      return;
    }

    WORD_PATTERN.lastIndex = 0;

    var fragment = document.createDocumentFragment();
    var lastIndex = 0;
    var match;

    while ((match = WORD_PATTERN.exec(text)) !== null) {
      var matchedWord = match[0];
      var start = match.index;
      var end = start + matchedWord.length;

      if (start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }

      var hook = document.createElement("span");
      hook.className = "dict-word-hook";
      hook.setAttribute("data-word", matchedWord);
      hook.appendChild(document.createTextNode(matchedWord));
      fragment.appendChild(hook);

      lastIndex = end;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(fragment, textNode);
  }

  function installHooks(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        if (shouldSkipNode(node.parentNode)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var textNodes = [];
    var current;

    while ((current = walker.nextNode())) {
      textNodes.push(current);
    }

    for (var i = 0; i < textNodes.length; i += 1) {
      wrapWordsInTextNode(textNodes[i]);
    }
  }

  function onWordClick(event) {
    var target = event.target;
    if (!target || !target.classList || !target.classList.contains("dict-word-hook")) {
      return;
    }

    var word = target.getAttribute("data-word");
    if (!word) {
      return;
    }

    event.preventDefault();
    window.open(buildUrl(word), TARGET_WINDOW);
  }

  document.addEventListener("click", onWordClick, false);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      ensureStyles();
      installHooks(document.body);
    });
  } else {
    ensureStyles();
    installHooks(document.body);
  }
})();
