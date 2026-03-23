"""
RustChain Explorer WebSocket Server
Bounty #2295: Block Explorer WebSocket

Features:
- Real-time block push (new_block events)
- Real-time attestation push (attestation events)
- Connection status tracking
- Auto-reconnect support
- Epoch settlement notifications
- Miner count updates

Author: HuiNeng
Wallet: 9dRRMiHiJwjF3VW8pXtKDtpmmxAPFy3zWgV2JY5H6eeT
"""

import os
import sys
import json
import time
import ssl
import threading
import urllib.request
import urllib.error
from datetime import datetime
from typing import Optional, Dict, Any, List, Set
from dataclasses import dataclass, field
from flask import Flask, Blueprint, jsonify, request
from flask_socketio import SocketIO, emit, join_room, leave_room

# ─── Configuration ─────────────────────────────────────────────────────────── #

NODE_URL = os.environ.get("RUSTCHAIN_NODE_URL", "https://rustchain.org")
WS_PORT = int(os.environ.get("WS_PORT", "5001"))
POLL_INTERVAL = int(os.environ.get("WS_POLL_INTERVAL", "5"))
HEARTBEAT_INTERVAL = 30
MAX_CLIENTS = 1000

# SSL context for HTTPS requests
SSL_CONTEXT = ssl._create_unverified_context()

# ─── Data Classes ─────────────────────────────────────────────────────────── #

@dataclass
class Block:
    """Represents a block in the chain."""
    height: int
    hash: str
    timestamp: int
    miners_count: int = 0
    reward: float = 0.0

@dataclass
class Attestation:
    """Represents a miner attestation."""
    miner_id: str
    wallet: str
    architecture: str
    multiplier: float
    timestamp: int
    tier: str = "modern"

@dataclass
class EpochInfo:
    """Represents current epoch information."""
    epoch: int
    slot: int
    pot: float
    blocks_per_epoch: int = 144
    miners_count: int = 0

@dataclass
class ClientState:
    """Tracks client connection state."""
    sid: str
    connected_at: float
    subscriptions: Set[str] = field(default_factory=set)
    last_heartbeat: float = 0.0

# ─── State Manager ────────────────────────────────────────────────────────── #

class StateManager:
    """Manages blockchain state and tracks changes."""
    
    def __init__(self):
        self._lock = threading.RLock()
        
        # Current state
        self.current_epoch: Optional[EpochInfo] = None
        self.last_block: Optional[Block] = None
        self.miners: Dict[str, dict] = {}  # wallet -> miner data
        self.miner_count_history: List[dict] = []  # For mini chart
        
        # Track seen items
        self._seen_blocks: Set[int] = set()
        self._last_attestations: Dict[str, int] = {}  # wallet -> timestamp
        
        # Statistics
        self.total_blocks_pushed = 0
        self.total_attestations_pushed = 0
        self.total_epoch_settlements = 0
    
    def update_epoch(self, data: dict) -> Optional[dict]:
        """Update epoch state and detect settlements."""
        with self._lock:
            new_epoch = data.get("epoch", 0)
            new_slot = data.get("slot") or data.get("epoch_slot", 0)
            pot = data.get("pot") or data.get("pot_rtc") or data.get("reward_pot", 0)
            
            old_epoch = self.current_epoch.epoch if self.current_epoch else None
            
            # Update current epoch
            self.current_epoch = EpochInfo(
                epoch=new_epoch,
                slot=new_slot,
                pot=float(pot),
                blocks_per_epoch=data.get("blocks_per_epoch", 144),
                miners_count=len(self.miners)
            )
            
            # Detect epoch settlement
            if old_epoch is not None and new_epoch > old_epoch:
                self.total_epoch_settlements += 1
                return {
                    "type": "epoch_settlement",
                    "data": {
                        "old_epoch": old_epoch,
                        "new_epoch": new_epoch,
                        "pot": float(pot),
                        "miners_count": len(self.miners),
                        "timestamp": int(time.time())
                    }
                }
            
            return None
    
    def update_block(self, data: dict) -> Optional[dict]:
        """Update block state and detect new blocks."""
        with self._lock:
            height = data.get("height") or data.get("slot", 0)
            
            if height in self._seen_blocks:
                return None
            
            self._seen_blocks.add(height)
            
            # Limit seen blocks cache
            if len(self._seen_blocks) > 1000:
                self._seen_blocks = set(list(self._seen_blocks)[-500:])
            
            block = Block(
                height=height,
                hash=data.get("hash", ""),
                timestamp=data.get("timestamp", int(time.time())),
                miners_count=data.get("miners_count", 0),
                reward=data.get("reward", 0)
            )
            
            self.last_block = block
            self.total_blocks_pushed += 1
            
            return {
                "type": "new_block",
                "data": {
                    "height": block.height,
                    "hash": block.hash,
                    "timestamp": block.timestamp,
                    "miners_count": block.miners_count,
                    "reward": block.reward
                }
            }
    
    def update_miners(self, miners: List[dict]) -> List[dict]:
        """Update miners state and detect new attestations."""
        with self._lock:
            events = []
            
            for miner in miners:
                wallet = miner.get("wallet") or miner.get("wallet_name", "")
                if not wallet:
                    continue
                
                attest_time = miner.get("last_attestation_time") or miner.get("last_attest", 0)
                if isinstance(attest_time, str):
                    try:
                        attest_time = int(attest_time)
                    except:
                        attest_time = 0
                
                # Check if this is a new attestation
                old_time = self._last_attestations.get(wallet, 0)
                if attest_time and attest_time > old_time:
                    self._last_attestations[wallet] = attest_time
                    self.total_attestations_pushed += 1
                    
                    arch = miner.get("device_arch") or miner.get("hardware_type") or miner.get("arch", "unknown")
                    
                    events.append({
                        "type": "attestation",
                        "data": {
                            "miner_id": miner.get("miner_id", ""),
                            "wallet": wallet,
                            "architecture": arch,
                            "multiplier": float(miner.get("multiplier") or miner.get("rtc_multiplier", 1.0)),
                            "timestamp": attest_time,
                            "tier": self._get_tier(arch)
                        }
                    })
                
                # Update miner data
                self.miners[wallet] = miner
            
            # Update miner count history for mini chart
            self._update_miner_history()
            
            return events
    
    def _get_tier(self, arch: str) -> str:
        """Determine architecture tier."""
        if not arch:
            return "modern"
        arch_lower = arch.lower()
        if any(x in arch_lower for x in ["g3", "g4", "g5", "powerpc", "ppc"]):
            return "vintage"
        if any(x in arch_lower for x in ["sparc", "mips", "alpha"]):
            return "ancient"
        if any(x in arch_lower for x in ["pentium", "486", "386"]):
            return "retro"
        return "modern"
    
    def _update_miner_history(self):
        """Update miner count history for mini chart."""
        now = int(time.time())
        count = len(self.miners)
        
        # Keep last 24 hours of data points (one per minute max)
        self.miner_count_history.append({
            "timestamp": now,
            "count": count
        })
        
        # Keep only last 1440 data points (24 hours)
        if len(self.miner_count_history) > 1440:
            self.miner_count_history = self.miner_count_history[-1440:]
    
    def get_status(self) -> dict:
        """Get current status."""
        with self._lock:
            return {
                "connected": True,
                "node_url": NODE_URL,
                "current_epoch": self.current_epoch.epoch if self.current_epoch else 0,
                "current_slot": self.current_epoch.slot if self.current_epoch else 0,
                "active_miners": len(self.miners),
                "last_block_height": self.last_block.height if self.last_block else 0,
                "stats": {
                    "blocks_pushed": self.total_blocks_pushed,
                    "attestations_pushed": self.total_attestations_pushed,
                    "epoch_settlements": self.total_epoch_settlements
                },
                "miner_history": self.miner_count_history[-60:] if self.miner_count_history else []
            }


# ─── API Client ─────────────────────────────────────────────────────────── #

class APIClient:
    """Client for fetching data from RustChain node."""
    
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
    
    def fetch(self, endpoint: str) -> Optional[Any]:
        """Fetch data from API endpoint."""
        url = f"{self.base_url}{endpoint}"
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "RustChain-WS/1.0"}
            )
            with urllib.request.urlopen(req, timeout=10, context=SSL_CONTEXT) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as e:
            print(f"[WS] URL error fetching {endpoint}: {e}")
            return None
        except json.JSONDecodeError as e:
            print(f"[WS] JSON error fetching {endpoint}: {e}")
            return None
        except Exception as e:
            print(f"[WS] Error fetching {endpoint}: {e}")
            return None
    
    def get_epoch(self) -> Optional[dict]:
        """Get current epoch info."""
        return self.fetch("/epoch")
    
    def get_miners(self) -> List[dict]:
        """Get active miners."""
        data = self.fetch("/api/miners")
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("miners", [])
        return []
    
    def get_health(self) -> Optional[dict]:
        """Get node health."""
        return self.fetch("/health")


# ─── WebSocket Server ────────────────────────────────────────────────────── #

class WebSocketServer:
    """WebSocket server for real-time updates."""
    
    def __init__(self, app: Flask):
        self.app = app
        self.state = StateManager()
        self.api = APIClient(NODE_URL)
        
        # Client tracking
        self.clients: Dict[str, ClientState] = {}
        self.clients_lock = threading.Lock()
        
        # Initialize SocketIO
        self.socketio = SocketIO(
            app,
            cors_allowed_origins="*",
            async_mode="threading",
            ping_timeout=60,
            ping_interval=25,
            max_http_buffer_size=1024 * 128
        )
        
        # Register event handlers
        self._register_handlers()
        
        # Start background poller
        self._start_poller()
    
    def _register_handlers(self):
        """Register SocketIO event handlers."""
        
        @self.socketio.on("connect", namespace="/ws")
        def on_connect():
            sid = request.sid
            with self.clients_lock:
                self.clients[sid] = ClientState(
                    sid=sid,
                    connected_at=time.time(),
                    subscriptions={"new_block", "attestation", "epoch_settlement"}
                )
            
            print(f"[WS] Client connected: {sid}")
            
            # Send initial status
            emit("connected", {
                "status": "ok",
                "node_url": NODE_URL,
                "server_time": int(time.time()),
                "heartbeat_interval": HEARTBEAT_INTERVAL
            })
            
            # Send current state
            status = self.state.get_status()
            emit("status", status)
        
        @self.socketio.on("disconnect", namespace="/ws")
        def on_disconnect():
            sid = request.sid
            with self.clients_lock:
                self.clients.pop(sid, None)
            print(f"[WS] Client disconnected: {sid}")
        
        @self.socketio.on("subscribe", namespace="/ws")
        def on_subscribe(data):
            sid = request.sid
            event_types = data.get("types", []) if isinstance(data, dict) else []
            
            with self.clients_lock:
                if sid in self.clients:
                    self.clients[sid].subscriptions = set(event_types) if event_types else {
                        "new_block", "attestation", "epoch_settlement"
                    }
            
            emit("subscribed", {"types": list(self.clients[sid].subscriptions) if sid in self.clients else []})
        
        @self.socketio.on("ping", namespace="/ws")
        def on_ping():
            emit("pong", {"ts": int(time.time() * 1000)})
        
        @self.socketio.on("get_status", namespace="/ws")
        def on_get_status():
            status = self.state.get_status()
            status["connected_clients"] = len(self.clients)
            emit("status", status)
    
    def _start_poller(self):
        """Start background polling thread."""
        def poll_loop():
            print(f"[WS] Starting poller (interval: {POLL_INTERVAL}s)")
            while True:
                try:
                    self._poll()
                except Exception as e:
                    print(f"[WS] Poller error: {e}")
                time.sleep(POLL_INTERVAL)
        
        thread = threading.Thread(target=poll_loop, daemon=True)
        thread.start()
    
    def _poll(self):
        """Poll node for updates."""
        # Fetch epoch data
        epoch_data = self.api.get_epoch()
        if epoch_data:
            # Check for epoch settlement
            settlement_event = self.state.update_epoch(epoch_data)
            if settlement_event:
                self._broadcast(settlement_event)
            
            # Check for new blocks (slots)
            slot = epoch_data.get("slot") or epoch_data.get("epoch_slot")
            if slot:
                block_event = self.state.update_block({
                    "height": slot,
                    "hash": epoch_data.get("last_block_hash", ""),
                    "timestamp": int(time.time()),
                    "miners_count": 0,
                    "reward": epoch_data.get("pot_rtc", 0)
                })
                if block_event:
                    self._broadcast(block_event)
        
        # Fetch miners
        miners = self.api.get_miners()
        if miners:
            attestation_events = self.state.update_miners(miners)
            for event in attestation_events:
                self._broadcast(event)
    
    def _broadcast(self, event: dict):
        """Broadcast event to subscribed clients."""
        event_type = event.get("type")
        if not event_type:
            return
        
        with self.clients_lock:
            for sid, client in list(self.clients.items()):
                if event_type in client.subscriptions:
                    try:
                        self.socketio.emit("event", event, namespace="/ws", to=sid)
                    except Exception as e:
                        print(f"[WS] Error sending to {sid}: {e}")
    
    def get_client_count(self) -> int:
        """Get number of connected clients."""
        with self.clients_lock:
            return len(self.clients)
    
    def run(self, host: str = "0.0.0.0", port: int = WS_PORT):
        """Run the WebSocket server."""
        print(f"[WS] Starting RustChain WebSocket Server")
        print(f"[WS] Node URL: {NODE_URL}")
        print(f"[WS] Port: {port}")
        print(f"[WS] Poll Interval: {POLL_INTERVAL}s")
        print(f"[WS] Endpoint: ws://localhost:{port}/ws")
        print()
        print("[WS] Events:")
        print("  - new_block: Real-time block updates")
        print("  - attestation: New miner attestations")
        print("  - epoch_settlement: Epoch settlement notifications")
        print()
        
        self.socketio.run(self.app, host=host, port=port, debug=False)


# ─── Flask App Setup ─────────────────────────────────────────────────────── #

def create_app() -> Flask:
    """Create Flask application."""
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "rustchain-ws-secret")
    
    # Health check endpoint
    @app.route("/health")
    def health():
        return jsonify({
            "status": "ok",
            "service": "rustchain-websocket",
            "version": "1.0.0"
        })
    
    # Status endpoint
    @app.route("/status")
    def status():
        return jsonify({
            "websocket": "/ws",
            "events": ["new_block", "attestation", "epoch_settlement"],
            "node_url": NODE_URL
        })
    
    return app


# ─── Main Entry Point ────────────────────────────────────────────────────── #

if __name__ == "__main__":
    app = create_app()
    server = WebSocketServer(app)
    server.run()