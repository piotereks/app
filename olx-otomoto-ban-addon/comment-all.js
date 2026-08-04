window.commentAll = function() {
    const text = prompt("Comment:", "");
    if (text === null) return;
    const comment = String(text).slice(0, 50);
    const SEL = ".comment-input, .olx-ban-inline-comment-input, .otomoto-inline-comment-input";
    const fill = () => document.querySelectorAll(SEL).forEach(input => {
        input.value = comment;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    fill();

    const expand = [...document.querySelectorAll(".olx-ban-collapse-bar")]
        .map(bar => bar.querySelector(".olx-ban-collapse-toggle"))
        .filter(btn => btn && btn.textContent.trim() === "Expand");
    if (!expand.length) return;

    expand.forEach(b => b.click());

    setTimeout(() => {
        fill();
        setTimeout(() => {
            expand.forEach(b => {
                const bar = b.closest(".olx-ban-collapse-bar");
                const btn = bar ? bar.querySelector(".olx-ban-collapse-toggle") : b;
                if (btn && btn.textContent.trim() === "Collapse") btn.click();
            });
        }, 2100);
    }, 120);
};
