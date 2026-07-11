(function () {

    // ── Gist config ───────────────────────────────────────────────────────────
    // Token is read from localStorage key "gist_token".
    // On first run (or after token expiry) a prompt will ask you to provide it.
    const TOKEN_LS_KEY  = "gist_token";
    const GIST_OWNER    = "piotereks";
    const GIST_FILENAME = "olx_otomoto_db.json";
    let   GIST_ID       = "27718858df6108b468734565eb91df8e";

    // ── Token resolution ──────────────────────────────────────────────────────
    function getToken(){
        return localStorage.getItem(TOKEN_LS_KEY) || "";
    }

    function saveToken(t){
        localStorage.setItem(TOKEN_LS_KEY, t.trim());
    }

    // ── Token prompt ─────────────────────────────────────────────────────────────
    function showTokenPrompt(onSave){
        const t = prompt("Provide gist write token:");
        if(t && t.trim()){ saveToken(t.trim()); onSave(t.trim()); }
        else onSave(null);
    }

        // ── LocalStorage key ──────────────────────────────────────────────────────
    const KEY = "global_listing_db";

    // ── Gist sync state ───────────────────────────────────────────────────────
    let syncTimer      = null;
    let syncInProgress = false;
    const SYNC_DEBOUNCE_MS = 30000;    // 30 seconds

    // ── Site detection ────────────────────────────────────────────────────────
    function getSite(){
        if(location.hostname.includes("otomoto")) return "otomoto";
        if(location.hostname.includes("olx"))     return "olx";
        if(document.title.toLowerCase().includes("otomoto")) return "otomoto";
        const hdr = document.querySelector("header");
        if(hdr && hdr.innerText && hdr.innerText.toLowerCase().includes("otomoto")) return "otomoto";
        return "olx";
    }

    function extractSiteFromUrl(url){
        if(url.includes("otomoto.pl")) return "otomoto";
        return "olx";
    }

    function makeKeyFromUrl(url){
        const id = extractId(url);
        if(!id) return null;
        return extractSiteFromUrl(url) + ":" + id;
    }

    function makeKey(id){ return getSite() + ":" + id; }

    // ── DB helpers ────────────────────────────────────────────────────────────
    function getDB(){
        try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
        catch(e){ return {}; }
    }
    function saveDB(db){
        try { localStorage.setItem(KEY, JSON.stringify(db)); }
        catch(e){}
    }
    function now(){ return new Date().toISOString(); }

    // ── Merge logic ───────────────────────────────────────────────────────────
    function mergeDBs(local, remote){
        const merged = Object.assign({}, local);
        for(const [k, rv] of Object.entries(remote)){
            const lv = local[k];
            if(!lv){
                merged[k] = rv;
                continue;
            }
            const entry = Object.assign({}, lv);

            const lBan = lv.bannedAt || "";
            const rBan = rv.bannedAt || "";
            if(rBan > lBan){
                entry.banned    = rv.banned;
                entry.bannedAt  = rv.bannedAt;
                if(rv.status !== undefined) entry.status = rv.status;
            }

            const lRat = lv.ratedAt || "";
            const rRat = rv.ratedAt || "";
            if(rRat > lRat){
                entry.rating  = rv.rating;
                entry.ratedAt = rv.ratedAt;
            }

            if(rv.comment !== undefined && ((rv.updatedAt || "") >= (lv.updatedAt || ""))) {
                entry.comment = rv.comment;
            }

            const lVie = lv.viewedAt || "";
            const rVie = rv.viewedAt || "";
            if(rVie > lVie) entry.viewedAt = rv.viewedAt;

            if(!entry.id   && rv.id)   entry.id   = rv.id;
            if(!entry.site && rv.site) entry.site = rv.site;

            const lUpd = lv.updatedAt || "";
            const rUpd = rv.updatedAt || "";
            if(rUpd > lUpd) entry.updatedAt = rv.updatedAt;

            merged[k] = entry;
        }
        return merged;
    }

    // ── GitHub Gist API ───────────────────────────────────────────────────────
    function gistHeaders(){
        return {
            "Authorization": "Bearer " + getToken(),
            "Content-Type": "application/json",
            "Accept": "application/vnd.github+json",
        };
    }

    async function createGist(db){
        const body = {
            description: "OLX/Otomoto listing DB",
            public: false,
            files: {
                [GIST_FILENAME]: { content: JSON.stringify(db, null, 2) }
            }
        };
        const res = await fetch("https://api.github.com/gists", {
            method: "POST",
            headers: gistHeaders(),
            body: JSON.stringify(body),
        });
        if(!res.ok) throw new Error("Gist create failed: " + res.status);
        const data = await res.json();
        GIST_ID = data.id;
        console.log("[OLX/Otomoto script] Created new gist. Paste this GIST_ID into the script:", GIST_ID);
        return data;
    }

    async function fetchGist(){
        if(!GIST_ID) return null;
        const res = await fetch("https://api.github.com/gists/" + GIST_ID, {
            headers: gistHeaders(),
        });
        if(res.status === 401) {
            // Bad/expired token — clear it and prompt
            localStorage.removeItem(TOKEN_LS_KEY);
            throw new Error("INVALID_TOKEN");
        }
        if(!res.ok){
            console.warn("[OLX/Otomoto script] Gist fetch failed:", res.status);
            return null;
        }
        const data = await res.json();
        const file = data.files && data.files[GIST_FILENAME];
        if(!file || !file.content) return null;
        try { return JSON.parse(file.content); }
        catch(e){ return null; }
    }

    async function pushGist(db){
        const content = JSON.stringify(db, null, 2);
        if(!GIST_ID){
            await createGist(db);
            return;
        }
        const body = {
            files: {
                [GIST_FILENAME]: { content }
            }
        };
        const res = await fetch("https://api.github.com/gists/" + GIST_ID, {
            method: "PATCH",
            headers: gistHeaders(),
            body: JSON.stringify(body),
        });
        if(res.status === 401){
            localStorage.removeItem(TOKEN_LS_KEY);
            throw new Error("INVALID_TOKEN");
        }
        if(!res.ok) console.warn("[OLX/Otomoto script] Gist push failed:", res.status);
    }

    // ── Handle token errors uniformly ─────────────────────────────────────────
    function handleTokenError(){
        showTokenPrompt(token => {
            if(token) init();   // re-run init with new token
        });
    }

    // ── Sync ──────────────────────────────────────────────────────────────────
    async function syncNow(){
        if(syncInProgress) return;
        syncInProgress = true;
        try {
            const remote = await fetchGist();
            const local  = getDB();
            if(remote){
                const merged = mergeDBs(local, remote);
                saveDB(merged);
            } else if(!GIST_ID){
                await createGist(local);
                return;
            }
            await pushGist(getDB());
        } catch(e){
            if(e.message === "INVALID_TOKEN") handleTokenError();
            else console.warn("[OLX/Otomoto script] Sync error:", e);
        } finally {
            syncInProgress = false;
        }
    }

    function scheduleSyncPush(){
        clearTimeout(syncTimer);
        syncTimer = setTimeout(async () => {
            if(syncInProgress) return;
            syncInProgress = true;
            try {
                const remote = await fetchGist();
                const local  = getDB();
                const merged = remote ? mergeDBs(local, remote) : local;
                saveDB(merged);
                await pushGist(merged);
                render();
            } catch(e){
                if(e.message === "INVALID_TOKEN") handleTokenError();
                else console.warn("[OLX/Otomoto script] Deferred sync error:", e);
            } finally {
                syncInProgress = false;
            }
        }, SYNC_DEBOUNCE_MS);
    }

    // ── URL helpers ───────────────────────────────────────────────────────────
    function extractId(url){
        var clean = url.split('?')[0].split('#')[0];
        var m = clean.match(/(?:^|[-_])id([A-Za-z0-9]+?)(?:\.html)?$/i);
        return m ? m[1] : null;
    }
    function getCurrentId(){ return extractId(location.href); }

    function formatDate(iso){
        if(!iso) return "";
        const d = new Date(iso);
        return [d.getDate(),d.getMonth()+1,d.getFullYear()].map(n=>String(n).padStart(2,"0")).join(".")
            + ", "
            + [d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,"0")).join(":");
    }

    // ── Write helpers ─────────────────────────────────────────────────────────
    function writeEntry(key, patch){
        const db = getDB();
        if(!db[key]) db[key] = {};
        Object.assign(db[key], patch, { updatedAt: now() });
        saveDB(db);
        scheduleSyncPush();
    }

    function normalizeComment(value){
        return String(value || "").slice(0, 30).trim();
    }

    function updateVisibleComment(dbKey, value){
        const comment = value || "";
        document.querySelectorAll(".script-chip").forEach(chip => {
            if(chip.getAttribute("data-db-key") !== dbKey) return;
            const label = chip.querySelector(".comment-label");
            if(label) label.textContent = comment || "comment";
            const input = chip.querySelector(".comment-input");
            if(input && document.activeElement !== input) input.value = comment;
        });
    }

    function setComment(id, value){
        const normalized = normalizeComment(value);
        const key = makeKey(id);
        const db = getDB();
        const current = (db[key] || {}).comment || "";
        if(current === normalized) return;
        writeEntry(key, { id, site:getSite(), comment: normalized });
        updateVisibleComment(key, normalized);
    }

    function setCommentByKey(id, dbKey, value){
        const normalized = normalizeComment(value);
        const db = getDB();
        const current = (db[dbKey] || {}).comment || "";
        if(current === normalized) return;
        const site = dbKey.split(":")[0];
        writeEntry(dbKey, { id, site, comment: normalized });
        updateVisibleComment(dbKey, normalized);
    }

    // ── Actions ───────────────────────────────────────────────────────────────
    function updateViewed(){
        const id = getCurrentId();
        if(!id) return;
        const key = makeKey(id);
        writeEntry(key, { id, site:getSite(), viewedAt: now() });
    }

    function ban(id){
        writeEntry(makeKey(id), { id, site:getSite(), banned:true, status:"", bannedAt:now() });
        render();
    }

    function unban(id){
        writeEntry(makeKey(id), { banned:false, status:"D" });
        render();
    }

    function banByKey(id, dbKey){
        const site = dbKey.split(":")[0];
        writeEntry(dbKey, { id, site, banned:true, status:"", bannedAt:now() });
        render();
    }

    function unbanByKey(id, dbKey){
        writeEntry(dbKey, { banned:false, status:"D" });
        render();
    }

    function setRating(id){
        const db  = getDB();
        const key = makeKey(id);
        const cur = (db[key] || {}).rating;
        writeEntry(key, { id, site:getSite(), rating: cycleRating(cur), ratedAt: now() });
        render();
    }

    function setRatingByKey(id, dbKey){
        const db  = getDB();
        const cur = (db[dbKey] || {}).rating;
        const site = dbKey.split(":")[0];
        writeEntry(dbKey, { id, site, rating: cycleRating(cur), ratedAt: now() });
        render();
    }

    function cycleRating(v){
        if(!v)      return 3;
        if(v === 3) return 2;
        if(v === 2) return 1;
        return null;
    }

    function getRatingStyle(v){
        if(v === 3) return { color:"#ff2b2b", label:"\u2605" };
        if(v === 2) return { color:"#ffd400", label:"\u2605" };
        if(v === 1) return { color:"#1e90ff", label:"\u2605" };
        return { color:"rgba(255,255,255,0.7)", label:"\u2606" };
    }

    // ── Heart selector ────────────────────────────────────────────────────────
    const HEART_SEL = [
        '[data-testid="favourites-button"]',
        '[data-testid="favourite-button"]',
        '[data-testid="observed-offer"]',
        '[data-testid*="favourit"]',
        '[data-testid*="observed"]',
        '[aria-label*="avoryt"]',
        '[aria-label*="Obserwuj"]',
        '[aria-label*="obserwuj"]',
        'button[class*="FavouriteButton"]',
        'button[class*="ObservedButton"]',
        'button[class*="favourite"]',
        'button[class*="favorite"]',
        '[data-cy*="favourit"]',
    ].join(",");

    function getCard(a){
        return a.closest('[data-cy="l-card"]')
            || a.closest('article[data-id]')
            || a.closest('article')
            || a.closest('[data-testid="listing-ad"]')
            || a.closest('[data-testid="ad-card"]')
            || a.closest('[data-testid*="listing"]')
            || a.closest('[data-testid*="AdCard"]')
            || a.closest('[class*="ooa-"][class*="card"]')
            || a.closest('[class*="offer-item"]')
            || null;
    }

    function isListingLink(a){
        const href = (a.getAttribute("href") || "").toLowerCase();
        if(!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return false;
        if(extractId(href)) return true;
        return href.includes("/oferta/") || href.includes("/d/oferta/") || href.includes("/ogloszenie/") || href.includes("/advert/") || href.includes("otomoto") || href.includes("olx");
    }

    // ── Fade ──────────────────────────────────────────────────────────────────
    function applyFade(card, isBanned){
        if(!card) return;
        card.style.opacity = isBanned ? "0.35" : "";
        card.style.filter  = isBanned ? "grayscale(1)" : "";
    }

    // ── Overlay layer ─────────────────────────────────────────────────────────
    function getLayer(){
        let layer = document.getElementById("olx-script-layer");
        if(!layer){
            layer = document.createElement("div");
            layer.id = "olx-script-layer";
            layer.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:999998;pointer-events:none;";
            document.body.appendChild(layer);
        }
        return layer;
    }

    function buildChip(id, data, dbKey){
        const chip = document.createElement("div");
        chip.className = "script-chip";
        chip.setAttribute("data-id", id);
        chip.setAttribute("data-db-key", dbKey);
        chip.style.cssText = [
            "position:fixed",
            "display:flex",
            "gap:4px",
            "align-items:center",
            "background:rgba(0,0,0,0.78)",
            "border-radius:6px",
            "padding:3px 7px",
            "pointer-events:auto",
            "cursor:default",
            "z-index:999999",
            "font-family:sans-serif",
        ].join(";");

        if(data.viewedAt){
            const eye = document.createElement("span");
            eye.textContent = "\uD83D\uDC41";
            eye.style.cssText = "font-size:12px;line-height:1;opacity:0.9;pointer-events:none;";
            chip.appendChild(eye);
        }

        const r = getRatingStyle(data.rating);
        const star = document.createElement("span");
        star.textContent = r.label;
        star.style.cssText = "font-size:14px;color:"+r.color+";line-height:1;cursor:pointer;user-select:none;";
        star.addEventListener("click", e=>{ e.preventDefault(); e.stopPropagation(); setRatingByKey(id, dbKey); });
        chip.appendChild(star);

        const commentBox = document.createElement("div");
        commentBox.style.cssText = [
            "display:flex",
            "flex-direction:column",
            "align-items:flex-start",
            "gap:2px",
            "max-width:90px",
        ].join(";");

        const commentLabel = document.createElement("span");
        commentLabel.className = "comment-label";
        commentLabel.textContent = data.comment || "comment";
        commentLabel.style.cssText = [
            "font-size:9px",
            "font-weight:bold",
            "color:#fff7b2",
            "background:rgba(255,247,178,0.16)",
            "border:1px solid rgba(255,247,178,0.45)",
            "border-radius:999px",
            "padding:1px 5px",
            "max-width:80px",
            "white-space:nowrap",
            "overflow:hidden",
            "text-overflow:ellipsis",
            "line-height:1.2",
        ].join(";");
        commentBox.appendChild(commentLabel);

        const commentInput = document.createElement("input");
        commentInput.className = "comment-input";
        commentInput.type = "text";
        commentInput.id = "comment-input-" + String(dbKey).replace(/[^a-z0-9]+/gi, "-");
        commentInput.name = commentInput.id;
        commentInput.setAttribute("autocomplete", "off");
        commentInput.setAttribute("aria-label", "Comment");
        commentInput.maxLength = 30;
        commentInput.placeholder = "comment";
        commentInput.value = data.comment || "";
        commentInput.title = "Short comment (max 30 chars)";
        commentInput.style.cssText = [
            "width:90px",
            "padding:2px 4px",
            "border-radius:4px",
            "border:1px solid rgba(255,255,255,0.25)",
            "background:rgba(255,255,255,0.12)",
            "color:white",
            "font-size:9px",
            "outline:none",
            "box-sizing:border-box",
        ].join(";");
        commentInput.addEventListener("mousedown", e => { e.stopPropagation(); suppressRender = true; });
        commentInput.addEventListener("pointerdown", e => { e.stopPropagation(); suppressRender = true; });
        commentInput.addEventListener("focus", () => { suppressRender = true; });
        commentInput.addEventListener("keydown", () => { suppressRender = true; });
        commentInput.addEventListener("blur", () => { suppressRender = false; updateVisibleComment(dbKey, commentInput.value); });
        commentInput.addEventListener("input", e => {
            const value = normalizeComment(e.target.value);
            e.target.value = value;
            commentLabel.textContent = value || "comment";
            setCommentByKey(id, dbKey, value);
        });
        commentBox.appendChild(commentInput);
        chip.appendChild(commentBox);

        const btn = document.createElement("button");
        btn.textContent = data.banned ? "BANNED" : "BAN";
        btn.style.cssText = [
            "background:" + (data.banned ? "#cc0000" : "#222"),
            "color:white",
            "border:none",
            "font-size:9px",
            "font-weight:bold",
            "padding:2px 5px",
            "border-radius:3px",
            "cursor:pointer",
            "line-height:1.4",
        ].join(";");
        btn.addEventListener("click", e=>{
            e.preventDefault();
            e.stopPropagation();
            data.banned ? unbanByKey(id, dbKey) : banByKey(id, dbKey);
        });
        chip.appendChild(btn);

        return chip;
    }

    function positionChip(chip, card){
        const heart    = card.querySelector(HEART_SEL);
        const cardRect = card.getBoundingClientRect();
        let top, left;
        if(heart){
            const hr = heart.getBoundingClientRect();
            top  = hr.top  + (hr.height - 24) / 2;
            left = hr.left - chip.offsetWidth - 6;
            if(chip.offsetWidth === 0) left = hr.left - 80;
        } else {
            top  = cardRect.top  + 8;
            left = cardRect.right - 90;
        }
        chip.style.top  = Math.round(top)  + "px";
        chip.style.left = Math.round(left) + "px";
    }

    function renderList(){
        const layer  = getLayer();
        const pageId = getCurrentId();
        const db     = getDB();

        layer.querySelectorAll(".script-chip").forEach(c => c.remove());

        const visited = new Set();

        document.querySelectorAll("a[href]").forEach(a => {
            const id = extractId(a.href);
            if(!id || id === pageId) return;
            if(!isListingLink(a)) return;
            if(a.closest("header") || a.closest("nav") ||
               a.closest('[role="dialog"]') || a.closest("#notification-hub-dropdown")) return;

            const card = getCard(a);
            if(!card || visited.has(card)) return;
            visited.add(card);

            const dbKey = makeKeyFromUrl(a.href);
            if(!dbKey) return;
            const data  = db[dbKey] || {};
            applyFade(card, data.banned);

            const chip = buildChip(id, data, dbKey);
            chip.setAttribute("data-href", a.href);
            layer.appendChild(chip);
            requestAnimationFrame(() => positionChip(chip, card));
        });
    }

    function repositionAll(){
        const layer = getLayer();
        layer.querySelectorAll(".script-chip").forEach(chip => {
            const id   = chip.getAttribute("data-id");
            const href = chip.getAttribute("data-href");
            if(!id) return;
            let a = href
                ? document.querySelector('a[href="'+href+'"]') || document.querySelector('a[href*="-ID'+id+'"]')
                : document.querySelector('a[href*="-ID'+id+'"]');
            if(!a) return;
            const card = getCard(a);
            if(card) positionChip(chip, card);
        });
    }

    // ── Detail page UI ────────────────────────────────────────────────────────
    function cleanupUI(){
        document.getElementById("ban-ui")?.remove();
        document.getElementById("ban-bar")?.remove();
    }

    function renderBanner(id, data){
        if(!data.banned) return;
        const bar = document.createElement("div");
        bar.id = "ban-bar";
        bar.style.cssText = [
            "position:fixed","bottom:0","left:0","width:100%",
            "z-index:2147483647",
            "background:linear-gradient(90deg,#b00000,#ff2b2b)",
            "color:white","display:flex","align-items:center",
            "justify-content:center","gap:14px","padding:10px 20px",
            "box-sizing:border-box","font-family:sans-serif",
            "font-size:14px","font-weight:bold",
        ].join(";");
        const label = document.createElement("span");
        const commentText = data.comment ? " | comment: " + data.comment : "";
        label.textContent = "\uD83D\uDEAB BANNED | ID: "+id+" | since: "+formatDate(data.bannedAt) + commentText;
        const ubtn = document.createElement("button");
        ubtn.textContent = "UNBAN";
        ubtn.style.cssText = "background:white;color:#b00000;border:none;padding:5px 12px;border-radius:5px;cursor:pointer;font-weight:bold;font-size:13px;";
        ubtn.addEventListener("click", () => unban(id));
        bar.appendChild(label);
        bar.appendChild(ubtn);
        document.body.appendChild(bar);
    }

    function renderPage(){
        const id = getCurrentId();
        if(!id) return;
        updateViewed();
        const db   = getDB();
        const data = db[makeKey(id)] || {};

        const ui = document.createElement("div");
        ui.id = "ban-ui";
        ui.style.cssText = [
            "position:fixed","bottom:" + (data.banned ? "76px" : "20px") + "","right:20px",
            "z-index:2147483647",
            "background:rgba(0,0,0,0.92)",
            "padding:10px 14px","border-radius:10px",
            "display:flex","gap:10px","align-items:center",
            "font-family:sans-serif",
        ].join(";");

        const eye = document.createElement("span");
        eye.textContent = "\uD83D\uDC41";
        eye.style.cssText = "font-size:18px;opacity:0.9;";
        ui.appendChild(eye);

        const r = getRatingStyle(data.rating);
        const star = document.createElement("span");
        star.textContent = r.label;
        star.style.cssText = "font-size:22px;color:"+r.color+";cursor:pointer;user-select:none;";
        star.addEventListener("click", () => setRating(id));
        ui.appendChild(star);

        const commentBox = document.createElement("div");
        commentBox.style.cssText = [
            "display:flex",
            "flex-direction:column",
            "align-items:flex-start",
            "gap:2px",
            "min-width:120px",
            "max-width:140px",
        ].join(";");

        const commentLabel = document.createElement("span");
        commentLabel.className = "comment-label";
        commentLabel.textContent = data.comment || "comment";
        commentLabel.style.cssText = [
            "font-size:11px",
            "color:rgba(255,255,255,0.95)",
            "white-space:nowrap",
            "overflow:hidden",
            "text-overflow:ellipsis",
            "max-width:100%",
        ].join(";");
        commentBox.appendChild(commentLabel);

        const commentInput = document.createElement("input");
        commentInput.className = "comment-input";
        commentInput.type = "text";
        commentInput.id = "comment-input-" + String(id).replace(/[^a-z0-9]+/gi, "-");
        commentInput.name = commentInput.id;
        commentInput.setAttribute("autocomplete", "off");
        commentInput.setAttribute("aria-label", "Comment");
        commentInput.maxLength = 30;
        commentInput.placeholder = "comment";
        commentInput.value = data.comment || "";
        commentInput.title = "Short comment (max 30 chars)";
        commentInput.style.cssText = [
            "width:100%",
            "padding:6px 8px",
            "border-radius:6px",
            "border:1px solid rgba(255,255,255,0.2)",
            "background:rgba(255,255,255,0.12)",
            "color:white",
            "font-size:12px",
            "outline:none",
            "box-sizing:border-box",
        ].join(";");
        commentInput.addEventListener("mousedown", e => { e.stopPropagation(); suppressRender = true; });
        commentInput.addEventListener("pointerdown", e => { e.stopPropagation(); suppressRender = true; });
        commentInput.addEventListener("focus", () => { suppressRender = true; });
        commentInput.addEventListener("keydown", () => { suppressRender = true; });
        commentInput.addEventListener("blur", () => { suppressRender = false; updateVisibleComment(makeKey(id), commentInput.value); });
        commentInput.addEventListener("input", e => {
            const value = normalizeComment(e.target.value);
            e.target.value = value;
            commentLabel.textContent = value || "comment";
            setComment(id, value);
        });
        commentBox.appendChild(commentInput);
        ui.appendChild(commentBox);

        const btn = document.createElement("button");
        btn.textContent = data.banned ? "UNBAN" : "BAN";
        btn.style.cssText = [
            "background:" + (data.banned ? "red" : "#222"),
            "color:white","border:none",
            "padding:6px 12px","border-radius:6px",
            "cursor:pointer","font-weight:bold","font-size:13px",
        ].join(";");
        btn.addEventListener("click", () => data.banned ? unban(id) : ban(id));
        ui.appendChild(btn);

        document.body.appendChild(ui);
        renderBanner(id, data);
    }

    // ── Main render ───────────────────────────────────────────────────────────
    let suppressRender = false;
    function render(){
        if(suppressRender) return;
        cleanupUI();
        renderList();
        renderPage();
    }

    // ── Observer ──────────────────────────────────────────────────────────────
    let observerPaused = false;
    function startObserver(){
        let scheduled = false;
        new MutationObserver(mutations => {
            if(observerPaused) return;
            const isOurs = mutations.every(m =>
                [...m.addedNodes, ...m.removedNodes].every(n =>
                    n.nodeType !== 1 ||
                    n.id === "olx-script-layer" ||
                    n.id === "ban-ui" ||
                    n.id === "ban-bar" ||
                    n.classList?.contains("script-chip")
                )
            );
            if(isOurs) return;
            if(scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => { renderList(); scheduled = false; });
        }).observe(document.body, { childList:true, subtree:true });
    }

    function startPositionWatch(){
        let rafId = null;
        const onMove = () => {
            if(rafId) return;
            rafId = requestAnimationFrame(() => { repositionAll(); rafId = null; });
        };
        window.addEventListener("scroll", onMove, { passive:true });
        window.addEventListener("resize", onMove, { passive:true });
    }

    function startNavWatch(){
        let last = location.href;
        setInterval(() => {
            if(location.href !== last){
                last = location.href;
                observerPaused = true;
                render();
                setTimeout(() => { observerPaused = false; }, 600);
            }
        }, 800);
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    async function init(){
        const token = getToken();
        if(!token){
            showTokenPrompt(t => { if(t) init(); else runWithoutSync(); });
            return;
        }

        try {
            if(GIST_ID){
                const remote = await fetchGist();
                if(remote){
                    const merged = mergeDBs(getDB(), remote);
                    saveDB(merged);
                }
            } else if(token){
                await createGist(getDB());
            }
        } catch(e){
            if(e.message === "INVALID_TOKEN"){
                showTokenPrompt(t => { if(t) init(); else runWithoutSync(); });
                return;
            }
            console.warn("[OLX/Otomoto script] Init sync error:", e);
        }

        runWithoutSync();
    }

    function runWithoutSync(){
        render();
        startObserver();
        startPositionWatch();
        startNavWatch();
    }

    init();

})();