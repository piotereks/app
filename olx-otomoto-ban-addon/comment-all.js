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

    const clickToggle = (label) => {
        let n = 0;
        document.querySelectorAll(".olx-ban-collapse-bar").forEach(bar => {
            const btn = bar.querySelector(".olx-ban-collapse-toggle");
            if (btn && btn.textContent.trim() === label) {
                btn.click();
                n++;
            }
        });
        return n;
    };

    fill();
    const start = Date.now();
    const WAVE_MS = 2300;   // longer than the addon's 2s toggle cooldown
    const MAX_MS = 12000;   // safety cap

    const wave = () => {
        const expanded = clickToggle("Expand");
        fill();
        if (expanded > 0 && Date.now() - start < MAX_MS) {
            setTimeout(wave, WAVE_MS);
        } else {
            setTimeout(() => {
                clickToggle("Collapse");
                setTimeout(fill, 300);
            }, WAVE_MS);
        }
    };
    wave();
};
