// =====================================
// CONFIG.JS - Global Config & Provider
// =====================================
if (typeof ethers === "undefined") {
    console.error("ethers belum load!");
}

// =====================================
// TOKEN LIMIT CONFIG
// Ganti angka di bawah untuk membatasi jumlah
// custom token yang bisa ditambahkan user.
// Pakai Infinity untuk unlimited.
// =====================================
const MAX_CUSTOM_TOKENS = Infinity; // contoh membatasi lagi nanti: ubah jadi 50, 33, dst
window.MAX_CUSTOM_TOKENS = MAX_CUSTOM_TOKENS;

// ==========================
// RPC BASE
// ==========================
window.RPC = window.RPC || "https://node.sidrachain.com/";

// ==========================
// GLOBAL CONFIG (SAFE MERGE)
// ==========================
window.CONFIG = window.CONFIG || {};
window.CONFIG = Object.assign(window.CONFIG, {
    // NETWORK
    RPC:      window.RPC,
    CHAIN_ID: 97453,

    // CORE DEX CONTRACTS
    FACTORY:   "0xCFE41fb5dA87916D84E7F22889087b4Ff7163cDE",
    ROUTER:    "0x35cAC72Db00e8dAC0e4f7F8A0F53D339E0cC23fb",
    MULTICALL: "0xcA11bde05977b3631167028862bE2a173976CA11",

    // BASE ASSET
    WSDA: "0xE4095a910209D7BE03B55D02F40d4554B1666182",

    // POOL SETTINGS
    FEE: 3000,

    // SYSTEM FLAGS
    ENABLE_SWAP:         true,
    ENABLE_FACTORY_SCAN: true,

    // PERFORMANCE
    CACHE_REFRESH_MS: 60000,
    MAX_RETRY:        4,
    RPC_TIMEOUT:      12000,
    RPC_COOLDOWN:     30000,

    // UI
    HIDE_WSDA_IN_UI: true,
    DEFAULT_NATIVE:  "native",

    // SWAP SETTINGS
    SLIPPAGE_DEFAULT:   0.5,
    PRICE_IMPACT_LIMIT: 5,

    // NATIVE TOKEN SYMBOL
    NATIVE_SYMBOL: "SDA"
});

// ==========================
// PROVIDER INIT
// ==========================
window.provider = window.provider ||
    (typeof ethers !== "undefined"
        ? new ethers.providers.JsonRpcProvider(window.RPC)
        : null
    );

// ==========================
// ABI - FEES COLLECT
// ==========================
window.CONFIG.ABI_FEES = [
    "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns (uint256 amount0,uint256 amount1)"
];

// ==========================
// ABI - POSITION MANAGER
// ==========================
window.CONFIG.ABI = window.CONFIG.ABI || {};
window.CONFIG.ABI.POSITION_MANAGER = [
    "function positions(uint256 tokenId) view returns (" +
        "uint96 nonce," +
        "address operator," +
        "address token0," +
        "address token1," +
        "uint24 fee," +
        "int24 tickLower," +
        "int24 tickUpper," +
        "uint128 liquidity," +
        "uint256 feeGrowthInside0LastX128," +
        "uint256 feeGrowthInside1LastX128," +
        "uint128 tokensOwed0," +
        "uint128 tokensOwed1" +
    ")",
    "function collect((" +
        "uint256 tokenId," +
        "address recipient," +
        "uint128 amount0Max," +
        "uint128 amount1Max" +
    ")) payable returns (" +
        "uint256 amount0," +
        "uint256 amount1" +
    ")"
];

// ============================================================
// showSendSuccessModal(options)
//
// Panggil setelah tx berhasil di executeSendTx():
//
//   showSendSuccessModal({
//     hash:        tx.hash,
//     amount:      amount,
//     tokenData:   tokenData,        // { symbol, decimals, address, logo }
//     fromAddress: fromAddress,
//     fromName:    fromName,
//     to:          to,
//     receipt:     receipt,          // ethers receipt obj
//     explorerUrl: "https://explorer.youchain.io/tx/"
//   });
// ============================================================

window._ssmData = {};

function showSendSuccessModal({
    hash,
    amount,
    tokenData,
    fromAddress,
    fromName,
    to,
    receipt,
    explorerUrl
}) {
    const symbol       = tokenData?.symbol || "SDA";
    const nativeSymbol = window.CONFIG?.NATIVE_SYMBOL || "SDA";
    const isNative     = !tokenData?.address || tokenData?.type === "native";
    const blockNum     = receipt?.blockNumber || "-";
    const gasUsed      = receipt?.gasUsed
                           ? (typeof receipt.gasUsed.toNumber === "function"
                               ? receipt.gasUsed.toNumber()
                               : Number(receipt.gasUsed))
                           : null;
    const gasPrice     = receipt?.effectiveGasPrice
                           ? (typeof receipt.effectiveGasPrice.toNumber === "function"
                               ? receipt.effectiveGasPrice.toNumber()
                               : Number(receipt.effectiveGasPrice))
                           : null;
    const txFee        = (gasUsed && gasPrice)
                           ? ((gasUsed * gasPrice) / 1e18).toFixed(6)
                           : null;

    // Simpan untuk fungsi copy & explorer
    window._ssmData = {
        hash,
        explorerUrl: explorerUrl || window.EXPLORER_URL || ""
    };

    // --- Isi elemen ---
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    // Amount + Symbol - pakai innerHTML agar <span> tidak tertimpa
    const amountEl = document.getElementById("ssmAmount");
    if (amountEl) {
        amountEl.innerHTML =
            Number(amount).toLocaleString("id-ID", { maximumFractionDigits: 6 })
            + ' <span id="ssmSymbol">' + symbol + '</span>';
    }

    // USD (kosong, isi jika ada price feed)
    const usdEl = document.getElementById("ssmUsd");
    if (usdEl) usdEl.textContent = "";

    // From
    set("ssmFromName", fromName || "Account");
    set("ssmFromAddr",
        fromAddress
            ? fromAddress.slice(0, 10) + "..." + fromAddress.slice(-8)
            : "-"
    );

    // To
    set("ssmToAddr",
        to ? to.slice(0, 10) + "..." + to.slice(-8) : "-"
    );

    // Hash
    set("ssmHash",
        hash ? hash.slice(0, 14) + "..." + hash.slice(-6) : "-"
    );

    // Block
    set("ssmBlock",
        blockNum !== "-"
            ? "#" + Number(blockNum).toLocaleString()
            : "-"
    );

    // Konfirmasi - hitung dari latestBlock jika tersedia
    const latest = window._latestBlock || null;
    set("ssmConfirm",
        (latest && blockNum !== "-")
            ? (Number(latest) - Number(blockNum)) + " konfirmasi"
            : "Dikonfirmasi ✓"
    );

    // Gas fee - selalu pakai native symbol (SDA), bukan token yang dikirim
    set("ssmGas",
        txFee
            ? txFee + " " + nativeSymbol + (gasUsed ? " (" + gasUsed.toLocaleString() + " gas)" : "")
            : "-"
    );

    // Waktu
    set("ssmTime", _ssmFormatDate(Date.now()));

    // Tampilkan modal
    const modal = document.getElementById("sendSuccessModal");
    if (modal) {
        modal.classList.add("show");
        document.body.style.overflow = "hidden";
    }
}


// ---- Tutup modal ----
function closeSendSuccessModal() {
    const modal = document.getElementById("sendSuccessModal");
    if (modal) modal.classList.remove("show");
    document.body.style.overflow = "";
    window._ssmData = {};
}

// Tutup jika klik overlay
document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("sendSuccessModal");
    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target === modal) closeSendSuccessModal();
        });
    }
});


// ---- Salin hash ----
function ssmCopyHash() {
    const hash = window._ssmData?.hash;
    if (!hash) return;

    const copyIcon = document.getElementById("ssmCopyIcon");

    const doCopy = () => {
        if (copyIcon) {
            copyIcon.className = "fa-solid fa-check";
            copyIcon.style.color = "#00c97b";
        }

        setTimeout(() => {
            if (copyIcon) {
                copyIcon.className = "fa-regular fa-copy";
                copyIcon.style.color = "#667788";
            }
        }, 2000);

        showToast?.("Hash tersalin", "success");
    };

    const textToCopy = hash;

    if (window.AndroidWallet?.copyToClipboard) {
        window.AndroidWallet.copyToClipboard(textToCopy);
        doCopy();
    } else if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(textToCopy)
            .then(() => doCopy())
            .catch(() => {});
    }
}


// ---- Buka Ledger Explorer ----
function ssmOpenExplorer() {
    const hash = window._ssmData?.hash;
    if (!hash) return;

    const url = "https://ledger.sidrachain.com/tx/" + hash;

    if (window.AndroidWallet?.openUrl) {
        window.AndroidWallet.openUrl(url);
    } else {
        window.open(url, "_blank");
    }
}


// ---- Helper: format tanggal ----
function _ssmFormatDate(ts) {
    const d = new Date(ts);
    const day   = String(d.getDate()).padStart(2, "0");
    const month = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][d.getMonth()];
    const year  = d.getFullYear();
    const hh    = String(d.getHours()).padStart(2, "0");
    const mm    = String(d.getMinutes()).padStart(2, "0");
    const ss    = String(d.getSeconds()).padStart(2, "0");
    return `${day} ${month} ${year}, ${hh}.${mm}.${ss}`;
}