# Dockerfile for RustChain WebSocket Server
# Bounty #2295: Block Explorer WebSocket

FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY explorer/websocket-requirements.txt .
RUN pip install --no-cache-dir -r websocket-requirements.txt

# Copy server code
COPY explorer/websocket_server.py .

# Expose WebSocket port
EXPOSE 5001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=10s \
    CMD curl -f http://localhost:5001/health || exit 1

# Run server
CMD ["python", "websocket_server.py"]