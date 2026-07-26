// =====================================
// TOKENS.JS — Token Manager + State
// Gabungan tokenManager.js + tokens.js
// =====================================

// ===== ONE-TIME CLEANUP — hapus setelah dijalankan sekali =====
if (!localStorage.getItem("_cleanup_done_v1")) {
    localStorage.removeItem("customTokens");
    Object.keys(localStorage).forEach(k => {
        if (/^0x[0-9a-fA-F]+_/.test(k)) localStorage.removeItem(k);
    });
    localStorage.setItem("_cleanup_done_v1", "1");
    console.log("Cleanup selesai");
}
// ===== END CLEANUP =====

// ===== ONE-TIME MIGRATION — tandai token lama sebagai manual =====
if (!localStorage.getItem("_migrate_manual_v1")) {
    try {
        const raw = JSON.parse(localStorage.getItem("customTokens") || "[]");
        const migrated = raw.map(tk => ({ ...tk, manual: true }));
        localStorage.setItem("customTokens", JSON.stringify(migrated));
        console.log("Migrasi manual flag selesai:", migrated.length, "token");
    } catch (e) {
        console.error("[migrate manual]", e);
    }
    localStorage.setItem("_migrate_manual_v1", "1");
}
// ===== END MIGRATION =====

// ===== ONE-TIME CLEANUP — hapus custom token yang duplikat dgn dirinya sendiri =====
if (!localStorage.getItem("_dedupe_custom_v1")) {
    try {
        const custom = JSON.parse(localStorage.getItem("customTokens") || "[]");
        const seen = new Set();
        const deduped = custom.filter(t => {
            const key = (t.address || "").toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        localStorage.setItem("customTokens", JSON.stringify(deduped));
        console.log("Dedupe customTokens selesai:", custom.length, "->", deduped.length);
    } catch (e) {
        console.error("[dedupe custom]", e);
    }
    localStorage.setItem("_dedupe_custom_v1", "1");
}
// ===== END CLEANUP =====

// =====================================
// GLOBAL TOKEN STATE
// =====================================
window.selectedToken     = localStorage.getItem("selectedToken") || "native";
window.selectedTokenData = null;
window.TOKENS            = [];

let DEFAULT_TOKENS = [];
let customTokens   = JSON.parse(localStorage.getItem("customTokens") || "[]");

function _t(key, fallback) {
    try {
        const lang = window.CURRENT_LANG || "id";
        return (window.LANG?.[lang]?.[key]) || fallback;
    } catch { return fallback; }
}
// =====================================
// NORMALIZER — satu sumber kebenaran
// =====================================
function normalizeToken(t) {
    return {
        symbol:    t.symbol,
        name:      t.name     || t.symbol,
        address:   t.address,
        logo:      t.logo     || ("img/" + (t.icon || "default.png")),
        decimals:  t.decimals || 18,
        type:      t.type     || "erc20",
        isNative:  t.address  === "native",
        manual:    t.manual   || false,
        userAdded: t.userAdded || false
    };
}


// =====================================
// STORAGE HELPERS
// =====================================
function getCustomTokens() {
    try   { return JSON.parse(localStorage.getItem("customTokens") || "[]"); }
    catch { return []; }
}

function saveCustomTokens(data) {
    localStorage.setItem("customTokens", JSON.stringify(data));
}

// =====================================
// AGGREGATOR CANDIDATE STORAGE
// =====================================
function getAggregatorCandidates() {
    try {
        return JSON.parse(
            localStorage.getItem("aggregatorCandidates") || "[]"
        );
    } catch {
        return [];
    }
}

function saveAggregatorCandidates(data) {
    localStorage.setItem(
        "aggregatorCandidates",
        JSON.stringify(data)
    );
}
// =====================================
// REBUILD GLOBAL TOKENS
// =====================================
function rebuildTokens() {
    customTokens = getCustomTokens();
    window.customTokens = customTokens;

    const combined = [
        ...DEFAULT_TOKENS,
        ...customTokens.map(normalizeToken)
    ];

    const seen = new Set();
    window.TOKENS = combined.filter(t => {
        const key = (t.address || "").toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}


// =====================================
// LOAD TOKENS.JSON
// =====================================
async function loadDefaultTokens() {
    try {

        let raw;

        // Android WebView: pakai AndroidWallet.readAsset (sama seperti lang.js)
        if (window.AndroidWallet && typeof window.AndroidWallet.readAsset === "function") {
            const text = window.AndroidWallet.readAsset("data/tokens.json");
            if (!text) throw new Error("tokens.json kosong");
            raw = JSON.parse(text);

        } else {
            // Browser biasa (development): pakai fetch
            const res = await fetch("data/tokens.json");
            if (!res.ok) throw new Error("HTTP " + res.status);
            raw = await res.json();
        }

        DEFAULT_TOKENS = raw.map(normalizeToken);
        rebuildTokens();

    } catch (e) {
        console.error("[loadDefaultTokens]", e);
    }
}

// =====================================
// GETTERS
// =====================================
function getAllTokens()  { return window.TOKENS || []; }
function getHomeTokens() { return getAllTokens(); }
function getSendTokens() { return getAllTokens(); }

function getSwapTokens() {
    return getAllTokens().filter(t => t.symbol !== "WSDA");
}

function getTokenData(addr) {
    if (!addr) return { symbol: "?", logo: "img/default.png" };

    const token = getAllTokens().find(
        t => t.address?.toLowerCase() === addr.toLowerCase()
    );

    if (token) return { ...token };

    return {
        symbol: addr.slice(0, 6) + "...",
        logo:   "img/default.png"
    };
}

// alias — dipanggil di ui.js dan app.js
function syncCustomTokens() { rebuildTokens(); }
function syncTokenState()   { rebuildTokens(); }


// =====================================
// SET GLOBAL TOKEN — satu-satunya pintu
// untuk ganti token aktif
// =====================================
function setGlobalToken(val) {

    window.selectedToken = val || "native";
    localStorage.setItem("selectedToken", window.selectedToken);

    let logo = "img/sda.png";

    if (val === "native" || !val) {
        window.selectedTokenData = {
            symbol:   "SDA",
            type:     "native",
            decimals: 18,
            logo:     "img/sda.png"
        };
    } else {
        const token = getAllTokens().find(t => t.address === val);
        if (token) {
            logo = token.logo || "img/default.png";
            window.selectedTokenData = { ...token, type: "erc20" };
        }
    }

    // Sync dropdown
    const mainSelect = document.getElementById("tokenSelect");
    const sendSelect = document.getElementById("sendTokenSelect");
    if (mainSelect) mainSelect.value = val;
    if (sendSelect) sendSelect.value = val;

    // Sync icon
    const logoBalance  = document.getElementById("tokenLogoBalance");
    const logoDropdown = document.getElementById("tokenLogoDropdown");
    if (logoBalance)  logoBalance.src  = logo;
    if (logoDropdown) logoDropdown.src = logo;

    // Sync semua modul
    syncSendTokenUI?.();
    applySendTokenState?.();
    loadBalance?.();
    updateSendBalance?.();
    renderAssets?.();
}


// =====================================
// RENDER TOKEN SELECT (HOME DROPDOWN)
// =====================================
function renderTokenSelect() {

    const select = document.getElementById("tokenSelect");
    if (!select) return;

    select.innerHTML = "";

    getAllTokens().forEach(t => {
        const opt          = document.createElement("option");
        opt.value          = t.address;
        opt.textContent    = t.symbol;
        opt.dataset.icon   = t.logo || "img/default.png";
        select.appendChild(opt);
    });

    select.value = window.selectedToken || "native";

    select.onchange = (e) => setGlobalToken(e.target.value);
}


// =====================================
// TOKEN POPUP DROPDOWN
// =====================================
function openTokenDropdown(target) {

    const tokens = getAllTokens();

    const itemsHTML = tokens.map(t => `
        <div class="token-item"
             data-address="${t.address}"
             data-symbol="${t.symbol.toLowerCase()}">
            <img src="${t.logo || 'img/default.png'}"
                 onerror="this.src='img/default.png'"
                 style="width:28px;height:28px;border-radius:50%;object-fit:contain;">
            <div>
                <b>${t.symbol}</b><br>
                <small style="color:#888;">${t.name}</small>
            </div>
        </div>
    `).join("");

    const box = document.createElement("div");
    box.id = "tokenPopup";
    box.innerHTML = `
        <div class="popup-bg"></div>
        <div class="popup">
            <div class="token-search">
                <input id="tokenSearchInput" placeholder="Search token...">
            </div>
            <div id="tokenList">${itemsHTML}</div>
        </div>
    `;

    document.body.appendChild(box);

    // Search filter
    box.querySelector("#tokenSearchInput")?.addEventListener("input", (e) => {
        const kw = e.target.value.toLowerCase();
        box.querySelectorAll(".token-item").forEach(item => {
            item.style.display = item.dataset.symbol.includes(kw) ? "flex" : "none";
        });
    });

    // Select token
    box.addEventListener("click", (e) => {
        if (e.target.classList.contains("popup-bg")) { box.remove(); return; }

        const item = e.target.closest(".token-item");
        if (!item) return;

        const addr = item.dataset.address;
        setGlobalToken(addr);
        box.remove();
    });
}

// Intercept native dropdown — pakai popup
document.getElementById("tokenSelect")?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    openTokenDropdown("home");
});

document.getElementById("sendTokenSelect")?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    openTokenDropdown("send");
});


// =====================================
// ADD TOKEN FROM LIST (token tab)
// =====================================
async function addTokenFromList(token) {

    let custom = getCustomTokens();

    if (custom.length >= (window.MAX_CUSTOM_TOKENS ?? Infinity)) {
        return showToast(t("max_token") || "Max token reached", "error");
    }

    const exist = custom.find(
        t => t.address.toLowerCase() === token.address.toLowerCase()
    );
    if (exist) return showToast(t("token_exists") || "Sudah ditambahkan", "error");

    custom.push({ ...token, manual: true, userAdded: true });
    saveCustomTokens(custom);
    rebuildTokens();

    showToast(t("token_added") || "Token ditambahkan", "success");

    const wallet = getSelectedWallet?.();
    switchTab?.("assets");

    if (wallet) {
        try {
            const abi = [
                "function balanceOf(address) view returns (uint256)",
                "function decimals() view returns (uint8)"
            ];
            const contract = new ethers.Contract(token.address, abi, provider);
            const [bal, dec] = await Promise.all([
                contract.balanceOf(wallet.address),
                contract.decimals().catch(() => 18)
            ]);
            const value = parseFloat(ethers.utils.formatUnits(bal, dec)).toFixed(4);
            localStorage.setItem(wallet.address + "_" + token.address, value + " " + token.symbol);
        } catch {
            const key = wallet.address + "_" + token.address;
            if (!localStorage.getItem(key)) {
                localStorage.setItem(key, "0.00 " + token.symbol);
            }
        }
    }

    renderAssets?.();
    renderTokenTab?.();
    renderTokenSelect?.();
}


// =====================================
// ADD TOKEN MANUAL (dari input address)
// =====================================
async function addToken(symbol, address) {

    symbol  = symbol.trim().toUpperCase();
    address = address.trim();

    if (!ethers.utils.isAddress(address)) {
        return showToast(t("invalid_address") || "Invalid contract address", "error");
    }

    const exists = getAllTokens().find(
        t => t.address.toLowerCase() === address.toLowerCase()
    );
    if (exists) return showToast(t("token_exists") || "Token already added", "error");

    let custom = getCustomTokens();

    if (custom.length >= (window.MAX_CUSTOM_TOKENS ?? Infinity)) {
        return showToast(t("max_token") || "Max token reached", "error");
    }

    const newToken = normalizeToken({ symbol, address, manual: true, userAdded: true });

    custom.push(newToken);
    saveCustomTokens(custom);
    rebuildTokens();

    const wallet = getSelectedWallet?.();

    if (wallet) {
        try {
            const abi = [
                "function balanceOf(address) view returns (uint256)",
                "function decimals() view returns (uint8)"
            ];
            const contract = new ethers.Contract(newToken.address, abi, provider);
            const [bal, dec] = await Promise.all([
                contract.balanceOf(wallet.address),
                contract.decimals().catch(() => 18)
            ]);
            const value = parseFloat(ethers.utils.formatUnits(bal, dec)).toFixed(4);
            localStorage.setItem(wallet.address + "_" + newToken.address, value + " " + newToken.symbol);
        } catch (e) {
            const key = wallet.address + "_" + newToken.address;
            if (!localStorage.getItem(key)) {
                localStorage.setItem(key, "0.00 " + newToken.symbol);
            }
        }
    }

    showToast(t("token_added") || "Token ditambahkan", "success");

    renderAssets?.();
    renderTokenTab?.();
    renderTokenSelect?.();
    renderTokenList?.();
}

// =====================================
// RESET SEMUA TOKEN (manual + hasil detect)
// =====================================
function resetAllTokens() {

    const doReset = () => {
        const wallet = getSelectedWallet?.();

        saveCustomTokens([]);

        if (wallet) {
            const nativeKey = wallet.address + "_native";
            Object.keys(localStorage).forEach(k => {
                if (k === nativeKey) return; // jangan hapus saldo SDA native
                if (k.startsWith(wallet.address + "_") || k === "emptyScanned_" + wallet.address) {
                    localStorage.removeItem(k);
                }
            });
        }

        rebuildTokens();
        renderAssets?.();
        renderTokenTab?.();
        renderTokenSelect?.();

        showToast?.(t("reset_done") || "Semua token direset", "success");
    };

    if (typeof showConfirm === "function") {
        showConfirm(t("reset_token_confirm") || "Hapus semua token (termasuk yang tersembunyi)?", doReset);
    } else if (confirm(t("reset_token_confirm") || "Hapus semua token (termasuk yang tersembunyi)?")) {
        doReset();
    }
}

window.resetAllTokens = resetAllTokens;

// =====================================
// REMOVE TOKEN
// =====================================
function removeToken(address) {

    const doRemove = () => {
        let custom = getCustomTokens();
        custom = custom.filter(
            t => t.address.toLowerCase() !== address.toLowerCase()
        );
        saveCustomTokens(custom);
        rebuildTokens();

        const wallet = getSelectedWallet?.();
        if (wallet) {
            localStorage.removeItem(wallet.address + "_" + address);
        }

        renderAssets?.();
        renderTokenTab?.();
        renderTokenSelect?.();
        renderTokenList?.();

        showToast?.(t("token_removed") || "Token dihapus", "success");
    };

    const msg = t("remove_token_confirm") || "Hapus token ini?";

    if (typeof showConfirm === "function") {
        showConfirm(msg, doRemove);
    } else if (confirm(msg)) {
        doRemove();
    }
}


// =====================================
// RENDER TOKEN LIST (manager page)
// =====================================
function renderTokenList() {

    const list = document.getElementById("token-list");
    if (!list) return;

    list.innerHTML = "";

    customTokens.forEach(token => {
        const div       = document.createElement("div");
        div.style.marginBottom = "6px";
        div.innerHTML = `
            <img src="${token.logo || 'img/default.png'}"
                 onerror="this.src='img/default.png'"
                 style="width:16px;height:16px;margin-right:6px;">
            <span>${token.symbol}</span>
            <button onclick="removeToken('${token.address}')">Remove</button>
        `;
        list.appendChild(div);
    });
}

// =====================================
// AGGREGATOR TOKEN PICKER UI
// =====================================
function openAggregatorCandidatePicker() {

    document.getElementById("aggCandidateModal")?.remove();

    const tokens = getAllTokens().filter(
        t => t.address !== "native"
    );

    const selected = getAggregatorCandidates();

    const html = tokens.map(t => `
        <label class="agg-candidate-item"
               data-symbol="${(t.symbol || '').toLowerCase()}"
               data-name="${(t.name || '').toLowerCase()}">

            <input type="checkbox"
                   value="${t.address}"
                   ${selected.includes(t.address) ? "checked" : ""}>

            <img src="${t.logo || 'img/default.png'}"
                 onerror="this.src='img/default.png'">

            <span>${t.symbol}</span>
        </label>
    `).join("");

    const box = document.createElement("div");
    box.id = "aggCandidateModal";
    box.className = "show";

    box.innerHTML = `
        <div class="agg-candidate-popup">

            <h3>${_t("agg_candidate_title", "Select Aggregator Candidates")}</h3>

            <input
                id="aggCandidateSearch"
                type="text"
                placeholder="Search token..."
                style="
                    width:100%;
                    padding:10px;
                    margin-bottom:10px;
                    border:none;
                    border-radius:10px;
                    background:#111827;
                    color:#fff;
                "
            >

            <div class="agg-candidate-toolbar">
                <button id="aggSelectAllBtn" type="button">
                    Select All
                </button>

                <button id="aggClearAllBtn" type="button">
                    Clear All
                </button>
            </div>

            <div class="agg-candidate-popup-list">
                ${html}
            </div>

            <button id="saveAggCandidatesBtn">
                Save
            </button>

        </div>
    `;

    document.body.appendChild(box);

    // SEARCH FILTER
    box.querySelector("#aggCandidateSearch").oninput = (e) => {
        const q = e.target.value.toLowerCase();

        box.querySelectorAll(".agg-candidate-item")
            .forEach(el => {
                const sym  = el.dataset.symbol || "";
                const name = el.dataset.name || "";

                el.style.display =
                    sym.includes(q) || name.includes(q)
                        ? ""
                        : "none";
            });
    };

    box.querySelector("#aggSelectAllBtn").onclick = () => {
        box.querySelectorAll(
            ".agg-candidate-item input[type='checkbox']"
        ).forEach(cb => cb.checked = true);
    };

    box.querySelector("#aggClearAllBtn").onclick = () => {
        box.querySelectorAll(
            ".agg-candidate-item input[type='checkbox']"
        ).forEach(cb => cb.checked = false);
    };

    box.onclick = (e) => {
        if (e.target === box) box.remove();
    };

    box.querySelector("#saveAggCandidatesBtn").onclick = () => {

        const checked = [
            ...box.querySelectorAll("input:checked")
        ].map(x => x.value);

        saveAggregatorCandidates(checked);

        showToast?.(_t("agg_candidates_updated", "Aggregator candidates updated"), "success");

        box.remove();

        AGGREGATOR?.rescan?.();
    };
}



// =====================================
// INIT
// =====================================
document.addEventListener("DOMContentLoaded", async () => {
    await loadDefaultTokens();

    // set selectedTokenData awal
    setGlobalToken(window.selectedToken);

    renderTokenList?.();
    renderTokenSelect?.();
    renderTokenTab?.();
    loadSendTokens?.();
});


// =====================================
// EXPOSE — kompatibilitas modul lain
// =====================================
// =====================================
// ENSURE TOKEN TRACKED — pastikan token masuk customTokens
// supaya bisa di-render & di-refresh. Dipanggil setelah swap
// sukses ke token yang belum pernah ditambahkan user.
// =====================================
function ensureTokenTracked(addr) {
    if (!addr || addr === "native") return;

    const custom = getCustomTokens();
    const exists = custom.find(
        t => t.address.toLowerCase() === addr.toLowerCase()
    );

    if (exists) {
        // Sudah ada tapi belum userAdded (misal dari detect lama) —
        // upgrade jadi userAdded supaya tidak hilang kalau saldo sempat 0
        if (!exists.userAdded) {
            exists.userAdded = true;
            saveCustomTokens(custom);
            rebuildTokens();
        }
        return;
    }

    // Cari metadata dari DEFAULT_TOKENS (tokens.json)
    const meta = (DEFAULT_TOKENS || []).find(
        t => t.address?.toLowerCase() === addr.toLowerCase()
    );

    if (!meta) return; // token tidak dikenal sama sekali — skip, tidak bisa dapat symbol/decimals

    if (custom.length >= (window.MAX_CUSTOM_TOKENS ?? Infinity)) return; // hormati limit

    custom.push({ ...meta, manual: true, userAdded: true });
    saveCustomTokens(custom);
    rebuildTokens();
}

window.ensureTokenTracked = ensureTokenTracked;

window.tokenmanager = {
    loadDefaultTokens,
    rebuildTokens,
    getAllTokens,
    getHomeTokens,
    getSendTokens,
    getSwapTokens,
    getTokenData,
    syncCustomTokens
};

window.SIDRAPULSE = window.tokenmanager;

window.openAggregatorCandidatePicker =
    openAggregatorCandidatePicker;
