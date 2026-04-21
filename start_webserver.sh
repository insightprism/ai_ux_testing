#!/bin/bash

# Start the AI UX Testing recipe-builder web server (Express).

AI_UX_PORT=${AI_UX_PORT:-11111}

echo "Starting AI UX Testing Web Server"
echo "Port: $AI_UX_PORT"
echo "URL:  http://localhost:$AI_UX_PORT"
echo ""

cleanup() {
    echo ""
    echo "Shutting down web server..."
    exit
}
trap cleanup EXIT

# Check if port is available
if lsof -Pi :$AI_UX_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Port $AI_UX_PORT is already in use"
    echo "Current processes on port $AI_UX_PORT:"
    lsof -Pi :$AI_UX_PORT -sTCP:LISTEN
    echo ""
    read -p "Kill existing processes? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Killing processes on port $AI_UX_PORT..."
        kill -9 $(lsof -Pi :$AI_UX_PORT -sTCP:LISTEN -t) 2>/dev/null
        sleep 2
        echo "Port cleared"
    else
        echo "Cannot start - port is busy"
        exit 1
    fi
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Install deps if missing
if [ ! -d "node_modules" ]; then
    echo "node_modules not found — running npm install..."
    npm install --no-audit --no-fund || { echo "npm install failed"; exit 1; }
fi

echo "Starting Express server..."
echo ""

PORT=$AI_UX_PORT node ux_testing/web/server/server.js

echo ""
echo "Web server stopped"
