# Use a lightweight Debian-based Python image
FROM python:3.10-slim-bullseye

# Install Node.js
RUN apt-get update && apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs

# Install Chrome and virtual frame buffer/audio dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    apt-transport-https \
    software-properties-common \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    xvfb \
    pulseaudio \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy python requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all application files
COPY . .

# Expose server port
EXPOSE 8000

# Set environment variables for virtual display and audio
ENV DISPLAY=:99
ENV PULSE_SERVER=unix:/tmp/pulse-socket

# Entrypoint script to start virtual audio/display and launch server
CMD Xvfb :99 -screen 0 1280x800x24 & \
    pulseaudio --start --exit-idle-time=-1 & \
    node server.js
