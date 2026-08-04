window.banAll = function() {
    const btns = [...document.querySelectorAll('button')].filter(
        b => b.textContent.trim() === 'BAN'
    );
    if (confirm(`Click ${btns.length} BAN buttons?`)) btns.forEach(b => b.click());
};
