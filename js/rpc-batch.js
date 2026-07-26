// =====================================
// RPC-BATCH.JS (fixed)
// =====================================

const ERC20_ABI_BATCH = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)"
];
const _erc20IfaceBatch = new ethers.utils.Interface(ERC20_ABI_BATCH);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =====================================
// Kirim array of {method, params} dalam 1 HTTP POST.
// Cek status 429 secara eksplisit, dan kalau kena limit,
// backoff (bukan retry instan).
// =====================================
// =====================================
// CIRCUIT BREAKER GLOBAL
// Begitu 1 request RPC gagal (network down/timeout),
// SEMUA pemanggil lain (token manapun, fungsi manapun)
// langsung tahu dan skip fetch — tidak masing-masing
// coba sendiri-sendiri sampai ratusan kali.
// =====================================
window._rpcCircuitOpenUntil = window._rpcCircuitOpenUntil || 0;

function _rpcCircuitIsOpen() {
    return Date.now() < window._rpcCircuitOpenUntil;
}

function _rpcCircuitTrip() {
    const cooldown = window.CONFIG?.RPC_COOLDOWN ?? 30000;
    window._rpcCircuitOpenUntil = Date.now() + cooldown;
    console.warn(`[rpc-batch] Circuit breaker OPEN — skip semua RPC selama ${cooldown}ms`);
}

async function rpcBatch(requests, opts = {}) {
    if (!requests.length) return [];

    // Kalau circuit sedang open (baru saja ada kegagalan network),
    // langsung gagal tanpa fetch sama sekali — tidak ikut menumpuk
    // percobaan baru selagi RPC belum pulih.
    if (_rpcCircuitIsOpen()) {
        throw new Error("rpcBatch: circuit breaker open, RPC kemungkinan down");
    }

    const maxRetries = opts.maxRetries ?? 4;
    const baseDelay  = opts.baseDelay  ?? 1000;

    const payload = requests.map((r, i) => ({
        jsonrpc: "2.0",
        id: i,
        method: r.method,
        params: r.params
    }));

    let lastErr;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {

        let res;
        try {
            res = await fetch(window.RPC, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } catch (networkErr) {
            // Gagal total di level network (bukan HTTP error, tapi
            // fetch()-nya sendiri yang gagal) — trip circuit breaker
            // langsung, jangan retry berkali-kali untuk request ini.
            _rpcCircuitTrip();
            throw networkErr;
        }

        if (res.status === 429) {
            lastErr = new Error("429 Too Many Requests");
            if (attempt === maxRetries) break;

            const retryAfterHeader = res.headers.get("Retry-After");
            const retryAfterMs = retryAfterHeader
                ? parseFloat(retryAfterHeader) * 1000
                : baseDelay * Math.pow(2, attempt) + Math.random() * 300;

            console.warn(`[rpc-batch] Kena 429, tunggu ${Math.round(retryAfterMs)}ms (attempt ${attempt + 1}/${maxRetries})`);
            await sleep(retryAfterMs);
            continue;
        }

        if (!res.ok) {
            lastErr = new Error("HTTP " + res.status);
            if (attempt === maxRetries) {
                _rpcCircuitTrip();
                break;
            }
            await sleep(baseDelay * Math.pow(2, attempt));
            continue;
        }

        const data = await res.json();

        if (!Array.isArray(data)) {
            throw new Error("RPC batching tidak didukung / respons bukan array");
        }

        const byId = {};
        data.forEach(item => { byId[item.id] = item; });

        return requests.map((_, i) => {
            const item = byId[i];
            if (!item || item.error) {
                return { error: item?.error?.message || "no response" };
            }
            return { result: item.result };
        });
    }

    _rpcCircuitTrip();
    throw lastErr || new Error("rpcBatch gagal tanpa alasan jelas");
}

// =====================================
// Ambil balance + decimals BANYAK token sekaligus
// dalam 1 HTTP request (bukan N request terpisah).
// INI YANG SEBELUMNYA HILANG.
// =====================================
async function batchGetTokenBalances(tokens, walletAddress) {
    if (!tokens.length) return {};

    const requests = [];
    tokens.forEach(token => {
        requests.push({
            method: "eth_call",
            params: [{
                to: token.address,
                data: _erc20IfaceBatch.encodeFunctionData("balanceOf", [walletAddress])
            }, "latest"]
        });
        requests.push({
            method: "eth_call",
            params: [{
                to: token.address,
                data: _erc20IfaceBatch.encodeFunctionData("decimals", [])
            }, "latest"]
        });
    });

    const results = await rpcBatch(requests);

    const out = {};
    tokens.forEach((token, i) => {
        const balRes = results[i * 2];
        const decRes = results[i * 2 + 1];

        let balance  = ethers.BigNumber.from(0);
        let decimals = token.decimals || 18;

        try {
            if (balRes.result && balRes.result !== "0x") {
                balance = _erc20IfaceBatch.decodeFunctionResult("balanceOf", balRes.result)[0];
            }
        } catch (e) {
            console.warn("[rpc-batch] decode balanceOf gagal:", token.symbol, e);
        }

        try {
            if (decRes.result && decRes.result !== "0x") {
                decimals = _erc20IfaceBatch.decodeFunctionResult("decimals", decRes.result)[0];
            }
        } catch (e) {
            // biarkan default
        }

        out[token.address] = { balance, decimals };
    });

    return out;
}

// =====================================
// Versi chunked — dengan jeda antar chunk supaya
// tidak "ngebut" nembak RPC beruntun.
// =====================================
async function batchGetTokenBalancesChunked(tokens, walletAddress, chunkSize = 40, delayBetweenChunks = 250) {
    let out = {};

    for (let i = 0; i < tokens.length; i += chunkSize) {
        const chunk = tokens.slice(i, i + chunkSize);
        try {
            const res = await batchGetTokenBalances(chunk, walletAddress);
            out = { ...out, ...res };
        } catch (e) {
            console.warn("[rpc-batch] chunk gagal (token " + i + "-" + (i + chunk.length) + "):", e);
        }

        if (i + chunkSize < tokens.length) {
            await sleep(delayBetweenChunks);
        }
    }

    return out;
}

// =====================================
// BATCH PRICE (via rpcBatch, tanpa Multicall contract)
// Semua token dihitung harganya terhadap WSDA
// dalam maksimal 2 HTTP request total.
// =====================================

const FACTORY_ABI_BATCH = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI_BATCH = [
    "function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint8,bool)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function liquidity() view returns (uint128)"
];
const _factoryIfaceBatch = new ethers.utils.Interface(FACTORY_ABI_BATCH);
const _poolIfaceBatch    = new ethers.utils.Interface(POOL_ABI_BATCH);
const _FEES_BATCH = [500, 3000, 10000];

function _sqrtToPriceBatch(sqrt) {
    try {
        const s = BigInt(sqrt.toString());
        const ratio = Number((s * s * 10n ** 18n) / 2n ** 192n) / 1e18;
        return isFinite(ratio) && ratio > 0 ? ratio : 0;
    } catch { return 0; }
}

async function batchGetTokenPricesInWSDA(tokenAddrs) {
    const factory = window.CONFIG?.FACTORY;
    const wsda    = window.CONFIG?.WSDA;
    if (!factory || !wsda || !tokenAddrs.length) return {};

    // ---- TAHAP 1: getPool untuk semua token x semua fee ----
    const jobs = [];
    tokenAddrs.forEach(token => {
        _FEES_BATCH.forEach(fee => jobs.push({ token, fee }));
    });

    const poolReqs = jobs.map(j => ({
        method: "eth_call",
        params: [{
            to: factory,
            data: _factoryIfaceBatch.encodeFunctionData("getPool", [j.token, wsda, j.fee])
        }, "latest"]
    }));

    const poolResults = await rpcBatch(poolReqs);

    // token -> [{fee, poolAddr}]
    const poolsPerToken = {};
    jobs.forEach((j, i) => {
        const r = poolResults[i];
        let addr = null;
        try {
            if (r.result && r.result !== "0x") {
                const [decoded] = _factoryIfaceBatch.decodeFunctionResult("getPool", r.result);
                if (decoded && decoded !== ethers.constants.AddressZero) addr = decoded;
            }
        } catch {}
        if (addr) {
            (poolsPerToken[j.token] ||= []).push({ fee: j.fee, poolAddr: addr });
        }
    });

    const allPools = [...new Set(Object.values(poolsPerToken).flat().map(p => p.poolAddr))];
    if (!allPools.length) return {};

    // ---- TAHAP 2: token0/token1/slot0/liquidity untuk semua pool valid ----
    const poolReqs2 = allPools.flatMap(poolAddr => [
        { method: "eth_call", params: [{ to: poolAddr, data: _poolIfaceBatch.encodeFunctionData("token0") }, "latest"] },
        { method: "eth_call", params: [{ to: poolAddr, data: _poolIfaceBatch.encodeFunctionData("token1") }, "latest"] },
        { method: "eth_call", params: [{ to: poolAddr, data: _poolIfaceBatch.encodeFunctionData("slot0") }, "latest"] },
        { method: "eth_call", params: [{ to: poolAddr, data: _poolIfaceBatch.encodeFunctionData("liquidity") }, "latest"] }
    ]);

    const poolData2 = await rpcBatch(poolReqs2);

    const poolCache = {}; // poolAddr -> { token0, token1, sqrtPriceX96, liquidity }
    allPools.forEach((poolAddr, pi) => {
        const base = pi * 4;
        try {
            const [token0] = _poolIfaceBatch.decodeFunctionResult("token0", poolData2[base].result);
            const [token1] = _poolIfaceBatch.decodeFunctionResult("token1", poolData2[base + 1].result);
            const slot0    = _poolIfaceBatch.decodeFunctionResult("slot0", poolData2[base + 2].result);
            const [liq]    = _poolIfaceBatch.decodeFunctionResult("liquidity", poolData2[base + 3].result);
            poolCache[poolAddr] = { token0, token1, sqrtPriceX96: slot0[0], liquidity: liq };
        } catch (e) {
            // pool ini gagal decode, skip
        }
    });

    // ---- TAHAP 3: pilih pool liquidity tertinggi per token, hitung harga ----
    const out = {};
    tokenAddrs.forEach(token => {
        const candidates = poolsPerToken[token] || [];
        let best = null;
        for (const { fee, poolAddr } of candidates) {
            const data = poolCache[poolAddr];
            if (!data || !data.liquidity || data.liquidity.eq(0)) continue;
            const liq = Number(data.liquidity.toString());
            if (!best || liq > best.liquidity) best = { fee, ...data, liquidity: liq };
        }
        if (!best) { out[token] = 0; return; }

        let price = _sqrtToPriceBatch(best.sqrtPriceX96);
        if (price > 0 && token.toLowerCase() === best.token1.toLowerCase()) price = 1 / price;
        out[token] = price > 0 ? price * (1 - best.fee / 1_000_000) : 0;
    });

    return out; // { tokenAddr: hargaDalamWSDA }
}

window.batchGetTokenPricesInWSDA = batchGetTokenPricesInWSDA;

window.rpcBatch = rpcBatch;
window.batchGetTokenBalances = batchGetTokenBalances;
window.batchGetTokenBalancesChunked = batchGetTokenBalancesChunked;