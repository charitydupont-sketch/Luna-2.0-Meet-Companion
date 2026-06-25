#!/bin/bash

# Setup script for Luna 2.0 Meet Companion
# This script installs local dependencies and verifies the environment.

echo "========================================="
echo "  Luna 2.0 Meet Companion - Local Setup  "
echo "========================================="

# Helper function to check command existence
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 1. Check Python 3
if command_exists python3; then
    PYTHON_VERSION=$(python3 -V 2>&1 | awk '{print $2}')
    echo "[✓] Python 3 is installed (Version: $PYTHON_VERSION)"
else
    echo "[✗] Python 3 is missing. Please download it from https://www.python.org/downloads/"
    exit 1
fi

# 2. Check Node.js
if command_exists node; then
    NODE_VERSION=$(node -v)
    echo "[✓] Node.js is installed (Version: $NODE_VERSION)"
else
    echo "[✗] Node.js is missing. Please download it from https://nodejs.org/"
    exit 1
fi

# 3. Check Google Chrome
if [ "$(uname)" == "Darwin" ]; then
    # macOS Chrome path check
    if [ -d "/Applications/Google Chrome.app" ]; then
        echo "[✓] Google Chrome is installed"
    else
        echo "[✗] Google Chrome was not found in /Applications. Please install Google Chrome."
        exit 1
    fi
else
    # Linux Chrome check
    if command_exists google-chrome || command_exists google-chrome-stable; then
        echo "[✓] Google Chrome is installed"
    else
        echo "[✗] Google Chrome is missing. Please install it using your system package manager."
        exit 1
    fi
fi

# 4. Install Python Dependencies
echo "Installing Python dependencies..."
python3 -m pip install -r requirements.txt
if [ $? -eq 0 ]; then
    echo "[✓] Python dependencies installed successfully"
else
    echo "[✗] Failed to install Python dependencies. Please run 'pip3 install websockets' manually."
fi

# 5. Check Vertex AI Authentication (gcloud)
if command_exists gcloud; then
    echo "[✓] Google Cloud SDK (gcloud) is installed"
    echo "    Make sure you have logged in by running: gcloud auth application-default login"
else
    echo "[!] Google Cloud SDK (gcloud) is missing."
    echo "    To authorize Luna's Gemini Brain to Vertex AI, please install gcloud from: https://cloud.google.com/sdk"
fi

echo "========================================="
echo "Setup Complete! To start Luna, run:"
echo "  node server.js"
echo "Then open http://localhost:8000 in your browser."
echo "========================================="
