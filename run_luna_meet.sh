#!/bin/bash

MEET_URL=$1

if [ -z "$MEET_URL" ]; then
    echo "Usage: ./run_luna_meet.sh <google-meet-url>"
    exit 1
fi

echo "Launching Google Chrome with Luna 2.0 Extension..."
echo "Target Meet URL: $MEET_URL"

# macOS Google Chrome path
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Start Google Chrome
"$CHROME_PATH" \
  --user-data-dir="/tmp/luna_chrome_meet_profile" \
  --load-extension="/Users/charitydupont/.gemini/jetski/scratch/agent-live/meet-extension" \
  --no-first-run \
  --disable-blink-features=AutomationControlled \
  "$MEET_URL"
