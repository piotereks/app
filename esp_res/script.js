// Initialize highlight.js
document.addEventListener('DOMContentLoaded', (event) => {
    document.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightBlock(block);
    });

});

window.onpopstate = function(event) {
    handleUrlWord();
};



// Function to get URL parameter value by name
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}



// Function to update the URL with the search word
function updateUrlWithWord(word) {
    var newUrl = `${window.location.pathname}?word=${encodeURIComponent(word)}`;
    history.pushState(null, '', newUrl);
}


// Get the 'word' parameter from the URL, if it exists
handleUrlWord();

function handleUrlWord() {
    var urlWord = getUrlParameter('word');
    if (urlWord !== '') {
        urlWord = urlWord.trim();
        document.getElementById('word').value = urlWord;

        // Manually trigger the search when the word parameter is in the URL
        searchWord(urlWord);
    }
}

// Search form submit event
document.getElementById("searchForm").addEventListener("submit", function (event) {
    event.preventDefault();
    var word = document.getElementById("word").value.trim();

    updateUrlWithWord(word); // Update the URL with the search word
    searchWord(word);
});

// Toggle visibility of collapsible content
var collapsibles = document.getElementsByClassName("collapsible");
for (var i = 0; i < collapsibles.length; i++) {
    collapsibles[i].addEventListener("click", function () {
        this.classList.toggle("active");
        var content = this.nextElementSibling;
        if (content.style.display === "block") {
            content.style.display = "none";
        } else {
            content.style.display = "block";
        }
    });
}

// Function to collapse all collapsible sections
function collapseAll() {
    var collapsibles = document.getElementsByClassName("collapsible");
    for (var i = 0; i < collapsibles.length; i++) {
        var content = collapsibles[i].nextElementSibling;
        if (content.style.display === "block") {
            content.style.display = "none";
            collapsibles[i].classList.remove("active");
        }
    }
}

// Add event listener to the "Collapse All" button
document.getElementById("collapseAllBtn").addEventListener("click", function() {
    collapseAll();
});


// Manually trigger opening of the first section when the page is loaded
document.addEventListener('DOMContentLoaded', function () {
    var firstCollapsible = document.getElementById("defFrameBtn");
    firstCollapsible.click();
});

function searchWord(word) {
    // Trim leading and trailing whitespace (standard spaces)
    word = word.trim();

    var defUrl = "https://www.wordreference.com/definicion/" + encodeURIComponent(word);
    var sinUrl = "https://www.wordreference.com/sinonimos/" + encodeURIComponent(word);
    var spenUrl = "https://www.wordreference.com/es/en/translation.asp?spen=" + encodeURIComponent(word);
    var raeUrl = "https://dle.rae.es/" + encodeURIComponent(word);
    var conUrl = "https://www.wordreference.com/conj/esverbs.aspx?v=" + encodeURIComponent(word);
    var spellUrl = "https://spell.wordreference.com/spell/spelljs.php?dict=eses&w=" + encodeURIComponent(word);

    document.getElementById("defLink").href = defUrl;
    document.getElementById("sinLink").href = sinUrl;
    document.getElementById("spenLink").href = spenUrl;
    document.getElementById("raeLink").href = raeUrl;
    document.getElementById("conLink").href = conUrl;

    fetchAndDisplay(defUrl, "defFrameContent", '#otherDicts', spellUrl);
    fetchAndDisplay(sinUrl, "sinFrameContent", '#article', undefined, "sinLink");
    fetchAndDisplay(spenUrl, "spenFrameContent", '#articleWRD', undefined);
    fetchAndDisplay(raeUrl, "raeFrameContent", '#resultados > article', undefined);
    fetchAndDisplay(conUrl, "conFrameContent", '#contenttable > tbody > tr > td > table > tbody > tr > td:nth-child(2)', undefined, "conLink");
}

function fetchAndDisplay(url, targetElementId, querySelectorName, urlSpell, linkId) {
    const useCorsProxy = url.includes('dle.rae.es');
    const fetchUrl = useCorsProxy
        ? `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
        : url;
    fetch(fetchUrl)
        .then(async response => {
            if (useCorsProxy) {
                const data = await response.json();
                return data.contents;
            }
            return response.text();
        })
        .then(html => {
            var parser = new DOMParser();
            var doc = parser.parseFromString(html, 'text/html');
            var content = doc.querySelector(querySelectorName);
            var currentFileName = window.location.pathname.split('/').pop();

            // Remove the specific span element with id "browserInfo"
            if (content) {
                var browserInfoElement = content.querySelector('#browserInfo');
                if (browserInfoElement) {
                    browserInfoElement.remove();
                }
                content.querySelectorAll('a').forEach(link => {
                    var href = link.getAttribute('href');
                    if (href) {
                        if (href.includes('conj/esVerbs.aspx?v=')) {
                            link.setAttribute('href', `${currentFileName}?word=${href.split('=')[1]}`);
                        } else if (href.includes('conj/esverbs.aspx?v=')) {
                            link.setAttribute('href', `${currentFileName}?word=${href.split('=')[1]}`);
                        } else if (href.includes('?v=')) {
                            link.setAttribute('href', `${currentFileName}?word=${href.split('=')[1]}`);                            
                        } else if (href.includes('sinonimos/')) {
                            link.setAttribute('href', `${currentFileName}?word=${href.split('/')[2]}`);
                        }
                    }

                });
            }

            var targetElement = document.getElementById(targetElementId);
            if ((!content || content.innerHTML.trim() === "") && urlSpell !== "" && typeof urlSpell !== "undefined") {
                return fetch(urlSpell)
                    .then(response => response.text())
                    .then(htmlSpell => {
                        var docSpell = parser.parseFromString(htmlSpell, 'text/html');
                        var table = docSpell.querySelector("table");

                        if (table) {
                            var links = table.querySelectorAll("a");
                            links.forEach(link => {
                                var originalHref = link.getAttribute("href");
                                link.setAttribute("href", `${currentFileName}?word=${originalHref}`);
                            });

                            targetElement.innerHTML = table.outerHTML ? table.outerHTML : "No content found.";
                        } else {
                            targetElement.innerHTML = "No table content found from alternate URL.";
                        }
                    });

            } else {
                targetElement.innerHTML = content && content.innerText && content.innerText.trim() ? content.innerHTML : "No content found.";
            }

        })
        .catch(error => {
            console.error('Error fetching content:', error);
            var targetElement = document.getElementById(targetElementId);
            if (targetElement) {
                targetElement.textContent = "Error fetching content.";
            }

        });

    // Update link href if linkId is provided
    if (linkId) {
        document.getElementById(linkId).href = url;
    }
}
