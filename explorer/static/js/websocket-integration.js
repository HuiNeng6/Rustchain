/**
 * RustChain Explorer - Real-Time WebSocket Integration
 * Bounty #2295: Block Explorer WebSocket
 * 
 * This file adds WebSocket real-time updates to the existing explorer.
 * It can be loaded after the main explorer.js to enhance it with live updates.
 * 
 * Author: HuiNeng
 * Wallet: 9dRRMiHiJwjF3VW8pXtKDtpmmxAPFy3zWgV2JY5H6eeT
 */

// ─── WebSocket Integration for Existing Explorer ─────────────────────────── //

(function() {
    'use strict';
    
    // WebSocket configuration
    const WS_CONFIG = {
        url: window.WS_URL || (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + 
             (window.location.host || 'rustchain.org') + '/ws',
        reconnectInterval: 3000,
        maxReconnectAttempts: 10,
        pingInterval: 30000,
        debug: true
    };
    
    // State
    let ws = null;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let pingTimer = null;
    let minerChart = null;
    
    // ─── Connection Status UI ─────────────────────────────────────────── //
    
    function createConnectionStatusUI() {
        // Check if already exists
        if (document.getElementById('ws-connection-status')) return;
        
        const statusBar = document.querySelector('.status-bar .container');
        if (!statusBar) return;
        
        // Create connection status element
        const statusEl = document.createElement('div');
        statusEl.id = 'ws-connection-status';
        statusEl.className = 'ws-status ws-status-disconnected';
        statusEl.innerHTML = `
            <span class="ws-status-icon">🔴</span>
            <span class="ws-status-text">Connecting...</span>
        `;
        
        // Add styles
        const styles = document.createElement('style');
        styles.id = 'ws-connection-styles';
        styles.textContent = `
            .ws-status {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 0.85rem;
                font-weight: 500;
                transition: all 0.3s ease;
            }
            
            .ws-status-icon {
                font-size: 0.8rem;
            }
            
            .ws-status-connected {
                background: rgba(16, 185, 129, 0.15);
                color: #10b981;
            }
            
            .ws-status-reconnecting {
                background: rgba(245, 158, 11, 0.15);
                color: #f59e0b;
                animation: pulse 1.5s infinite;
            }
            
            .ws-status-disconnected {
                background: rgba(239, 68, 68, 0.15);
                color: #ef4444;
            }
            
            .ws-status-failed {
                background: rgba(239, 68, 68, 0.25);
                color: #ef4444;
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            
            /* Real-time update flash animation */
            .realtime-flash {
                animation: flashHighlight 0.5s ease-out;
            }
            
            @keyframes flashHighlight {
                0% { background-color: rgba(139, 92, 246, 0.3); }
                100% { background-color: transparent; }
            }
            
            /* New row animation */
            .new-row {
                animation: slideInRow 0.3s ease-out;
            }
            
            @keyframes slideInRow {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            /* Miner count mini chart container */
            #miner-count-chart-container {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-top: 8px;
            }
            
            #miner-chart-label {
                font-size: 0.8rem;
                color: var(--text-secondary);
            }
        `;
        
        document.head.appendChild(styles);
        
        // Insert into status bar
        const statusContent = statusBar.querySelector('.status-content');
        if (statusContent) {
            statusContent.appendChild(statusEl);
        } else {
            statusBar.appendChild(statusEl);
        }
    }
    
    function updateConnectionStatus(status) {
        const statusEl = document.getElementById('ws-connection-status');
        if (!statusEl) return;
        
        const statusConfig = {
            connected: { icon: '🟢', text: 'Live', class: 'ws-status-connected' },
            reconnecting: { icon: '🟡', text: 'Reconnecting...', class: 'ws-status-reconnecting' },
            disconnected: { icon: '🔴', text: 'Disconnected', class: 'ws-status-disconnected' },
            failed: { icon: '❌', text: 'Failed', class: 'ws-status-failed' },
            connecting: { icon: '🟡', text: 'Connecting...', class: 'ws-status-reconnecting' }
        };
        
        const config = statusConfig[status] || statusConfig.disconnected;
        statusEl.className = `ws-status ${config.class}`;
        statusEl.innerHTML = `
            <span class="ws-status-icon">${config.icon}</span>
            <span class="ws-status-text">${config.text}</span>
        `;
    }
    
    // ─── WebSocket Connection ─────────────────────────────────────────── //
    
    function connectWebSocket() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('[WS] Already connected');
            return;
        }
        
        updateConnectionStatus('connecting');
        
        try {
            // Try Socket.IO first if available
            if (typeof io !== 'undefined') {
                connectSocketIO();
            } else {
                connectNativeWS();
            }
        } catch (error) {
            console.error('[WS] Connection error:', error);
            handleConnectionError(error);
        }
    }
    
    function connectSocketIO() {
        const socketUrl = WS_CONFIG.url.replace('/ws', '');
        console.log('[WS] Connecting via Socket.IO to:', socketUrl);
        
        ws = io(socketUrl, {
            path: '/socket.io',
            transports: ['websocket'],
            reconnection: false
        });
        
        ws.on('connect', handleConnect);
        ws.on('disconnect', handleDisconnect);
        ws.on('connect_error', handleConnectionError);
        
        ws.on('connected', (data) => {
            console.log('[WS] Server acknowledged:', data);
        });
        
        ws.on('event', handleEvent);
        ws.on('status', handleStatus);
    }
    
    function connectNativeWS() {
        console.log('[WS] Connecting via native WebSocket to:', WS_CONFIG.url);
        
        ws = new WebSocket(WS_CONFIG.url);
        
        ws.onopen = handleConnect;
        ws.onclose = handleDisconnect;
        ws.onerror = handleConnectionError;
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleMessage(data);
            } catch (e) {
                console.error('[WS] Parse error:', e);
            }
        };
    }
    
    function handleConnect() {
        console.log('[WS] Connected!');
        updateConnectionStatus('connected');
        reconnectAttempts = 0;
        
        // Subscribe to events
        sendMessage({
            type: 'subscribe',
            types: ['new_block', 'attestation', 'epoch_settlement']
        });
        
        // Start ping
        startPing();
    }
    
    function handleDisconnect() {
        console.log('[WS] Disconnected');
        updateConnectionStatus('disconnected');
        stopPing();
        attemptReconnect();
    }
    
    function handleConnectionError(error) {
        console.error('[WS] Error:', error);
        updateConnectionStatus('failed');
        attemptReconnect();
    }
    
    function attemptReconnect() {
        if (reconnectAttempts >= WS_CONFIG.maxReconnectAttempts) {
            console.log('[WS] Max reconnect attempts reached');
            updateConnectionStatus('failed');
            return;
        }
        
        reconnectAttempts++;
        updateConnectionStatus('reconnecting');
        
        console.log(`[WS] Reconnecting in ${WS_CONFIG.reconnectInterval}ms (attempt ${reconnectAttempts})`);
        
        reconnectTimer = setTimeout(() => {
            connectWebSocket();
        }, WS_CONFIG.reconnectInterval);
    }
    
    // ─── Message Handling ───────────────────────────────────────────── //
    
    function sendMessage(data) {
        if (!ws) return;
        
        try {
            if (typeof io !== 'undefined' && ws.emit) {
                ws.emit(data.type, data);
            } else if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(data));
            }
        } catch (e) {
            console.error('[WS] Send error:', e);
        }
    }
    
    function handleMessage(data) {
        if (data.type === 'pong') return;
        if (data.type === 'connected') {
            console.log('[WS] Server acknowledged connection');
            return;
        }
        
        handleEvent(data);
    }
    
    function handleEvent(event) {
        if (!event || !event.type) return;
        
        console.log('[WS] Event:', event.type, event.data);
        
        switch (event.type) {
            case 'new_block':
                handleNewBlock(event.data);
                break;
            case 'attestation':
                handleAttestation(event.data);
                break;
            case 'epoch_settlement':
                handleEpochSettlement(event.data);
                break;
            case 'status':
                handleStatus(event.data);
                break;
        }
    }
    
    // ─── Event Handlers ─────────────────────────────────────────────── //
    
    function handleNewBlock(data) {
        console.log('[WS] New block:', data);
        
        // Update state
        if (window.RustChainExplorer && window.RustChainExplorer.state) {
            // Prepend to blocks array
            window.RustChainExplorer.state.blocks.unshift(data);
            // Limit to MAX_RECENT_BLOCKS
            if (window.RustChainExplorer.state.blocks.length > 50) {
                window.RustChainExplorer.state.blocks.pop();
            }
        }
        
        // Update UI
        updateBlocksTable(data);
        updateEpochProgress(data);
        
        // Flash notification
        flashElement('blocks-tbody');
    }
    
    function handleAttestation(data) {
        console.log('[WS] New attestation:', data);
        
        // Update miners count
        if (window.RustChainExplorer && window.RustChainExplorer.state) {
            // Find or add miner
            const miners = window.RustChainExplorer.state.miners;
            const existingIndex = miners.findIndex(m => 
                (m.wallet_name || m.wallet) === data.wallet
            );
            
            if (existingIndex >= 0) {
                miners[existingIndex].last_attestation_time = data.timestamp;
                miners[existingIndex].device_arch = data.architecture;
                miners[existingIndex].multiplier = data.multiplier;
            } else {
                miners.push({
                    wallet_name: data.wallet,
                    miner_id: data.miner_id,
                    device_arch: data.architecture,
                    multiplier: data.multiplier,
                    last_attestation_time: data.timestamp,
                    last_seen: data.timestamp
                });
            }
        }
        
        // Update UI
        updateMinersTable(data);
        
        // Update miner chart
        if (minerChart && window.RustChainExplorer) {
            minerChart.update(window.RustChainExplorer.state.miners.length);
        }
        
        // Flash notification
        flashElement('miners-tbody');
    }
    
    function handleEpochSettlement(data) {
        console.log('[WS] Epoch settlement:', data);
        
        // Play sound notification
        playNotificationSound();
        
        // Show visual notification
        showEpochNotification(data);
        
        // Update epoch stats
        updateEpochStats(data);
    }
    
    function handleStatus(data) {
        console.log('[WS] Status:', data);
        
        // Update miner chart with history
        if (minerChart && data.miner_history) {
            data.miner_history.forEach(point => {
                minerChart.update(point.count);
            });
        }
    }
    
    // ─── UI Updates ─────────────────────────────────────────────────── //
    
    function updateBlocksTable(block) {
        const tbody = document.getElementById('blocks-tbody');
        if (!tbody) return;
        
        // Create new row
        const row = document.createElement('tr');
        row.className = 'new-row realtime-flash';
        row.innerHTML = `
            <td><strong class="text-accent">#${formatNumber(block.height, 0)}</strong></td>
            <td class="mono" title="${escapeHtml(block.hash || '')}">${shortenHash(block.hash || '0x')}</td>
            <td class="mono">${formatTimestamp(block.timestamp)}</td>
            <td><span class="badge badge-info">${block.miners_count || 0} miners</span></td>
            <td class="text-success">${formatNumber(block.reward || 0, 2)} RTC</td>
        `;
        
        // Insert at top
        tbody.insertBefore(row, tbody.firstChild);
        
        // Remove old rows if too many
        while (tbody.children.length > 20) {
            tbody.removeChild(tbody.lastChild);
        }
    }
    
    function updateMinersTable(attestation) {
        const tbody = document.getElementById('miners-tbody');
        if (!tbody) return;
        
        // Check if miner already in table
        const existingRow = tbody.querySelector(`tr[data-wallet="${attestation.wallet}"]`);
        
        if (existingRow) {
            // Update existing row
            existingRow.classList.add('realtime-flash');
            const lastSeenCell = existingRow.querySelector('td:nth-child(6)');
            if (lastSeenCell) {
                lastSeenCell.textContent = 'Just now';
            }
        } else {
            // Add new row at top
            const tier = getTier(attestation.architecture);
            const row = document.createElement('tr');
            row.className = 'new-row realtime-flash';
            row.dataset.wallet = attestation.wallet;
            row.innerHTML = `
                <td class="mono" title="${escapeHtml(attestation.miner_id || '')}">${shortenAddress(attestation.miner_id || 'unknown')}</td>
                <td><span class="badge badge-${tier}">${escapeHtml(attestation.architecture || 'Unknown')}</span></td>
                <td><span class="badge badge-${tier}">${tier.toUpperCase()}</span></td>
                <td class="text-accent">${formatNumber(attestation.multiplier || 1.0, 2)}x</td>
                <td class="text-success">0.000000 RTC</td>
                <td class="mono">Just now</td>
                <td><span class="badge badge-active">● ACTIVE</span></td>
            `;
            tbody.insertBefore(row, tbody.firstChild);
        }
    }
    
    function updateEpochProgress(block) {
        // Update progress bar if exists
        const progressFill = document.querySelector('.progress-fill');
        if (progressFill && window.RustChainExplorer && window.RustChainExplorer.state) {
            const epoch = window.RustChainExplorer.state.epoch;
            if (epoch) {
                const progress = ((block.height % (epoch.blocks_per_epoch || 144)) / (epoch.blocks_per_epoch || 144)) * 100;
                progressFill.style.width = `${progress}%`;
            }
        }
    }
    
    function updateEpochStats(data) {
        const epochStats = document.getElementById('epoch-stats');
        if (!epochStats) return;
        
        // Update epoch number display
        const epochValue = epochStats.querySelector('.card:first-child .card-value');
        if (epochValue) {
            epochValue.textContent = `#${formatNumber(data.new_epoch, 0)}`;
            epochValue.classList.add('realtime-flash');
        }
        
        // Update pot
        const potValue = epochStats.querySelector('.card:nth-child(2) .card-value');
        if (potValue) {
            potValue.textContent = `${formatNumber(data.pot, 2)} RTC`;
        }
        
        // Update miners count
        const minersValue = epochStats.querySelector('.card:nth-child(3) .card-value');
        if (minersValue) {
            minersValue.textContent = data.miners_count || 0;
        }
    }
    
    function flashElement(elementId) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        element.classList.remove('realtime-flash');
        void element.offsetWidth; // Trigger reflow
        element.classList.add('realtime-flash');
    }
    
    // ─── Notifications ─────────────────────────────────────────────── //
    
    function playNotificationSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (e) {
            console.log('[WS] Could not play sound:', e);
        }
    }
    
    function showEpochNotification(data) {
        const notification = document.createElement('div');
        notification.className = 'epoch-notification';
        notification.innerHTML = `
            <div class="epoch-notification-content">
                <span class="epoch-notification-icon">🎉</span>
                <div class="epoch-notification-text">
                    <strong>Epoch Settlement!</strong>
                    <p>Epoch ${data.old_epoch} → ${data.new_epoch}</p>
                    <p>Reward Pot: ${formatNumber(data.pot, 2)} RTC</p>
                    <p>Miners: ${data.miners_count || 0}</p>
                </div>
                <button class="epoch-notification-close">×</button>
            </div>
        `;
        
        // Add styles if not present
        if (!document.getElementById('epoch-notification-styles')) {
            const styles = document.createElement('style');
            styles.id = 'epoch-notification-styles';
            styles.textContent = `
                .epoch-notification {
                    position: fixed;
                    top: 80px;
                    right: 20px;
                    z-index: 10000;
                    animation: slideIn 0.3s ease-out;
                }
                
                .epoch-notification-content {
                    background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
                    color: white;
                    padding: 16px 20px;
                    border-radius: 12px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    max-width: 320px;
                }
                
                .epoch-notification-icon {
                    font-size: 2rem;
                }
                
                .epoch-notification-text {
                    flex: 1;
                }
                
                .epoch-notification-text strong {
                    display: block;
                    margin-bottom: 4px;
                }
                
                .epoch-notification-text p {
                    margin: 2px 0;
                    font-size: 0.9rem;
                    opacity: 0.9;
                }
                
                .epoch-notification-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 1.5rem;
                    cursor: pointer;
                    padding: 0;
                    line-height: 1;
                }
                
                @keyframes slideIn {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            `;
            document.head.appendChild(styles);
        }
        
        document.body.appendChild(notification);
        
        // Close button
        notification.querySelector('.epoch-notification-close').addEventListener('click', () => {
            notification.remove();
        });
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
            notification.remove();
        }, 10000);
    }
    
    // ─── Mini Chart ───────────────────────────────────────────────── //
    
    function initMinerChart() {
        const chartContainer = document.getElementById('miner-count-chart-container');
        if (!chartContainer) {
            // Create container if not exists
            const statsCard = document.querySelector('#hardware-breakdown')?.closest('.card');
            if (statsCard) {
                const container = document.createElement('div');
                container.id = 'miner-count-chart-container';
                container.innerHTML = `
                    <span id="miner-chart-label">Miner Count (1h):</span>
                    <canvas id="miner-chart" width="120" height="40"></canvas>
                `;
                statsCard.appendChild(container);
            }
        }
        
        const canvas = document.getElementById('miner-chart');
        if (canvas && typeof MinerCountChart !== 'undefined') {
            minerChart = new MinerCountChart('miner-chart', {
                width: 120,
                height: 40,
                color: '#8b5cf6'
            });
        }
    }
    
    // ─── Utility Functions ─────────────────────────────────────────── //
    
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    
    function shortenHash(hash, chars = 8) {
        if (!hash) return '';
        if (hash.length <= chars * 2) return hash;
        return `${hash.slice(0, chars)}...${hash.slice(-chars)}`;
    }
    
    function shortenAddress(addr, chars = 6) {
        if (!addr) return '';
        if (addr.length <= chars * 2) return addr;
        return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
    }
    
    function formatNumber(num, decimals = 2) {
        if (num === null || num === undefined) return '0';
        return Number(num).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }
    
    function formatTimestamp(ts) {
        if (!ts) return 'N/A';
        const timestamp = typeof ts === 'number' ? ts * 1000 : new Date(ts).getTime();
        if (isNaN(timestamp)) return 'Invalid Date';
        return new Date(timestamp).toLocaleString();
    }
    
    function getTier(arch) {
        if (!arch) return 'modern';
        const archLower = arch.toLowerCase();
        if (archLower.includes('g3') || archLower.includes('g4') || archLower.includes('g5') || 
            archLower.includes('powerpc') || archLower.includes('ppc')) return 'vintage';
        if (archLower.includes('sparc') || archLower.includes('mips')) return 'ancient';
        if (archLower.includes('pentium') || archLower.includes('486')) return 'retro';
        return 'modern';
    }
    
    // ─── Ping/Pong ─────────────────────────────────────────────────── //
    
    function startPing() {
        stopPing();
        
        pingTimer = setInterval(() => {
            if (ws && (ws.readyState === WebSocket.OPEN || (ws.emit && ws.connected))) {
                sendMessage({ type: 'ping' });
            }
        }, WS_CONFIG.pingInterval);
    }
    
    function stopPing() {
        if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
        }
    }
    
    // ─── Initialization ───────────────────────────────────────────── //
    
    function init() {
        console.log('[WS] Initializing WebSocket integration...');
        
        // Create UI elements
        createConnectionStatusUI();
        
        // Initialize miner chart
        initMinerChart();
        
        // Connect to WebSocket
        connectWebSocket();
        
        console.log('[WS] WebSocket integration initialized');
    }
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // Expose for debugging
    window.RustChainWS = {
        connect: connectWebSocket,
        disconnect: () => {
            if (ws) {
                if (ws.disconnect) ws.disconnect();
                else if (ws.close) ws.close();
            }
        },
        getState: () => ({
            connected: ws && (ws.readyState === WebSocket.OPEN || (ws.connected !== undefined ? ws.connected : false)),
            reconnectAttempts
        })
    };
    
})();