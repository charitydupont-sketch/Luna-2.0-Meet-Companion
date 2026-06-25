#!/bin/bash
# GCE VM Auto-Deploy Script for Luna 2.0 Meet Companion (Ubuntu 22.04 LTS)

echo "========================================="
echo "  Deploying Luna 2.0 on Google Cloud VM   "
echo "========================================="

# 1. Update Packages
echo "Updating packages..."
sudo apt-get update && sudo apt-get upgrade -y

# 2. Install Node.js 18
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install Python 3 and Pip
echo "Installing Python and dependencies..."
sudo apt-get install -y python3 python3-pip

# 4. Install Google Chrome and virtual display/audio drivers
echo "Installing Google Chrome and Xvfb..."
sudo apt-get install -y wget curl gnupg ca-certificates apt-transport-https software-properties-common
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
sudo sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list'
sudo apt-get update
sudo apt-get install -y google-chrome-stable xvfb pulseaudio

# 5. Clone Repository
echo "Cloning your repository from GitHub..."
git clone https://github.com/charitydupont-sketch/Luna-2.0-Meet-Companion.git
cd Luna-2.0-Meet-Companion

# 6. Install requirements
echo "Installing python packages..."
pip3 install -r requirements.txt

# 7. Configure port forwarding (map port 80 to 8000)
# This allows people to visit the VM external IP address directly without adding ':8000'
echo "Configuring port forwarding..."
sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8000

echo "========================================="
echo "Deployment Setup Complete!"
echo ""
echo "Step 1: Authenticate Google Cloud on this VM by running:"
echo "  gcloud auth application-default login"
echo ""
echo "Step 2: Start Luna in virtual display mode by running:"
echo "  Xvfb :99 -screen 0 1280x800x24 & export DISPLAY=:99 && node server.js"
echo ""
echo "You can then access Luna via the VM's External IP Address!"
echo "========================================="
