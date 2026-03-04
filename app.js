/**
 * OP-20 Token Factory — Frontend Application
 *
 * Handles wallet connection via OPWallet, form validation,
 * contract interaction, and recently launched tokens list.
 */

// ============================================================
// Configuration
// ============================================================
const CONFIG = Object.freeze({
    /** Replace with your deployed factory contract address */
    FACTORY_ADDRESS: 'opt1sqqrt069k348lqu0qtyrs5qt9ql786rflquarwwe2',
    NETWORK: 'testnet',
    // NOTE: These must be string literals — Vite production builds can break
    // object property access if the whole object gets mangled during minification.
    RPC_URL: 'https://testnet.opnet.org',
    FEE_SATS: 10000, // 0.0001 BTC
    STORAGE_KEY: 'op20_factory_launched_tokens',
    TIME_REFRESH_MS: 30000, // Update "time ago" every 30 seconds
});

// Standalone string constants — immune to Vite minification/mangling.
// Use these instead of CONFIG.* in SDK calls.
const RPC_URL = 'https://testnet.opnet.org';
const FACTORY_ADDRESS = 'opt1sqqrt069k348lqu0qtyrs5qt9ql786rflquarwwe2';


// ============================================================
// DOM References
// ============================================================
const dom = {
    btnWallet: document.getElementById('btn-wallet'),
    walletLabel: document.getElementById('wallet-label'),
    form: document.getElementById('launch-form'),
    formView: document.getElementById('form-view'),
    successView: document.getElementById('success-view'),
    btnLaunch: document.getElementById('btn-launch'),
    btnCopy: document.getElementById('btn-copy'),
    btnReset: document.getElementById('btn-reset'),
    tokenAddress: document.getElementById('token-address'),
    errorMsg: document.getElementById('error-msg'),
    inputName: document.getElementById('token-name'),
    inputSymbol: document.getElementById('token-symbol'),
    inputSupply: document.getElementById('total-supply'),
    tokensList: document.getElementById('tokens-list'),
    tokensEmpty: document.getElementById('tokens-empty'),
    tokensCount: document.getElementById('tokens-count'),
    // Detail modal
    detailOverlay: document.getElementById('detail-overlay'),
    detailClose: document.getElementById('detail-close'),
    detailIcon: document.getElementById('detail-icon'),
    detailName: document.getElementById('detail-name'),
    detailSymbol: document.getElementById('detail-symbol'),
    detailSupply: document.getElementById('detail-supply'),
    detailAddress: document.getElementById('detail-address'),
    detailCopyAddr: document.getElementById('detail-copy-addr'),
    detailCreator: document.getElementById('detail-creator'),
    detailAddWallet: document.getElementById('detail-add-wallet'),
    detailShareTwitter: document.getElementById('detail-share-twitter'),
    // Hero banner
    globalTokenCount: document.getElementById('global-token-count'),
};

// ============================================================
// State
// ============================================================
const state = {
    walletAddress: null,
    isConnected: false,
    isLaunching: false,
    launchedTokens: [], // { name, symbol, totalSupply, creator, address, createdAt }
    currentDetailToken: null, // token currently shown in detail modal
};

// ============================================================
// Sound Effects (Web Audio API — no external files)
// ============================================================
const SFX = {
    _ctx: null,
    _getCtx() {
        if (!this._ctx) this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        return this._ctx;
    },
    /** Short click/tap sound */
    click() {
        try {
            const ctx = this._getCtx();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = 800;
            g.gain.setValueAtTime(0.08, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
            o.connect(g).connect(ctx.destination);
            o.start(); o.stop(ctx.currentTime + 0.08);
        } catch { }
    },
    /** Triumphant success fanfare */
    success() {
        try {
            const ctx = this._getCtx();
            const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
            notes.forEach((freq, i) => {
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'sine';
                o.frequency.value = freq;
                const t = ctx.currentTime + i * 0.12;
                g.gain.setValueAtTime(0.1, t);
                g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
                o.connect(g).connect(ctx.destination);
                o.start(t); o.stop(t + 0.35);
            });
        } catch { }
    },
    /** Error buzz */
    error() {
        try {
            const ctx = this._getCtx();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'square';
            o.frequency.value = 200;
            g.gain.setValueAtTime(0.06, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            o.connect(g).connect(ctx.destination);
            o.start(); o.stop(ctx.currentTime + 0.2);
        } catch { }
    },
    /** Subtle copy/tic sound */
    copy() {
        try {
            const ctx = this._getCtx();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = 1200;
            g.gain.setValueAtTime(0.05, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
            o.connect(g).connect(ctx.destination);
            o.start(); o.stop(ctx.currentTime + 0.05);
        } catch { }
    },
};

// ============================================================
// Wallet Detection
// ============================================================

/**
 * Checks if OPWallet extension is available.
 * @returns {boolean} True if OPWallet is detected
 */
function isWalletAvailable() {
    return typeof window !== 'undefined' && (typeof window.unisat !== 'undefined' || typeof window.opnet !== 'undefined');
}

/**
 * Truncates a wallet address for display.
 * @param {string} address - Full wallet address
 * @returns {string} Truncated address like "bc1q...x4f2"
 */
function truncateAddress(address) {
    if (!address || address.length < 12) return address;
    return address.slice(0, 6) + '...' + address.slice(-4);
}

/**
 * Connects to OPWallet or prompts installation.
 */
async function connectWallet() {
    if (state.isConnected) {
        disconnectWallet();
        return;
    }

    if (!isWalletAvailable()) {
        window.open('https://opnet.org', '_blank');
        showError('OPWallet not detected. Please install it first.');
        return;
    }

    try {
        const provider = window.opnet || window.unisat;
        const accounts = await provider.requestAccounts();
        console.log('👜 Wallet accounts returned:', accounts);
        if (accounts && accounts.length > 0) {
            const raw = accounts[0];
            // OPWallet may return an object instead of a plain string
            if (typeof raw === 'object' && raw !== null) {
                state.walletAddress = raw.address || raw.p2tr || raw.p2wpkh || String(raw);
            } else {
                state.walletAddress = String(raw);
            }
            console.log('👜 Resolved walletAddress:', state.walletAddress);
            state.isConnected = true;
            updateWalletUI();
            updateLaunchButton();
            hideError();
            SFX.click();
        }
    } catch (err) {
        console.error('❌ Wallet connection error:', err);
        showError('Wallet connection rejected.');
    }
}

/**
 * Disconnects the wallet.
 */
function disconnectWallet() {
    state.walletAddress = null;
    state.isConnected = false;
    updateWalletUI();
    updateLaunchButton();
}

/**
 * Updates the wallet button appearance based on connection state.
 */
function updateWalletUI() {
    if (state.isConnected) {
        dom.btnWallet.classList.add('connected');
        dom.walletLabel.textContent = truncateAddress(state.walletAddress);
    } else {
        dom.btnWallet.classList.remove('connected');
        dom.walletLabel.textContent = 'Connect Wallet';
    }
}

// ============================================================
// Form Validation
// ============================================================

/**
 * Validates form inputs.
 * @returns {{ valid: boolean, error?: string }}
 */
function validateForm() {
    const name = dom.inputName.value.trim();
    const symbol = dom.inputSymbol.value.trim();
    const supply = dom.inputSupply.value.trim();

    if (!name) return { valid: false, error: 'Token name is required.' };
    if (name.length > 32) return { valid: false, error: 'Token name must be 32 characters or less.' };

    if (!symbol) return { valid: false, error: 'Token symbol is required.' };
    if (symbol.length > 6) return { valid: false, error: 'Token symbol must be 6 characters or less.' };
    if (!/^[A-Z]+$/.test(symbol)) return { valid: false, error: 'Token symbol must be uppercase letters only.' };

    if (!supply) return { valid: false, error: 'Total supply is required.' };

    const supplyNum = Number(supply.replace(/,/g, ''));
    if (isNaN(supplyNum) || supplyNum < 1) {
        return { valid: false, error: 'Total supply must be at least 1.' };
    }
    if (!Number.isInteger(supplyNum)) {
        return { valid: false, error: 'Total supply must be a whole number.' };
    }
    if (supplyNum > 1_000_000_000_000) {
        return { valid: false, error: 'Total supply cannot exceed 1 trillion.' };
    }

    return { valid: true };
}

/**
 * Updates the Launch button disabled state.
 */
function updateLaunchButton() {
    const hasInput =
        dom.inputName.value.trim() &&
        dom.inputSymbol.value.trim() &&
        dom.inputSupply.value.trim();

    dom.btnLaunch.disabled = !hasInput || state.isLaunching;
}

// ============================================================
// Contract Interaction
// ============================================================

/**
 * Deploys a new token through the factory contract.
 *
 * Uses the OPNet SDK pattern:
 *   1. Get a contract reference
 *   2. Simulate the call
 *   3. Send the transaction (signer: null — OPWallet signs)
 *
 * @param {string} name - Token name
 * @param {string} symbol - Token symbol
 * @param {string} totalSupply - Total supply as a string
 * @returns {Promise<string>} The deployed token contract address
 */
async function deployToken(name, symbol, totalSupply) {
    console.log('deployToken called with:', {
        name: name,
        nameType: typeof name,
        symbol: symbol,
        symbolType: typeof symbol,
        supply: totalSupply,
        supplyType: typeof totalSupply,
        wallet: state.walletAddress,
        walletType: typeof state.walletAddress
    });

    // ── STEP 0: Import SDK modules ─────────────────────────────────────────
    let getContract, JSONRpcProvider, BitcoinUtils, networks;
    try {
        ({ getContract, JSONRpcProvider, BitcoinUtils } = await import('opnet'));
        ({ networks } = await import('@btc-vision/bitcoin'));
        // Note: ABIDataTypes & BitcoinAbiTypes are NOT used — we use string literals below
        console.log('✅ STEP 0: SDK imports OK');
    } catch (e) {
        console.error('❌ STEP 0 FAILED: SDK import error:', e);
        throw e;
    }

    // ── STEP 1: Create provider ─────────────────────────────────────────────
    let provider, network;
    try {
        network = networks.opnetTestnet;
        // Pass URL and network as positional args — the bundled SDK uses (url, network) signature
        console.log('🔄 STEP 1: Creating provider with URL:', RPC_URL, 'type:', typeof RPC_URL);
        provider = new JSONRpcProvider(RPC_URL, network);
        console.log('✅ STEP 1: Provider created successfully.');
    } catch (e) {
        console.error('❌ STEP 1 FAILED: JSONRpcProvider creation error:', e);
        throw e;
    }

    // ── STEP 2: Use wallet address directly (OPWallet handles signing) ──────
    // getPublicKeyInfo is NOT needed when OPWallet is the signer.
    // Passing the bech32 address string directly is correct for OPWallet flows.
    const senderAddress = state.walletAddress;
    console.log('✅ STEP 2: Using wallet address directly:', senderAddress);

    // ── STEP 3: Build ABI and contract ─────────────────────────────────────
    let factory, supplyBig;
    try {
        // ABI using exact SDK string values (from ABIDataTypes enum: STRING='STRING', etc.)
        // BitcoinAbiTypes.Function does NOT exist — omit the 'type' field entirely.
        const FACTORY_ABI = [
            {
                name: 'deployToken',
                inputs: [
                    { name: 'name', type: 'STRING' },
                    { name: 'symbol', type: 'STRING' },
                    { name: 'totalSupply', type: 'UINT256' },
                ],
                outputs: [
                    { name: 'newToken', type: 'ADDRESS' },
                ],
            },
        ];
        factory = getContract(FACTORY_ADDRESS, FACTORY_ABI, provider, network, senderAddress);
        // Convert supply string → BigInt before passing to SDK
        supplyBig = BitcoinUtils.expandToDecimals(BigInt(totalSupply), 18);
        console.log('✅ STEP 3: Contract built. supplyBig:', supplyBig.toString());
    } catch (e) {
        console.error('❌ STEP 3 FAILED: getContract/ABI build error:', e);
        throw e;
    }

    // ── STEP 4: Simulate deployToken ────────────────────────────────────────
    let simulation;
    try {
        console.log('🔄 STEP 4: Simulating deployToken(', name, ',', symbol, ',', supplyBig, ')');
        simulation = await factory.deployToken(name, symbol, supplyBig);
        console.log('✅ STEP 4: Simulation result received');
        if ('error' in simulation) {
            throw new Error(simulation.error);
        }
    } catch (e) {
        console.error('❌ STEP 4 FAILED: factory.deployToken simulation error:', e);
        throw e;
    }

    // ── STEP 5: Send transaction via OPWallet ───────────────────────────────
    let receipt;
    try {
        console.log('🔄 STEP 5: Sending transaction...');
        receipt = await simulation.sendTransaction({
            signer: null,       // OPWallet signs
            mldsaSigner: null,  // OPWallet signs
            refundTo: senderAddress,
            feeRate: 200,
        });
        console.log('✅ STEP 5: receipt received');
    } catch (e) {
        console.error('❌ STEP 5 FAILED: sendTransaction error:', e);
        throw e;
    }

    // ── STEP 6: Parse result ────────────────────────────────────────────────
    if (!receipt || !receipt.result || !receipt.result.newToken) {
        throw new Error('Transaction successful but could not parse token address.');
    }
    return receipt.result.newToken;
}

// ============================================================
// Recently Launched Tokens
// ============================================================

/**
 * Loads tokens from localStorage.
 */
function loadTokens() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (raw) {
            state.launchedTokens = JSON.parse(raw);
        }
    } catch {
        state.launchedTokens = [];
    }
}

/**
 * Saves tokens to localStorage.
 */
function saveTokens() {
    try {
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.launchedTokens));
    } catch {
        // localStorage full or blocked — silent fail
    }
}

/**
 * Adds a new token to the list and re-renders.
 * @param {{ name: string, symbol: string, totalSupply: string, creator: string, address: string }} token
 */
function addToken(token) {
    const record = {
        name: token.name,
        symbol: token.symbol,
        totalSupply: token.totalSupply,
        creator: token.creator,
        address: token.address,
        createdAt: Date.now(),
    };
    state.launchedTokens.unshift(record);
    saveTokens();
    renderTokensList();
    updateGlobalCounter();
}

/**
 * Formats a number with commas.
 * @param {string|number} num
 * @returns {string}
 */
function formatSupply(num) {
    const n = Number(String(num).replace(/,/g, ''));
    if (isNaN(n)) return String(num);
    return n.toLocaleString('en-US');
}

/**
 * Returns a human-readable "time ago" string.
 * @param {number} timestamp - Unix ms timestamp
 * @returns {string}
 */
function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
}

/**
 * Renders the full tokens list to the DOM.
 */
function renderTokensList() {
    const count = state.launchedTokens.length;

    // Update count badge
    dom.tokensCount.textContent = count;

    // Toggle empty state
    if (count === 0) {
        dom.tokensEmpty.style.display = 'block';
        // Remove any leftover cards
        dom.tokensList.querySelectorAll('.token-card').forEach((c) => c.remove());
        return;
    }

    dom.tokensEmpty.style.display = 'none';

    // Build cards
    const fragment = document.createDocumentFragment();

    state.launchedTokens.forEach((token, index) => {
        const card = document.createElement('div');
        card.className = 'token-card';
        card.style.animationDelay = `${index * 60}ms`;

        const symbolShort = token.symbol.slice(0, 3);

        card.innerHTML = `
            <div class="token-card__top-row">
                <div class="token-card__icon">${escapeHtml(symbolShort)}</div>
                <span class="token-card__name">${escapeHtml(token.name)}</span>
                <span class="token-card__symbol">${escapeHtml(token.symbol)}</span>
            </div>
            <div class="token-card__details">
                <div class="token-card__detail">
                    <span class="token-card__detail-label">Supply</span>
                    <span class="token-card__detail-value">${formatSupply(token.totalSupply)}</span>
                </div>
                <div class="token-card__detail">
                    <span class="token-card__detail-label">Creator</span>
                    <span class="token-card__detail-value token-card__detail-value--mono">${truncateAddress(token.creator)}</span>
                </div>
                <div class="token-card__detail">
                    <span class="token-card__detail-label">Contract</span>
                    <span class="token-card__detail-value token-card__detail-value--mono">${truncateAddress(token.address)}</span>
                </div>
                <div class="token-card__detail" style="margin-left:auto;">
                    <span class="token-card__detail-label">Created</span>
                    <span class="token-card__detail-value token-card__detail-value--time" data-timestamp="${token.createdAt}">${timeAgo(token.createdAt)}</span>
                </div>
            </div>
        `;

        // Open detail modal on click
        card.addEventListener('click', () => openTokenDetail(token));

        fragment.appendChild(card);
    });

    // Clear old cards, keep empty state element
    dom.tokensList.querySelectorAll('.token-card').forEach((c) => c.remove());
    dom.tokensList.appendChild(fragment);
}

/**
 * Updates all "time ago" labels without full re-render.
 */
function refreshTimeLabels() {
    dom.tokensList.querySelectorAll('[data-timestamp]').forEach((el) => {
        const ts = parseInt(el.getAttribute('data-timestamp'), 10);
        if (!isNaN(ts)) {
            el.textContent = timeAgo(ts);
        }
    });
}

/**
 * Simple HTML escape to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// ============================================================
// Token Detail Modal
// ============================================================

/**
 * Opens the token detail modal for a given token.
 * @param {object} token - Token record from state.launchedTokens
 */
function openTokenDetail(token) {
    state.currentDetailToken = token;

    dom.detailIcon.textContent = token.symbol.slice(0, 3);
    dom.detailName.textContent = token.name;
    dom.detailSymbol.textContent = token.symbol;
    dom.detailSupply.textContent = formatSupply(token.totalSupply);
    dom.detailAddress.textContent = token.address;
    dom.detailCreator.textContent = token.creator;
    dom.detailCopyAddr.classList.remove('copied');

    dom.detailOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    SFX.click();
}

/**
 * Closes the token detail modal.
 */
function closeTokenDetail() {
    dom.detailOverlay.classList.remove('active');
    document.body.style.overflow = '';
    state.currentDetailToken = null;
}

/**
 * Copies the contract address in the detail modal.
 */
async function copyDetailAddress() {
    const addr = dom.detailAddress.textContent;
    if (!addr) return;

    try {
        await navigator.clipboard.writeText(addr);
    } catch {
        const range = document.createRange();
        range.selectNodeContents(dom.detailAddress);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
    }
    dom.detailCopyAddr.classList.add('copied');
    SFX.copy();
    setTimeout(() => dom.detailCopyAddr.classList.remove('copied'), 1500);
}

/**
 * Adds the current token to OPWallet.
 * Uses the unisat-compatible API to request adding a token.
 */
async function addTokenToWallet() {
    const token = state.currentDetailToken;
    if (!token) return;

    if (!isWalletAvailable()) {
        window.open('https://opnet.org', '_blank');
        return;
    }

    try {
        const provider = window.opnet || window.unisat;
        if (provider && typeof provider.sendBitcoin === 'function') {
            // For now we copy the address so the user can add manually
            await navigator.clipboard.writeText(token.address);
            alert('Token address copied! Add it manually in OPWallet > Manage Tokens.');
        }
    } catch (err) {
        alert('Could not add token. Please add the contract address manually in OPWallet.');
    }
}

/**
 * Opens Twitter/X with a pre-filled tweet about the token.
 */
function shareOnTwitter() {
    const token = state.currentDetailToken;
    if (!token) return;

    const text = `I just launched $${token.symbol} on Bitcoin L1 via OP_NET! 🚀 Contract: ${token.address} #opnetvibecode`;
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
}

// ============================================================
// UI Helpers
// ============================================================

/**
 * Shows an error message.
 * @param {string} msg - Error text
 */
function showError(msg) {
    dom.errorMsg.textContent = msg;
    dom.errorMsg.classList.add('visible');
    SFX.error();
}

/** Hides the error message. */
function hideError() {
    dom.errorMsg.classList.remove('visible');
}

/**
 * Sets the launch button to loading state.
 * @param {boolean} loading
 */
function setLoading(loading) {
    state.isLaunching = loading;
    dom.btnLaunch.classList.toggle('loading', loading);
    dom.btnLaunch.disabled = loading;
    const textEl = dom.btnLaunch.querySelector('.btn-launch__text');
    textEl.textContent = loading ? 'Deploying your token to Bitcoin...' : 'Launch Token';
}

/**
 * Switches to the success view.
 * @param {string} address - Deployed token address
 */
function showSuccess(address) {
    dom.tokenAddress.textContent = address;
    dom.formView.style.display = 'none';
    dom.successView.classList.add('active');
    SFX.success();
}

/** Resets back to the form view. */
function resetView() {
    dom.form.reset();
    dom.formView.style.display = 'block';
    dom.successView.classList.remove('active');
    dom.btnCopy.classList.remove('copied');
    hideError();
    updateLaunchButton();
}

// ============================================================
// Event Handlers
// ============================================================

dom.btnWallet.addEventListener('click', connectWallet);

dom.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    // Wallet gate
    if (!state.isConnected) {
        showError('Please connect your OPWallet first.');
        return;
    }

    const validation = validateForm();
    if (!validation.valid) {
        showError(validation.error);
        return;
    }

    setLoading(true);

    try {
        const name = dom.inputName.value.trim();
        const symbol = dom.inputSymbol.value.trim();
        const supply = dom.inputSupply.value.trim().replace(/,/g, '');

        const tokenAddr = await deployToken(name, symbol, supply);

        // Track the newly launched token
        addToken({
            name,
            symbol,
            totalSupply: supply,
            creator: state.walletAddress || 'unknown',
            address: tokenAddr,
        });

        showSuccess(tokenAddr);
    } catch (err) {
        showError(err.message || 'Deployment failed. Please try again.');
    } finally {
        setLoading(false);
    }
});

dom.btnCopy.addEventListener('click', async () => {
    const addr = dom.tokenAddress.textContent;
    if (!addr || addr === '—') return;

    try {
        await navigator.clipboard.writeText(addr);
        dom.btnCopy.classList.add('copied');
        setTimeout(() => dom.btnCopy.classList.remove('copied'), 1500);
    } catch {
        // Fallback
        const range = document.createRange();
        range.selectNodeContents(dom.tokenAddress);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        dom.btnCopy.classList.add('copied');
        setTimeout(() => dom.btnCopy.classList.remove('copied'), 1500);
    }
});

dom.btnReset.addEventListener('click', resetView);

// Live-enable launch button on input
[dom.inputName, dom.inputSymbol, dom.inputSupply].forEach((input) => {
    input.addEventListener('input', updateLaunchButton);
});

// Force uppercase for symbol
dom.inputSymbol.addEventListener('input', () => {
    dom.inputSymbol.value = dom.inputSymbol.value.toUpperCase();
});

// Format supply with commas on blur
dom.inputSupply.addEventListener('blur', () => {
    const raw = dom.inputSupply.value.replace(/,/g, '').trim();
    if (raw && !isNaN(Number(raw))) {
        dom.inputSupply.value = Number(raw).toLocaleString('en-US');
    }
});
dom.inputSupply.addEventListener('focus', () => {
    dom.inputSupply.value = dom.inputSupply.value.replace(/,/g, '');
});

// Detail modal events
dom.detailClose.addEventListener('click', closeTokenDetail);
dom.detailCopyAddr.addEventListener('click', copyDetailAddress);
dom.detailAddWallet.addEventListener('click', addTokenToWallet);
dom.detailShareTwitter.addEventListener('click', shareOnTwitter);

// Close detail on overlay click (outside card)
dom.detailOverlay.addEventListener('click', (e) => {
    if (e.target === dom.detailOverlay) closeTokenDetail();
});

// Close detail on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.currentDetailToken) closeTokenDetail();
});

// ============================================================
// Initialization
// ============================================================

// Load persisted tokens & render
loadTokens();
renderTokensList();
updateLaunchButton();
updateGlobalCounter();

// Auto-refresh "time ago" labels
setInterval(refreshTimeLabels, CONFIG.TIME_REFRESH_MS);

// ============================================================
// Global Token Counter
// ============================================================

/**
 * Updates the "X tokens launched so far" counter in the hero banner.
 */
function updateGlobalCounter() {
    const el = dom.globalTokenCount;
    if (!el) return;
    el.textContent = state.launchedTokens.length;
    // Bump animation
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 300);
}
