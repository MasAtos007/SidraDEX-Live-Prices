// ==========================
// SAFE GLOBAL CHECK
// ==========================
const _ethers = window.ethers;
const provider = window.provider;


// ==========================
// HARDCODE TOKEN PRICE (USD)
// Key HARUS sama persis dengan "symbol" di data/tokens.json
// Generated otomatis dari tokens.json Ã¢â‚¬â€ tinggal isi harga yang masih 0
// ==========================
const TOKEN_PRICE_USD = {
    "SDA": 15,
    "WSDA": 0,
    "USDX": 1,
    "sUSDT": 1,
    "FREEt": 0,
    "GLNs": 0,
    "SDS": 0,
    "FBAY": 0,
    "SMAf": 0,
    "AIR": 0,
    "ARMS": 0,
    "HEC": 0,
    "REGS": 0,
    "EWM": 0,
    "VPA": 0,
    "GPC": 0,
    "ZSM": 0,
    "SIT": 0,
    "STSX": 0,
    "WPX": 0,
    "SLND": 0,
    "DBI": 0,
    "SKMH": 0,
    "QSM": 0,
    "MBF": 0,
    "SGWA": 0,
    "VLCP": 0,
    "VPD": 0,
    "IDM": 0,
    "LNH": 0,
    "TRL": 0,
    "SFAR": 0,
    "DAN": 0,
    "VMB": 0,
    "SUBV": 0,
    "DIIGE": 0,
    "ECSDA": 0,
    "SDFL": 0,
    "TAP": 0,
    "IFC": 0,
    "AITT": 0,
    "CSF": 0,
    "GSML": 0,
    "GACP": 0,
    "AFRA": 0,
    "VPM": 0,
    "NGEC": 0,
    "RIDEX": 0,
    "SSET": 0,
    "ATES": 0,
    "DMCS": 0,
    "HAQ": 0,
    "AILP": 0,
    "BZST": 0,
    "ALNS": 0,
    "SDIP": 0,
    "DQLP": 0,
    "GTAP": 0,
    "SMRX": 0,
    "SAHBA": 0,
    "DGPT": 0,
    "ACV": 0,
    "VPE": 0,
    "JSFT": 0,
    "TKWF": 0,
    "SGHC": 0,
    "AMHS": 0,
    "SSMI": 0,
    "FLT": 0,
    "DBN": 0,
    "FEX": 0,
    "IPT": 0,
    "XEN": 0,
    "TAMBN": 0,
    "BCS": 0,
    "EZY": 0,
    "SDO": 0,
    "HLMR": 0,
    "ONETK": 0,
    "SDX": 0,
    "PCH": 0,
    "BINV": 0,
    "AGFU": 0,
    "HGM": 0,
    "IX": 0,
    "FARMT": 0,
    "EMI": 0,
    "GDBN": 0,
    "GCT": 0,
    "SQS": 0
};

// ==========================
// HITUNG HARGA USD TOKEN
// MODE 1 (aktif): pool stablecoin ter-WHITELIST di DEX Sidra, DENGAN
//        syarat likuiditasnya lolos ambang minimum â€” bukan sekadar
//        "ada pool", karena siapa saja bisa bikin pool token bernama
//        mirip stablecoin tanpa jaminan pegged 1:1 ke USD.
// MODE 2 (fallback): SDA manual dari TOKEN_PRICE_USD,
//        token lain otomatis dari pool (PRICE_ENGINE) dikali harga SDA
// Fallback akhir: manual dari TOKEN_PRICE_USD kalau semua di atas gagal
// ==========================

// WHITELIST STABLECOIN â€” HANYA token yang statusnya sudah kamu percaya
// masuk ke sini. Ini keputusan MANUAL, bukan otomatis dari tokens.json,
// supaya token abal-abal yang kebetulan namanya "USDX"/"USDT" tidak
// otomatis ikut jadi acuan harga SDA cuma karena ada yang bikin pool-nya.
//
// Urutan array = prioritas: yang pertama lolos cek likuiditas (lihat
// MIN_STABLECOIN_LIQUIDITY_USD di bawah) yang dipakai.
const STABLECOIN_WHITELIST = [
    { symbol: "sUSDT", address: "0xBcd27707F604F9f9be1a5f8c5C17Fee0F9630B38" }
    // USDX sengaja BELUM dimasukkan â€” pool-nya cuma ~14.7 USDX (~$15),
    // volume nyaris kosong (23 swap/24h), gampang dimanipulasi 1 wallet.
    // Tambahkan lagi ke sini kalau likuiditasnya sudah lebih sehat, atau
    // sudah ada konfirmasi resmi dari tim Sidra.
];

// Ambang minimum likuiditas (estimasi kedua sisi pool, dalam USD) supaya
// sebuah pool stablecoin dipercaya jadi acuan harga. Di bawah ini,
// dianggap terlalu tipis/rawan manipulasi â€” diskip, lanjut ke kandidat
// berikutnya di whitelist (atau fallback manual kalau semua gagal).
const MIN_STABLECOIN_LIQUIDITY_USD = 200;

let _activeStablecoinCache = { addr: null, resolved: false, ts: 0 };
const ACTIVE_STABLECOIN_CACHE_TTL = 45_000;

// Cari kandidat pertama di STABLECOIN_WHITELIST yang: (a) pool-nya ada,
// (b) likuiditasnya lolos MIN_STABLECOIN_LIQUIDITY_USD. Return null kalau
// tidak ada satupun yang lolos â€” pemanggil WAJIB fallback ke harga manual.
async function getActiveStablecoinAddress() {
    if (_activeStablecoinCache.resolved && (Date.now() - _activeStablecoinCache.ts) < ACTIVE_STABLECOIN_CACHE_TTL) {
        return _activeStablecoinCache.addr;
    }

    let resolved = null;

    if (window.PRICE_ENGINE && typeof window.PRICE_ENGINE.getPoolLiquidity === "function") {
        for (const sc of STABLECOIN_WHITELIST) {
            try {
                const liq = await window.PRICE_ENGINE.getPoolLiquidity(sc.address, "native");
                if (!liq) continue;

                const isSide0 = sc.address.toLowerCase() === liq.token0.toLowerCase();
                const rawReserve = isSide0 ? liq.reserve0 : liq.reserve1;
                const stableReserve = rawReserve / (10 ** 18); // stablecoin whitelist di sini semua 18 desimal

                // Estimasi nilai TOTAL pool dalam USD â€” pakai reserve sisi
                // stablecoin dikali 2 (asumsi kedua sisi pool ~setara nilai,
                // sama seperti pendekatan liqValue di tempat lain di app ini).
                const liquidityUsdEstimate = stableReserve * 2;

                if (liquidityUsdEstimate >= MIN_STABLECOIN_LIQUIDITY_USD) {
                    resolved = sc.address;
                    break;
                } else {
                    console.warn(`[stablecoin whitelist] ${sc.symbol} likuiditas $${liquidityUsdEstimate.toFixed(2)} < ambang $${MIN_STABLECOIN_LIQUIDITY_USD}, dilewati`);
                }
            } catch (e) {
                console.warn("[stablecoin whitelist] cek liquidity gagal untuk", sc.symbol, e);
            }
        }
    }

    _activeStablecoinCache = { addr: resolved, resolved: true, ts: Date.now() };
    return resolved;
}

// ==========================
// HARGA SDA LIVE (dengan fallback manual)
// Dipakai di SEMUA tempat yang butuh harga SDA â€” supaya begitu ada
// stablecoin baru yang lolos whitelist + ambang likuiditas, SEMUA jalur
// (bukan cuma sebagian) otomatis ikut pindah, bukan cuma satu tempat.
// ==========================
let _liveSdaPriceCache = { value: null, ts: 0 };
const SDA_PRICE_CACHE_TTL = 45_000;

async function getLiveSdaPrice() {
    if (_liveSdaPriceCache.value !== null && (Date.now() - _liveSdaPriceCache.ts) < SDA_PRICE_CACHE_TTL) {
        return _liveSdaPriceCache.value;
    }

    let price = TOKEN_PRICE_USD["SDA"] || 0; // fallback manual

    const stablecoinAddr = await getActiveStablecoinAddress();

    if (stablecoinAddr && window.PRICE_ENGINE && typeof window.PRICE_ENGINE.getPrice === "function") {
        try {
            const ratio = await window.PRICE_ENGINE.getPrice("native", stablecoinAddr);
            if (ratio > 0) price = ratio; // pool lolos whitelist + ambang â†’ pakai harga live
        } catch (e) {
            console.warn("[SDA price] getPrice via stablecoin gagal:", e);
        }
    }

    _liveSdaPriceCache = { value: price, ts: Date.now() };
    return price;
}

const _usdPriceCache = {}; // { [symbol]: { value, ts } }
const PRICE_CACHE_TTL = 45_000;

async function getTokenUsdPrice(symbol) {

    const cached = _usdPriceCache[symbol];
    if (cached && (Date.now() - cached.ts) < PRICE_CACHE_TTL) {
        return cached.value;
    }

    let price = 0;

    const stablecoinAddr = await getActiveStablecoinAddress();

    if (stablecoinAddr && window.PRICE_ENGINE && typeof window.PRICE_ENGINE.getPrice === "function") {
        try {
            const tokenAddr = (symbol === "SDA")
                ? "native"
                : (window.TOKENS || []).find(t => t.symbol === symbol)?.address;

            if (tokenAddr) {
                const ratio = await window.PRICE_ENGINE.getPrice(tokenAddr, stablecoinAddr);
                if (ratio > 0) price = ratio;
            }
        } catch (e) {
            console.warn("[USD] getPrice via stablecoin gagal untuk", symbol, e);
        }
    }

    if (!price) {
        const sdaPrice = await getLiveSdaPrice();

        if (symbol === "SDA" || symbol === "WSDA") {
            price = sdaPrice;
        } else {
            // Kalau RPC baru saja gagal (ditandai flag global), jangan coba
            // getPrice() satu-satu lagi di sini â€” itu yang memicu request
            // storm waktu dipanggil untuk banyak token sekaligus dari renderAssets.
            // Langsung pakai harga manual, biar cepat & tidak nembak RPC lagi.
            if (!window._rpcDownUntil || Date.now() > window._rpcDownUntil) {
                const token = (window.TOKENS || []).find(t => t.symbol === symbol);

                if (token && window.PRICE_ENGINE && typeof window.PRICE_ENGINE.getPrice === "function") {
                    try {
                        const ratio = await window.PRICE_ENGINE.getPrice(token.address, "native");
                        if (ratio > 0) price = ratio * sdaPrice;
                    } catch (e) {
                        console.warn("[USD] getPrice gagal untuk", symbol, e);
                        // Tandai RPC down selama 20 detik â€” cegah token
                        // berikutnya dalam loop yang sama ikut mencoba RPC lagi.
                        window._rpcDownUntil = Date.now() + 20_000;
                    }
                }
            }

            if (!price) price = TOKEN_PRICE_USD[symbol] || 0;
        }
    }

    _usdPriceCache[symbol] = { value: price, ts: Date.now() };
    return price;
}

async function formatUSD(amount, symbol) {
    const price = await getTokenUsdPrice(symbol);
    const usd = amount * price;
    return "~ $" + usd.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }) + " USD";
}



async function batchGetTokenUsdPrices(tokens) {
    const sdaPrice = await getLiveSdaPrice();
    const out = {};

    if (!tokens.length) return out;

    if (typeof window.batchGetTokenPricesInWSDA !== "function") {
        // fallback total kalau batch price engine belum siap
        for (const t of tokens) out[t.symbol] = await getTokenUsdPrice(t.symbol);
        return out;
    }

    try {
        // 1x panggilan untuk SEMUA token (di dalamnya maksimal 2 HTTP request)
        const ratios = await window.batchGetTokenPricesInWSDA(tokens.map(t => t.address));

        tokens.forEach(t => {
            if (t.symbol === "WSDA") {
                out[t.symbol] = sdaPrice;
            } else {
                const ratio = ratios[t.address] || 0;
                out[t.symbol] = ratio > 0 ? ratio * sdaPrice : (TOKEN_PRICE_USD[t.symbol] || 0);
            }
            _usdPriceCache[t.symbol] = { value: out[t.symbol], ts: Date.now() };
        });
    } catch (e) {
        console.warn("[batchGetTokenUsdPrices] gagal, fallback satu-satu:", e);
        for (const t of tokens) out[t.symbol] = await getTokenUsdPrice(t.symbol);
    }

    return out;
}
// ==========================
// AUTO REFRESH CHECK
// ==========================
function autoRefreshIfNeeded() {

    const wallet = getSelectedWallet();
    if (!wallet) return;

    const address = wallet.address;

    const hasSDA = localStorage.getItem(address + "_native");

    const tokens = (window.customTokens || []);

    const missingToken = tokens.some(token => {
        const key = address + "_" + token.address;
        return !localStorage.getItem(key);
    });

    if (!hasSDA || missingToken) {
        refreshAll();
    }
}


// ==========================
// LOAD BALANCE UI (FIX MISSING FUNCTION)
// ==========================
async function loadBalance() {

    const wallet = getSelectedWallet();
    if (!wallet) return;

    const addr = wallet.address;

    let key;
    let symbol = "SDA";

    // ==========================
    // TOKEN SWITCH
    // ==========================
    if (!window.selectedToken || window.selectedToken === "native") {
        key = addr + "_native";
        symbol = "SDA";
    } else {
        key = addr + "_" + window.selectedToken;

        const token = (window.TOKENS || []).find(
            t => t.address === window.selectedToken
        );

        if (token) symbol = token.symbol;
    }

    const bal = localStorage.getItem(key) || ("0.00 " + symbol);

    // ==========================
    // MAIN BALANCE
    // ==========================
    const el = document.getElementById("balance");
    if (el) el.textContent = bal;

    // ==========================
    // USD ESTIMATE (PRICE ENGINE + FALLBACK MANUAL)
    // ==========================
    const usdEl = document.getElementById("balanceUSD");
    if (usdEl) {
        const numericAmount = parseFloat(bal) || 0;
        usdEl.textContent = "..."; // loading sementara
        formatUSD(numericAmount, symbol).then(text => {
            // Pastikan token belum diganti lagi saat hasil datang
            usdEl.textContent = text;
        });
    }

    // ==========================
    // SEND BALANCE (SYNC)
    // ==========================
    if (typeof updateSendBalance === "function") {
        updateSendBalance();
    }
}


function updateSendBalance() {

    const wallet = getSelectedWallet();
    if (!wallet) return;

    const addr = wallet.address;

    let key;
    let symbol = "SDA";

    if (!window.selectedToken || window.selectedToken === "native") {
        key = addr + "_native";
        symbol = "SDA";
    } else {
        key = addr + "_" + window.selectedToken;

        const token = (window.TOKENS || []).find(
            t => t.address === window.selectedToken
        );

        if (token) symbol = token.symbol;
    }

    const bal = localStorage.getItem(key) || ("0.00 " + symbol);

    const sendEl = document.querySelector(".send-balance");
    if (sendEl) {
        sendEl.textContent = bal;
    }
}

// ==========================
// UPDATE ADDRESS UI (FIX MISSING)
// ==========================
function updateAddressUI() {

    const wallet = getSelectedWallet();
    const el = document.getElementById("showAddress");

    if (!el) return;

    el.textContent = wallet ? wallet.address : "-";
}


// ==========================
// MAIN REFRESH BALANCE
// ==========================
async function refreshAll() {

    if (!_ethers || !provider) {
        console.error("ethers/provider belum siap");
        return;
    }

    const wallet = getSelectedWallet();
    if (!wallet) return;

    const currentAddress = wallet.address;

    if (typeof showToast === "function") {
        showToast("Refreshing...");
    }

    // =================================================
    // TOKEN SELECT STATE
    // =================================================
    const selected = window.selectedToken || "native";

    // =================================================
    // SDA BALANCE / TOKEN BALANCE (FIXED LOGIC)
    // =================================================
    try {

        if (selected === "native") {

            const bal = await provider.getBalance(currentAddress);

            const result =
                parseFloat(
                    _ethers.utils.formatEther(bal)
                ).toFixed(4) + " SDA";

            localStorage.setItem(currentAddress + "_native", result);

        } else {

            const token = (window.TOKENS || []).find(
                t => t.address === selected
            );

            if (!token) throw new Error("Token not found");

            const abi = [
                "function balanceOf(address) view returns (uint256)",
                "function decimals() view returns (uint8)"
            ];

            const contract = new _ethers.Contract(
                token.address,
                abi,
                provider
            );

            const [bal, decimalsRaw] = await Promise.all([
                contract.balanceOf(currentAddress),
                contract.decimals().catch(() => 18)
            ]);

            const value =
                parseFloat(
                    _ethers.utils.formatUnits(bal, decimalsRaw)
                ).toFixed(4);

            const final = value + " " + token.symbol;

            localStorage.setItem(
                currentAddress + "_" + token.address,
                final
            );
        }

    } catch (e) {
        console.warn("Balance error:", e);
    }


    // =================================================
    // TOKEN LIST UPDATE â€” dibatch jadi 1 HTTP request
    // untuk semua token, bukan N request terpisah.
    // Fallback otomatis ke cara lama kalau batching gagal.
    // =================================================
    const list = (window.customTokens || []);

    if (list.length) {

        try {
            const results = await batchGetTokenBalances(list, currentAddress);

            list.forEach(token => {
                const r = results[token.address];
                if (!r) return;

                const value = parseFloat(
                    _ethers.utils.formatUnits(r.balance, r.decimals)
                ).toFixed(4);

                localStorage.setItem(
                    currentAddress + "_" + token.address,
                    value + " " + token.symbol
                );
            });

            // Batch harga USD untuk SEMUA token sekaligus (hemat fetch)
            try {
                await batchGetTokenUsdPrices(list);
            } catch (e) {
                console.warn("[refreshAll] batch USD price gagal:", e);
            }

        } catch (e) {
            console.warn("[refreshAll] Batch pertama gagal, retry sekali dgn chunk lebih kecil:", e.message);

            // RETRY â€” TETAP pakai batch (chunk kecil + delay antar chunk),
            // BUKAN loop satu-per-satu. Loop satu-per-satu itu yang bikin
            // fetch meledak jadi ratusan begitu RPC lambat/timeout.
            try {
                const results = await batchGetTokenBalancesChunked(list, currentAddress, 20, 500);

                list.forEach(token => {
                    const r = results[token.address];
                    if (!r) return;

                    const value = parseFloat(
                        _ethers.utils.formatUnits(r.balance, r.decimals)
                    ).toFixed(4);

                    localStorage.setItem(
                        currentAddress + "_" + token.address,
                        value + " " + token.symbol
                    );
                });

                try { await batchGetTokenUsdPrices(list); } catch {}

            } catch (e2) {
                console.warn("[refreshAll] RPC kemungkinan down/timeout, pakai saldo cache lama:", e2.message);
                // Sengaja TIDAK fallback ke loop per-token.
                // Biarkan saldo lama di localStorage tetap tampil â€”
                // lebih baik data agak basi daripada nembak RPC ratusan kali.
            }
        }
    }


    // =================================================
    // SAFETY CHECK
    // =================================================
    const latestWallet = getSelectedWallet();

    if (!latestWallet || latestWallet.address !== currentAddress) {
        return;
    }


    // =================================================
    // UI UPDATE (FIXED FLOW)
    // =================================================
    if (typeof loadBalance === "function") {
        loadBalance();
    }

    if (typeof renderAssets === "function") {
        renderAssets();
    }

    if (typeof updateAddressUI === "function") {
        updateAddressUI();
    }

    if (typeof showToast === "function") {
    showToast(
        LANG?.[CURRENT_LANG]?.refresh_done || "Refresh selesai"
    );
}
}