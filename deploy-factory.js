import { JSONRpcProvider } from 'opnet';
import { TransactionFactory } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

const CONFIG = {
    NETWORK: networks.opnetTestnet,
    RPC_URL: 'https://testnet.opnet.org',
};

const provider = new JSONRpcProvider({ url: CONFIG.RPC_URL, network: CONFIG.NETWORK });
const factory = new TransactionFactory();

let walletAddress = null;
let bytecode = null;

const dom = {
    btnConnect: document.getElementById('btn-connect'),
    walletStatus: document.getElementById('wallet-status'),
    fileInput: document.getElementById('file-input'),
    btnDeploy: document.getElementById('btn-deploy'),
    status: document.getElementById('status'),
};

function checkReady() {
    dom.btnDeploy.disabled = !(walletAddress && bytecode);
}

function showStatus(text, isError = false) {
    dom.status.style.display = 'block';
    dom.status.style.color = isError ? '#ef4444' : '#4ade80';
    dom.status.innerHTML = text;
}

// 1. Connect Wallet
dom.btnConnect.addEventListener('click', async () => {
    try {
        if (!window.unisat) throw new Error('OPWallet extension not found!');
        const accounts = await window.unisat.requestAccounts();
        if (accounts.length > 0) {
            walletAddress = accounts[0];
            dom.walletStatus.textContent = `✅ Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
            dom.btnConnect.style.display = 'none';
            checkReady();
        }
    } catch (err) {
        showStatus('Connection failed: ' + err.message, true);
    }
});

// 2. Read WASM
dom.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) {
        bytecode = null;
        checkReady();
        return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
        bytecode = new Uint8Array(ev.target.result);
        checkReady();
    };
    reader.readAsArrayBuffer(file);
});

// 3. Deploy
dom.btnDeploy.addEventListener('click', async () => {
    try {
        dom.btnDeploy.disabled = true;
        showStatus('Gathering UTXOs... Please wait.');

        const utxos = await provider.utxoManager.getUTXOs({ address: walletAddress });
        if (!utxos || utxos.length === 0) {
            throw new Error('No UTXOs found! You need testnet BTC to deploy.');
        }

        showStatus('Fetching network challenge...');
        const challenge = await provider.getChallenge();

        showStatus('Check your OPWallet popup!<br>Please sign the deployment transaction...');

        const params = {
            from: walletAddress,
            utxos: utxos,
            signer: null, // Signals OPWallet to sign
            mldsaSigner: null,
            network: CONFIG.NETWORK,
            feeRate: 200,          // standard fee rate
            priorityFee: 0n,
            gasSatFee: 15_000n,    // Deployment gas cost (bumped for safety)
            bytecode: bytecode,
            challenge: challenge,
            linkMLDSAPublicKeyToAddress: true,
            revealMLDSAPublicKey: true,
        };

        const deployment = await factory.signDeployment(params);

        showStatus('Broadcasting Funding Tx...');
        const fundRes = await provider.sendRawTransaction(deployment.transaction[0]);

        showStatus('Broadcasting Reveal Tx...');
        const revealRes = await provider.sendRawTransaction(deployment.transaction[1]);

        showStatus(`
            <b style="color: #f7931a;font-size: 20px;">🚀 Deployment Successful!</b><br><br>
            <span style="color:#fff;">Contract Address:</span><br>
            <b style="user-select:all;word-break:break-all;">${deployment.contractAddress}</b><br><br>
            <span style="color:#aaa;font-size:14px;">Copy this address and replace FACTORY_ADDRESS in app.js!</span>
        `);
    } catch (err) {
        console.error(err);
        showStatus('<b>Error:</b> ' + (err.message || err.toString()), true);
        dom.btnDeploy.disabled = false;
    }
});
