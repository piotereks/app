(function(){
  function getParams() {
    var src = (document.currentScript && document.currentScript.src) || '';
    if (!src) {
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i -= 1) {
        if (scripts[i].src && scripts[i].src.indexOf('bookmarklet-install.js') !== -1) {
          src = scripts[i].src;
          break;
        }
      }
    }

    if (!src) {
      return {};
    }

    var params = {};
    try {
      var url = new URL(src, window.location.href);
      params.SCRIPT_URL = url.searchParams.get('SCRIPT_URL') || url.searchParams.get('scriptUrl');
      params.LOADING_FLAG = url.searchParams.get('LOADING_FLAG') || url.searchParams.get('loadingFlag');
    } catch (e) {
      // ignore malformed URL
    }
    return params;
  }

  var config = getParams();
  var SCRIPT_URL = config.SCRIPT_URL || 'https://piotereks.top/bmlet/xxdict-word-hooks.js';
  var LOADING_FLAG = config.LOADING_FLAG || '__xxdictWordHooksBookmarkletLoading';

  if (window[LOADING_FLAG]) {
    return;
  }
  window[LOADING_FLAG] = true;

  function done() {
    window[LOADING_FLAG] = false;
  }

  if (document.querySelector('script[src="' + SCRIPT_URL + '"]')) {
    done();
    return;
  }

  var script = document.createElement('script');
  script.src = SCRIPT_URL;
  script.async = true;
  script.onload = done;
  script.onerror = function() {
    if (script.parentNode) {
      script.parentNode.removeChild(script);
    }
    alert('Could not load script from ' + SCRIPT_URL + '.');
    done();
  };

  var parent = document.body || document.head || document.documentElement;
  parent.appendChild(script);
})();
