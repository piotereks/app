window.commentAll = function() {
    const text = prompt("Comment:", "");
    if (text === null) return;
    const comment = String(text).slice(0, 50);
    const SEL = ".comment-input, .olx-ban-inline-comment-input, .otomoto-inline-comment-input";

    const fill = () => {
        let n = 0;
        document.querySelectorAll(SEL).forEach(input => {
            if (input.value === comment) return;
            input.value = comment;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            n++;
        });
        return n;
    };

    const expand = [...document.querySelectorAll(".olx-ban-collapse-bar")]
        .map(bar => bar.querySelector(".olx-ban-collapse-toggle"))
        .filter(btn => btn && btn.textContent.trim() === "Expand");
    expand.forEach(b => b.click());
    const expandedAt = Date.now();

    const sc = document.scrollingElement || document.documentElement;
    const startY = sc.scrollTop || window.scrollY || 0;

    const finish = () => {
        fill();
        const wait = Math.max(0, 2100 - (Date.now() - expandedAt)) + 100;
        setTimeout(() => {
            expand.forEach(b => {
                const bar = b.closest(".olx-ban-collapse-bar");
                const btn = bar ? bar.querySelector(".olx-ban-collapse-toggle") : b;
                if (btn && btn.textContent.trim() === "Collapse") btn.click();
            });
            setTimeout(fill, 300);
        }, wait);
    };

    let y = startY;
    let tries = 0;
    const tick = () => {
        fill();
        const maxY = sc.scrollHeight - sc.clientHeight;
        if (y < maxY && tries < 120) {
            tries++;
            y = Math.min(maxY, y + Math.max(600, Math.round(window.innerHeight * 0.7)));
            window.scrollTo(0, y);
            setTimeout(tick, 180);
        } else {
            window.scrollTo(0, startY);
            setTimeout(finish, 250);
        }
    };

    fill();
    if (sc.scrollHeight > sc.clientHeight) tick();
    else setTimeout(finish, 300);
};
