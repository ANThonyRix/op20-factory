/**
 * deploy-factory.js
 *
 * Multi-step factory deployment UI:
 *   Step 1 — Connect OPWallet
 *   Step 2 — Deploy MyToken.wasm (token template) [SKIPPED FOR NOW]
 *   Step 3 — Deploy MyFactory.wasm (factory contract) [SKIPPED FOR NOW]
 *   Step 4 — Initialize factory (link template + fee recipient)
 */

import { TransactionFactory, BinaryWriter, Address, OPNetLimitedProvider } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

// ── Config ───────────────────────────────────────────────────────────────────
const NETWORK = networks.testnet;
const RPC_URL = 'https://testnet.opnet.org';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
    walletAddress: null,
    tokenAddress: '0x16c0119259ec5422fcc3acaf33401435098b85c902a27ae864e090be5e8d42c1',
    factoryAddress: '0x2aaf4fcfe7e3e04579454f7819ddc1474b066de2365999742924e700699510ed5',
};

// ── DOM Refs ─────────────────────────────────────────────────────────────────
const dom = {
    btnConnect: document.getElementById('btn-connect'),
    walletDisplay: document.getElementById('wallet-display'),
    step: (n) => document.getElementById(`step-${n}`),
    status: (n) => document.getElementById(`status-${n}`),

    initTokenAddr: document.getElementById('init-token-addr'),
    initFeeRecip: document.getElementById('init-fee-recipient'),
    btnInit: document.getElementById('btn-init'),
    initProgress: document.getElementById('init-progress'),
    initFill: document.getElementById('init-fill'),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(step, type, msg) {
    const el = dom.status(step);
    if (!el) return;
    el.className = `status-msg ${type}`;
    el.innerHTML = msg;
}

function activateStep(n) {
    for (let i = 1; i <= 4; i++) {
        const card = dom.step(i);
        if (!card) continue;
        if (i < n) {
            card.className = 'step-card done';
            card.style.pointerEvents = 'none';
        } else if (i === n) {
            card.className = 'step-card active';
        } else {
            card.className = 'step-card locked';
        }
    }
}

function startProgress(fillEl, progressEl) {
    if (!fillEl || !progressEl) return () => { };
    progressEl.style.display = 'block';
    let w = 0;
    const t = setInterval(() => { if (w < 90) { w += Math.random() * 8; fillEl.style.width = `${Math.min(w, 90)}%`; } }, 400);
    return () => { clearInterval(t); fillEl.style.width = '100%'; setTimeout(() => progressEl.style.display = 'none', 800); };
}

// ── Step 1: Connect Wallet ────────────────────────────────────────────────────
dom.btnConnect.addEventListener('click', async () => {
    try {
        dom.btnConnect.disabled = true;
        setStatus(1, 'info', 'Connecting to OPWallet...');

        const walletProvider = window.opnet || window.unisat;
        if (!walletProvider) throw new Error('OPWallet extension not found. Please install OPWallet.');

        const accounts = await walletProvider.requestAccounts();
        if (!accounts || accounts.length === 0) throw new Error('No accounts returned.');

        const raw = accounts[0];
        state.walletAddress = typeof raw === 'object'
            ? (raw.p2op || raw.address || raw.p2tr || String(raw))
            : raw;

        dom.walletDisplay.style.display = 'block';
        dom.walletDisplay.innerHTML = `<div class="wallet-badge">${state.walletAddress.slice(0, 12)}...${state.walletAddress.slice(-6)}</div>`;
        dom.btnConnect.textContent = '✓ Connected';

        setStatus(1, 'success', '✅ Wallet connected!');

        // Jump straight to Step 4 since Factory & Token Template are deployed
        dom.initTokenAddr.value = state.tokenAddress;
        dom.initFeeRecip.value = state.walletAddress;
        dom.btnInit.disabled = false;
        activateStep(4);

    } catch (err) {
        setStatus(1, 'error', `❌ ${err.message}`);
        dom.btnConnect.disabled = false;
    }
});

// ── Step 4: Initialize Factory ────────────────────────────────────────────────
dom.btnInit.addEventListener('click', async () => {
    try {
        dom.btnInit.disabled = true;
        const feeRecipient = dom.initFeeRecip.value.trim();
        const tokenTemplateValue = dom.initTokenAddr.value.trim();

        if (!feeRecipient || !tokenTemplateValue) {
            throw new Error('Fee recipient and token template address are required.');
        }

        setStatus(4, 'info', '⚡ Building transaction...<br><small>Check OPWallet for a signing popup!</small>');
        const done = startProgress(dom.initFill, dom.initProgress);

        const provider = new OPNetLimitedProvider(RPC_URL);

        // 1. Fetch UTXOs
        console.log('Fetching UTXOs for:', state.walletAddress);
        const utxos = await provider.fetchUTXO({
            address: state.walletAddress,
            minAmount: 10_000n,
            requestedAmount: 500_000n,
        });

        if (!utxos || utxos.length === 0) {
            throw new Error('No UTXOs found for wallet.');
        }

        // 2. Encode calldata: selector + address + address
        const calldata = new BinaryWriter();
        // Selector for initialize(address,address)
        calldata.writeSelector(0x67758e02);

        // First param: Token Template Address
        let templateHex = tokenTemplateValue;
        if (!tokenTemplateValue.startsWith('0x')) {
            // Already have the hex from deployment TX
            templateHex = '0x16c0119259ec5422fcc3acaf33401435098b85c902a27ae864e090be5e8d42c1';
        }
        const templateAddr = Address.fromString(templateHex);
        calldata.writeAddress(templateAddr);

        // Second param: Fee Recipient Address
        const feeRecipientAddr = Address.fromString(feeRecipient);
        calldata.writeAddress(feeRecipientAddr);

        // 3. Build the interaction transaction
        const factory = new TransactionFactory();

        console.log('Requesting OPWallet to sign interaction...');
        // Note: For OPWallet, signer and mldsaSigner are omitted. 
        // OPWallet automatically handles the challenge under the hood.
        const result = await factory.signInteraction({
            network: NETWORK,
            utxos: utxos,
            from: state.walletAddress,
            to: Address.fromString(state.factoryAddress),
            feeRate: 200,
            priorityFee: 330n,
            gasSatFee: 15_000n, // Assuming 15000 is enough
            calldata: calldata.getBuffer()
        });

        console.log('Transaction signed! Result:', result);
        setStatus(4, 'info', '🚀 Transactions signed! Broadcasting now...');

        const walletProvider = window.opnet || window.unisat;

        // 4. Broadcast funding TX first (if applicable)
        if (result.fundingTransaction) {
            console.log('Broadcasting funding tx...');
            await walletProvider.pushTx(result.fundingTransaction);
        }

        // 5. Broadcast interaction TX
        console.log('Broadcasting interaction tx...');
        const txId = await walletProvider.pushTx(result.interactionTransaction);

        done();

        console.log('Initialize receipt txId:', txId);
        setStatus(4, 'success', `
            ✅ Factory initialized!<br><br>
            <b>Transaction ID:</b><br>
            <a href="https://testnet.opnet.org/tx/${txId}" target="_blank" style="color:var(--accent); word-break:break-all;">${txId}</a>
        `);

    } catch (err) {
        console.error('Initialize error:', err);
        const done = startProgress(dom.initFill, dom.initProgress);
        done();
        setStatus(4, 'error', `❌ ${err.message || err}`);
        dom.btnInit.disabled = false;
    }
});
