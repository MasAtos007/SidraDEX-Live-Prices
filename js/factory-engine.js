// =====================================
// FACTORY ENGINE — Cache + JSON-RPC Batching
// TIDAK butuh kontrak Multicall — pakai rpcBatch()
// dari rpc-batch.js (kirim banyak eth_call dalam
// 1 HTTP POST langsung ke RPC node).
// ~140 calls/scan → <20 HTTP request/scan
// =====================================

const FEES = [500, 3000, 10000];

function _WSDA()    { return window.CONFIG?.WSDA; }
function _FACTORY() { return window.CONFIG?.FACTORY; }

const FACTORY_ABI = [
    "function getPool(address,address,uint24) view returns (address)"
];
const POOL_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint8,bool)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function liquidity() view returns (uint128)"
];

// =====================================
// CACHE LAYERS
// =====================================
const _poolAddrCache = new Map();  // "tA_tB_fee" → poolAddr | null
const _poolDataCache = new Map();  // poolAddr    → { token0, token1, slot0, liquidity, ts }
const _priceCache    = new Map();  // "tIn_tOut"  → { price, ts }
const _liqCache      = new Map();  // "tIn_tOut"  → { data, ts }

const POOL_ADDR_TTL  = 0;          // pool address tidak pernah berubah → cache selamanya
const POOL_DATA_TTL  = 20_000;     // diperbesar dari 8s — kurangi frekuensi fetch ulang
const PRICE_TTL      = 20_000;
const LIQ_TTL        = 30_000;

// =====================================
// HELPERS
// =====================================
function isNative(t) { return !t || t === "native"; }
function normalize(t) { return isNative(t) ? _WSDA() : t; }

function sqrtToPrice(sqrt) {
    try {
        const s     = BigInt(sqrt.toString());
        const ratio = Number((s * s * 10n ** 18n) / 2n ** 192n) / 1e18;
        return isFinite(ratio) && ratio > 0 ? ratio : 0;
    } catch { return 0; }
}

// =====================================
// BATCH CALL HELPER
// Jalankan banyak eth_call dalam 1 HTTP POST via rpcBatch()
// (rpc-batch.js) — TIDAK butuh kontrak Multicall sama sekali.
// =====================================
// =====================================
// RATE LIMIT TRACKING — dipakai untuk deteksi & munculkan dialog
// =====================================
window._rpcLimitState = window._rpcLimitState || {
    consecutiveFails: 0,
    lastLimitAt: 0,
    dialogShown: false
};

function _isRateLimitError(e) {
    const msg = String(e?.message || e || "").toLowerCase();
    return (
        msg.includes("429") ||
        msg.includes("rate limit") ||
        msg.includes("too many requests") ||
        msg.includes("limit exceeded")
    );
}

async function _batchCall(calls, _retryCount = 0) {
    if (!window.rpcBatch) {
        console.error("[FACTORY] window.rpcBatch tidak ditemukan — pastikan rpc-batch.js dimuat sebelum factory-engine.js");
        return null;
    }
    try {
        const requests = calls.map(c => ({
            method: "eth_call",
            params: [{ to: c.target, data: c.callData }, "latest"]
        }));
        const result = await window.rpcBatch(requests);

        // sukses — reset counter limit
        window._rpcLimitState.consecutiveFails = 0;
        return result;

    } catch (e) {
        const isLimit = _isRateLimitError(e);

        if (isLimit) {
            window._rpcLimitState.consecutiveFails++;
            window._rpcLimitState.lastLimitAt = Date.now();
            console.warn("[FACTORY] Rate limit terdeteksi, percobaan ke-" + (_retryCount + 1));

            const isSwapping = window.AGGREGATOR?.isAutoRunning?.();

            // Kalau lagi auto-swap: retry lebih lama & lebih banyak kali (JANGAN ganggu
            // user dengan dialog matikan-data — biarkan RPC pulih sendiri di background).
            // Kalau lagi scanning biasa: retry standar, lalu tampilkan dialog kalau gagal terus.
            const backoffSchedule = isSwapping
                ? [8000, 20000, 40000, 60000, 90000]   // sampai ~3.5 menit total, lebih sabar
                : [5000, 15000, 45000];                 // standar untuk scanning

            if (_retryCount < backoffSchedule.length) {
                const delayMs = backoffSchedule[_retryCount];
                await new Promise(r => setTimeout(r, delayMs));
                return _batchCall(calls, _retryCount + 1);
            }

            // Retry habis — kalau bukan lagi swap, baru tampilkan dialog ke user
            if (!isSwapping) {
                window._showRateLimitDialog?.();
            } else {
                console.error("[FACTORY] Rate limit terus berlanjut saat auto-swap — biarkan recovery mechanism auto-swap yang menangani");
            }
        }

        console.error("[FACTORY] batchCall gagal:", e.message || e);
        return null;
    }
}

// =====================================
// GET POOL ADDRESS (dengan cache, single call)
// =====================================
async function _getPoolAddr(tokenA, tokenB, fee) {
    const key = `${tokenA}_${tokenB}_${fee}`.toLowerCase();
    if (_poolAddrCache.has(key)) return _poolAddrCache.get(key);

    try {
        const factory = new ethers.Contract(_FACTORY(), FACTORY_ABI, provider);
        const pool    = await factory.getPool(tokenA, tokenB, fee);
        const result  = (!pool || pool === ethers.constants.AddressZero) ? null : pool;
        _poolAddrCache.set(key, result);
        return result;
    } catch { return null; }
}

// =====================================
// GET ALL 3 POOL ADDRESSES — 1 batch request
// =====================================
async function _getPoolAddrsMulticall(tokenA, tokenB) {
    // Cek cache dulu — kalau semua sudah ada, skip RPC
    const keys    = FEES.map(f => `${tokenA}_${tokenB}_${f}`.toLowerCase());
    const allHit  = keys.every(k => _poolAddrCache.has(k));
    if (allHit) {
        return FEES.map((f, i) => ({
            fee:      f,
            poolAddr: _poolAddrCache.get(keys[i])
        })).filter(x => x.poolAddr);
    }

    const iFactory = new ethers.utils.Interface(FACTORY_ABI);

    // Hanya fetch yang belum di-cache
    const toFetch = FEES.filter((f, i) => !_poolAddrCache.has(keys[i]));

    const calls = toFetch.map(fee => ({
        target:   _FACTORY(),
        callData: iFactory.encodeFunctionData("getPool", [tokenA, tokenB, fee])
    }));

    const results = await _batchCall(calls);

    if (results) {
        toFetch.forEach((fee, i) => {
            const key = `${tokenA}_${tokenB}_${fee}`.toLowerCase();
            try {
                const r = results[i];
                if (!r || r.error || !r.result || r.result === "0x") {
                    _poolAddrCache.set(key, null);
                    return;
                }
                const [addr] = iFactory.decodeFunctionResult("getPool", r.result);
                const pool   = (!addr || addr === ethers.constants.AddressZero) ? null : addr;
                _poolAddrCache.set(key, pool);
            } catch { _poolAddrCache.set(key, null); }
        });
    } else {
        // Batch gagal (RPC/network down, atau rpcBatch belum siap) — JANGAN
        // fallback ke fetch satu-per-satu, itu yang bikin request meledak
        // saat RPC benar-benar unreachable. Biarkan gagal, cache tetap
        // kosong untuk sesi ini, coba lagi di siklus refresh berikutnya.
        console.warn("[FACTORY] batch getPool gagal, skip — tidak fallback per-item");
    }

    return FEES.map((f, i) => ({
        fee:      f,
        poolAddr: _poolAddrCache.get(keys[i])
    })).filter(x => x.poolAddr);
}

// =====================================
// GET BEST POOL — batch request untuk semua pool sekaligus
// =====================================
async function getBestPool(tokenA, tokenB) {
    const A = normalize(tokenA);
    const B = normalize(tokenB);

    // Step 1: Semua pool address dalam 1 batch request (atau cache)
    const validPools = await _getPoolAddrsMulticall(A, B);
    if (!validPools.length) return null;

    const iPool = new ethers.utils.Interface(POOL_ABI);
    const now   = Date.now();

    // Pisahkan: mana yang sudah di-cache, mana yang perlu fetch
    const needFetch = validPools.filter(p => {
        const c = _poolDataCache.get(p.poolAddr);
        return !c || now - c.ts > POOL_DATA_TTL;
    });

    // Step 2: Fetch token0/token1/slot0/liquidity semua pool yang stale — 1 batch request
    if (needFetch.length) {
        const calls = needFetch.flatMap(({ poolAddr }) => [
            { target: poolAddr, callData: iPool.encodeFunctionData("token0") },
            { target: poolAddr, callData: iPool.encodeFunctionData("token1") },
            { target: poolAddr, callData: iPool.encodeFunctionData("slot0") },
            { target: poolAddr, callData: iPool.encodeFunctionData("liquidity") }
        ]);

        const results = await _batchCall(calls);

        if (results) {
            needFetch.forEach(({ poolAddr }, pi) => {
                try {
                    const base = pi * 4;
                    const r0 = results[base];
                    const r1 = results[base + 1];
                    const r2 = results[base + 2];
                    const r3 = results[base + 3];

                    if ([r0, r1, r2, r3].some(r => !r || r.error || !r.result || r.result === "0x")) return;

                    const [token0]  = iPool.decodeFunctionResult("token0",    r0.result);
                    const [token1]  = iPool.decodeFunctionResult("token1",    r1.result);
                    const slot0     = iPool.decodeFunctionResult("slot0",     r2.result);
                    const [liq]     = iPool.decodeFunctionResult("liquidity", r3.result);
                    _poolDataCache.set(poolAddr, { token0, token1, slot0: { sqrtPriceX96: slot0[0] }, liquidity: liq, ts: now });
                } catch {}
            });
        } else {
            // Batch gagal (RPC/network down) — JANGAN fallback ke fetch
            // satu-per-satu per pool. Sama alasannya: itu yang memicu
            // request storm saat RPC benar-benar unreachable.
            console.warn("[FACTORY] batch pool data gagal, skip — tidak fallback per-item");
        }
    }

    // Step 3: Pilih pool dengan liquidity tertinggi dari cache
    let best = null;
    for (const { fee, poolAddr } of validPools) {
        const data = _poolDataCache.get(poolAddr);
        if (!data) continue;
        try {
            if (!data.liquidity || data.liquidity.eq(0)) continue;
            const liq = Number(data.liquidity.toString());
            if (!best || liq > best.liquidity) {
                best = { fee, poolAddr, token0: data.token0, token1: data.token1, slot0: data.slot0, liquidity: liq };
            }
        } catch {}
    }
    return best;
}

// =====================================
// DIRECT PRICE
// =====================================
async function getDirectPrice(tokenIn, tokenOut) {
    const A    = normalize(tokenIn);
    const B    = normalize(tokenOut);
    const best = await getBestPool(A, B);
    if (!best) return 0;

    let price = sqrtToPrice(best.slot0.sqrtPriceX96);
    if (price <= 0) return 0;
    if (A.toLowerCase() === best.token1.toLowerCase()) price = 1 / price;
    return price * (1 - best.fee / 1_000_000);
}

// =====================================
// SMART PRICE — direct atau multihop via WSDA
// =====================================
async function getPrice(tokenIn, tokenOut) {
    if (isNative(tokenIn) && isNative(tokenOut)) return 1;

    const key    = `${String(tokenIn).toLowerCase()}_${String(tokenOut).toLowerCase()}`;
    const cached = _priceCache.get(key);
    if (cached && Date.now() - cached.ts < PRICE_TTL) return cached.price;

    let price = await getDirectPrice(tokenIn, tokenOut);

    if (!price) {
        // Multihop: coba via WSDA — kedua leg bisa paralel karena getBestPool sudah di-cache
        const wsda = _WSDA();
        if (wsda) {
            const [leg1, leg2] = await Promise.all([
                getDirectPrice(tokenIn, wsda),
                getDirectPrice(wsda, tokenOut)
            ]);
            if (leg1 > 0 && leg2 > 0) price = leg1 * leg2;
        }
    }

    if (price > 0) _priceCache.set(key, { price, ts: Date.now() });
    return price;
}

// =====================================
// AMOUNT OUT — linear (untuk scan cepat, rate display, dll)
// =====================================
async function getAmountOut(tokenIn, tokenOut, amountIn) {
    const price = await getPrice(tokenIn, tokenOut);
    if (!price || price <= 0) return 0;
    const out = Number(amountIn) * price;
    return isFinite(out) && out > 0 ? out : 0;
}

// =====================================
// AMOUNT OUT CURVE — constant product approximation
// Jauh lebih akurat untuk estimasi konfirmasi modal
// karena memperhitungkan price impact berdasar ukuran pool sungguhan
//
// Formula: amountOut = (Rout × amountIn × (1-fee)) / (Rin + amountIn × (1-fee))
// Ini adalah rumus constant product (x*y=k) yang dipakai semua AMM
// =====================================
async function getAmountOutCurve(tokenIn, tokenOut, amountIn) {
    const A = normalize(tokenIn);
    const B = normalize(tokenOut);
    const amount = Number(amountIn);

    if (!amount || amount <= 0) return 0;

    try {
        // Coba pool langsung dulu
        const best = await getBestPool(A, B);

        if (best) {
            return _calcCurveOut(best, A, amount);
        }

        // Tidak ada pool langsung — multihop via WSDA
        const wsda = _WSDA();
        if (!wsda) return await getAmountOut(tokenIn, tokenOut, amountIn); // fallback linear

        const leg1Pool = await getBestPool(A, wsda);
        if (!leg1Pool) return await getAmountOut(tokenIn, tokenOut, amountIn);

        const wsda_out = _calcCurveOut(leg1Pool, A, amount);
        if (!wsda_out || wsda_out <= 0) return 0;

        const leg2Pool = await getBestPool(wsda, B);
        if (!leg2Pool) return await getAmountOut(tokenIn, tokenOut, amountIn);

        const final_out = _calcCurveOut(leg2Pool, wsda, wsda_out);
        return final_out > 0 ? final_out : 0;

    } catch (e) {
        console.warn("[getAmountOutCurve]", e);
        return await getAmountOut(tokenIn, tokenOut, amountIn); // fallback linear
    }
}

// Helper: hitung output pakai constant product dari data pool yang sudah di-cache
function _calcCurveOut(pool, tokenIn, amountIn) {
    try {
        const data = _poolDataCache.get(pool.poolAddr);
        if (!data) return 0;

        const sqrtPrice = Number(data.slot0.sqrtPriceX96) / (2 ** 96);
        if (!sqrtPrice || sqrtPrice <= 0) return 0;

        const L = Number(data.liquidity?.toString() || "0");
        if (!L) return 0;

        // Hitung reserve dari L dan sqrtPrice
        // reserve0 = L / sqrtP, reserve1 = L * sqrtP
        const reserve0 = L / sqrtPrice;
        const reserve1 = L * sqrtPrice;

        const isInput0 = tokenIn.toLowerCase() === pool.token0.toLowerCase();
        const Rin  = isInput0 ? reserve0 : reserve1;
        const Rout = isInput0 ? reserve1 : reserve0;

        if (Rin <= 0 || Rout <= 0) return 0;

        // Constant product dengan fee
        const feeMult = 1 - (pool.fee / 1_000_000);
        const amtInWithFee = amountIn * feeMult;
        const out = (Rout * amtInWithFee) / (Rin + amtInWithFee);

        return isFinite(out) && out > 0 ? out : 0;
    } catch (e) {
        return 0;
    }
}

// =====================================
// GET POOL LIQUIDITY
// =====================================
async function getPoolLiquidity(tokenIn, tokenOut) {
    const key    = `liq_${String(tokenIn).toLowerCase()}_${String(tokenOut).toLowerCase()}`;
    const cached = _liqCache.get(key);
    if (cached && Date.now() - cached.ts < LIQ_TTL) return cached.data;

    try {
        const A    = normalize(tokenIn);
        const B    = normalize(tokenOut);
        const best = await getBestPool(A, B); // sudah pakai batch call + cache
        if (!best) return null;

        // slot0 + liquidity sudah di-cache oleh getBestPool — tidak perlu RPC lagi
        const data = _poolDataCache.get(best.poolAddr);
        if (!data) return null;

        const sqrtPrice = Number(data.slot0.sqrtPriceX96) / (2 ** 96);
        const L         = Number(data.liquidity.toString());
        if (!L || !sqrtPrice) return null;

        const reserve0      = L / sqrtPrice;
        const reserve1      = L * sqrtPrice;
        const isInput0      = A.toLowerCase() === best.token0.toLowerCase();
        const inputReserve  = isInput0 ? reserve0 : reserve1;
        const outputReserve = isInput0 ? reserve1 : reserve0;
        const MAX_IMPACT    = 0.10;

        const result = {
            poolAddr:     best.poolAddr,
            liquidity:    L,
            token0:       best.token0,
            token1:       best.token1,
            reserve0,
            reserve1,
            inputReserve,
            maxSwapIn:    inputReserve  * MAX_IMPACT,
            maxSwapOut:   outputReserve * MAX_IMPACT,
            fee:          best.fee
        };

        _liqCache.set(key, { data: result, ts: Date.now() });
        return result;

    } catch (e) {
        console.warn("[FACTORY] getPoolLiquidity error:", e);
        return null;
    }
}

// =====================================
// CACHE STATS (debug)
// =====================================
function _cacheStats() {
    console.table({
        poolAddr:  _poolAddrCache.size,
        poolData:  _poolDataCache.size,
        price:     _priceCache.size,
        liquidity: _liqCache.size
    });
}

// =====================================
// EXPORT
// =====================================
window.PRICE_ENGINE = {
    getPrice,
    getAmountOut,
    getAmountOutCurve,   // tambah ini
    getPoolLiquidity,
    getBestPool,
    _cacheStats,
    _clearCache: () => {
        _poolAddrCache.clear();
        _poolDataCache.clear();
        _priceCache.clear();
        _liqCache.clear();
        console.log("[FACTORY] Cache cleared");
    }
};