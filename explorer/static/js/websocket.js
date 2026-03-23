/**
 * RustChain Explorer WebSocket Client
 * Bounty #2295: Block Explorer WebSocket
 * 
 * Features:
 * - Real-time block updates
 * - Real-time attestation updates
 * - Connection status indicator
 * - Auto-reconnect
 * - Epoch settlement notifications
 * 
 * Author: HuiNeng
 * Wallet: 9dRRMiHiJwjF3VW8pXtKDtpmmxAPFy3zWgV2JY5H6eeT
 */

class RustChainWebSocket {
    constructor(config = {}) {
        this.config = {
            url: config.url || 'wss://rustchain.org/ws',
            reconnectInterval: config.reconnectInterval || 3000,
            maxReconnectAttempts: config.maxReconnectAttempts || 10,
            pingInterval: config.pingInterval || 30000,
            debug: config.debug || false
        };
        
        this.socket = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.pingTimer = null;
        
        // Event handlers
        this.handlers = {
            connected: [],
            disconnected: [],
            new_block: [],
            attestation: [],
            epoch_settlement: [],
            status: [],
            error: []
        };
        
        // State
        this.state = {
            lastBlock: null,
            lastAttestation: null,
            minerCount: 0,
            epochInfo: null
        };
        
        // Connection status callback
        this.onConnectionChange = null;
    }
    
    /**
     * Connect to WebSocket server
     */
    connect() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.log('Already connected');
            return;
        }
        
        try {
            this.log(`Connecting to ${this.config.url}...`);
            
            // Use native WebSocket or Socket.IO depending on what's available
            if (typeof io !== 'undefined') {
                this._connectSocketIO();
            } else {
                this._connectNativeWS();
            }
        } catch (error) {
            this.log('Connection error:', error);
            this._handleError(error);
        }
    }
    
    /**
     * Connect using Socket.IO client
     */
    _connectSocketIO() {
        this.socket = io(this.config.url.replace('/ws', ''), {
            path: '/socket.io',
            transports: ['websocket'],
            reconnection: false // We handle reconnection ourselves
        });
        
        this.socket.on('connect', () => {
            this._handleConnect();
        });
        
        this.socket.on('disconnect', () => {
            this._handleDisconnect();
        });
        
        this.socket.on('connected', (data) => {
            this.log('Server acknowledged connection:', data);
            this._emit('connected', data);
        });
        
        this.socket.on('event', (event) => {
            this._handleEvent(event);
        });
        
        this.socket.on('status', (status) => {
            this._handleStatus(status);
        });
        
        this.socket.on('error', (error) => {
            this._handleError(error);
        });
    }
    
    /**
     * Connect using native WebSocket
     */
    _connectNativeWS() {
        this.socket = new WebSocket(this.config.url);
        
        this.socket.onopen = () => {
            this._handleConnect();
            
            // Send initial ping
            this._send({ type: 'ping' });
        };
        
        this.socket.onclose = (event) => {
            this._handleDisconnect();
        };
        
        this.socket.onerror = (error) => {
            this._handleError(error);
        };
        
        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this._handleMessage(data);
            } catch (e) {
                this.log('Failed to parse message:', e);
            }
        };
    }
    
    /**
     * Handle successful connection
     */
    _handleConnect() {
        this.log('Connected!');
        this.connected = true;
        this.reconnectAttempts = 0;
        
        // Update connection status
        this._updateConnectionStatus('connected');
        
        // Start ping/keepalive
        this._startPing();
        
        // Subscribe to all events
        this.subscribe(['new_block', 'attestation', 'epoch_settlement']);
    }
    
    /**
     * Handle disconnection
     */
    _handleDisconnect() {
        this.log('Disconnected');
        this.connected = false;
        
        // Update connection status
        this._updateConnectionStatus('disconnected');
        
        // Stop ping
        this._stopPing();
        
        // Attempt reconnect
        this._attemptReconnect();
    }
    
    /**
     * Handle incoming message
     */
    _handleMessage(data) {
        if (data.type === 'pong') {
            // Pong response
            return;
        }
        
        if (data.type === 'connected') {
            this._emit('connected', data);
            return;
        }
        
        if (data.type === 'status') {
            this._handleStatus(data);
            return;
        }
        
        // Handle events
        this._handleEvent(data);
    }
    
    /**
     * Handle event from server
     */
    _handleEvent(event) {
        if (!event || !event.type) return;
        
        this.log('Event received:', event.type, event.data);
        
        switch (event.type) {
            case 'new_block':
                this.state.lastBlock = event.data;
                this._emit('new_block', event.data);
                break;
                
            case 'attestation':
                this.state.lastAttestation = event.data;
                this._emit('attestation', event.data);
                break;
                
            case 'epoch_settlement':
                this._emit('epoch_settlement', event.data);
                this._handleEpochSettlement(event.data);
                break;
                
            default:
                this.log('Unknown event type:', event.type);
        }
    }
    
    /**
     * Handle status update
     */
    _handleStatus(status) {
        this.state.minerCount = status.active_miners || 0;
        this.state.epochInfo = {
            epoch: status.current_epoch,
            slot: status.current_slot,
            miners_count: status.active_miners
        };
        this._emit('status', status);
    }
    
    /**
     * Handle epoch settlement with notification
     */
    _handleEpochSettlement(data) {
        // Play notification sound if available
        this._playNotificationSound();
        
        // Show visual notification
        this._showEpochNotification(data);
    }
    
    /**
     * Play notification sound
     */
    _playNotificationSound() {
        try {
            // Create a simple beep using Web Audio API
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (e) {
            this.log('Could not play notification sound:', e);
        }
    }
    
    /**
     * Show epoch settlement notification
     */
    _showEpochSettlementNotification(data) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = 'epoch-notification';
        notification.innerHTML = `
            <div class="epoch-notification-content">
                <span class="epoch-notification-icon">🎉</span>
                <div class="epoch-notification-text">
                    <strong>Epoch Settlement!</strong>
                    <p>Epoch ${data.old_epoch} → ${data.new_epoch}</p>
                    <p>Reward Pot: ${data.pot.toFixed(2)} RTC</p>
                </div>
                <button class="epoch-notification-close" onclick="this.parentElement.remove()">×</button>
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
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
            notification.remove();
        }, 10000);
    }
    
    /**
     * Show epoch notification (alias for consistency)
     */
    _showEpochNotification(data) {
        this._showEpochSettlementNotification(data);
    }
    
    /**
     * Handle error
     */
    _handleError(error) {
        this.log('Error:', error);
        this._emit('error', error);
    }
    
    /**
     * Attempt to reconnect
     */
    _attemptReconnect() {
        if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            this.log('Max reconnect attempts reached');
            this._updateConnectionStatus('failed');
            return;
        }
        
        this.reconnectAttempts++;
        this._updateConnectionStatus('reconnecting');
        
        this.log(`Reconnecting in ${this.config.reconnectInterval}ms (attempt ${this.reconnectAttempts})`);
        
        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, this.config.reconnectInterval);
    }
    
    /**
     * Start ping/keepalive
     */
    _startPing() {
        this._stopPing();
        
        this.pingTimer = setInterval(() => {
            if (this.connected) {
                this._send({ type: 'ping' });
            }
        }, this.config.pingInterval);
    }
    
    /**
     * Stop ping/keepalive
     */
    _stopPing() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }
    
    /**
     * Send message to server
     */
    _send(data) {
        if (!this.socket) return;
        
        try {
            if (typeof io !== 'undefined' && this.socket.emit) {
                this.socket.emit(data.type, data);
            } else if (this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify(data));
            }
        } catch (e) {
            this.log('Send error:', e);
        }
    }
    
    /**
     * Subscribe to events
     */
    subscribe(eventTypes) {
        this._send({
            type: 'subscribe',
            types: eventTypes
        });
    }
    
    /**
     * Register event handler
     */
    on(event, handler) {
        if (this.handlers[event]) {
            this.handlers[event].push(handler);
        }
        return this;
    }
    
    /**
     * Remove event handler
     */
    off(event, handler) {
        if (this.handlers[event]) {
            this.handlers[event] = this.handlers[event].filter(h => h !== handler);
        }
        return this;
    }
    
    /**
     * Emit event to handlers
     */
    _emit(event, data) {
        if (this.handlers[event]) {
            this.handlers[event].forEach(handler => {
                try {
                    handler(data);
                } catch (e) {
                    this.log('Handler error:', e);
                }
            });
        }
    }
    
    /**
     * Update connection status UI
     */
    _updateConnectionStatus(status) {
        if (this.onConnectionChange) {
            this.onConnectionChange(status);
        }
        
        // Update status indicator in DOM
        const indicator = document.getElementById('ws-connection-status');
        if (indicator) {
            indicator.className = `ws-status ws-status-${status}`;
            indicator.innerHTML = this._getStatusHTML(status);
        }
    }
    
    /**
     * Get status HTML
     */
    _getStatusHTML(status) {
        const statusConfig = {
            connected: { icon: '🟢', text: 'Connected' },
            reconnecting: { icon: '🟡', text: 'Reconnecting...' },
            disconnected: { icon: '🔴', text: 'Disconnected' },
            failed: { icon: '❌', text: 'Connection Failed' }
        };
        
        const config = statusConfig[status] || statusConfig.disconnected;
        return `<span class="ws-status-icon">${config.icon}</span> <span class="ws-status-text">${config.text}</span>`;
    }
    
    /**
     * Disconnect from server
     */
    disconnect() {
        this._stopPing();
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        if (this.socket) {
            try {
                if (typeof io !== 'undefined' && this.socket.disconnect) {
                    this.socket.disconnect();
                } else {
                    this.socket.close();
                }
            } catch (e) {
                this.log('Disconnect error:', e);
            }
            this.socket = null;
        }
        
        this.connected = false;
        this._updateConnectionStatus('disconnected');
    }
    
    /**
     * Get current state
     */
    getState() {
        return { ...this.state };
    }
    
    /**
     * Check if connected
     */
    isConnected() {
        return this.connected;
    }
    
    /**
     * Debug log
     */
    log(...args) {
        if (this.config.debug) {
            console.log('[RustChainWS]', ...args);
        }
    }
}

/**
 * Miner Count Mini Chart
 * Draws a small sparkline chart showing miner count over time
 */
class MinerCountChart {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            width: options.width || 120,
            height: options.height || 40,
            color: options.color || '#8b5cf6',
            bgColor: options.bgColor || 'rgba(139, 92, 246, 0.1)',
            ...options
        };
        
        this.data = [];
        this.maxPoints = 60; // 60 minutes of data
        
        this._init();
    }
    
    _init() {
        if (!this.container) return;
        
        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.options.width;
        this.canvas.height = this.options.height;
        this.canvas.style.display = 'block';
        
        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);
        
        // Draw initial empty chart
        this.draw();
    }
    
    /**
     * Update chart with new data point
     */
    update(count) {
        const now = Date.now();
        this.data.push({ timestamp: now, count: count });
        
        // Limit data points
        if (this.data.length > this.maxPoints) {
            this.data.shift();
        }
        
        this.draw();
    }
    
    /**
     * Draw the chart
     */
    draw() {
        if (!this.ctx) return;
        
        const { width, height, color, bgColor } = this.options;
        
        // Clear canvas
        this.ctx.clearRect(0, 0, width, height);
        
        // Draw background
        this.ctx.fillStyle = bgColor;
        this.ctx.fillRect(0, 0, width, height);
        
        if (this.data.length < 2) return;
        
        // Calculate min/max for scaling
        const counts = this.data.map(d => d.count);
        const minCount = Math.min(...counts);
        const maxCount = Math.max(...counts);
        const range = maxCount - minCount || 1;
        
        // Draw line
        this.ctx.beginPath();
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.lineJoin = 'round';
        
        this.data.forEach((point, i) => {
            const x = (i / (this.data.length - 1)) * width;
            const y = height - ((point.count - minCount) / range) * (height - 4) - 2;
            
            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        });
        
        this.ctx.stroke();
        
        // Draw fill gradient
        const gradient = this.ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, `${color}40`);
        gradient.addColorStop(1, `${color}00`);
        
        this.ctx.lineTo(width, height);
        this.ctx.lineTo(0, height);
        this.ctx.closePath();
        this.ctx.fillStyle = gradient;
        this.ctx.fill();
        
        // Draw current value
        if (this.data.length > 0) {
            const latest = this.data[this.data.length - 1];
            this.ctx.fillStyle = color;
            this.ctx.font = 'bold 11px monospace';
            this.ctx.textAlign = 'right';
            this.ctx.fillText(latest.count.toString(), width - 2, height - 4);
        }
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.RustChainWebSocket = RustChainWebSocket;
    window.MinerCountChart = MinerCountChart;
}