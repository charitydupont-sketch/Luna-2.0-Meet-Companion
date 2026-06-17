#!/bin/bash

MEET_URL=$1

if [ -z "$MEET_URL" ]; then
    echo "Usage: ./run_luna_meet.sh <google-meet-url>"
    exit 1
fi

# Strip any existing authuser parameter to allow guest join
MEET_URL=$(echo "$MEET_URL" | sed -E 's/([&?])authuser=[^&]*&?/\1/g' | sed -E 's/\?$//' | sed -E 's/&$//')


# Strip any existing luna parameter and force luna=true for extension bot-mode activation
MEET_URL=$(echo "$MEET_URL" | sed -E 's/([&?])luna=[^&]*&?/\1/g' | sed -E 's/\?$//' | sed -E 's/&$//')
if [[ "$MEET_URL" == *"?"* ]]; then
    MEET_URL="${MEET_URL}&luna=true"
else
    MEET_URL="${MEET_URL}?luna=true"
fi

echo "Launching Google Chrome with Luna 2.0 Extension..."
echo "Target Meet URL: $MEET_URL"

# macOS Google Chrome path
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Place profile inside the home folder to inherit permissions and avoid lock conflicts
PROFILE_DIR="/Users/charitydupont/LunaMeetProfile"

# Clear previous session data safely (disabled to persist logged-in Google account cookies)
# rm -rf "$PROFILE_DIR"
mkdir -p "$PROFILE_DIR"


# Start Google Chrome forcing a new isolated instance on macOS
open -n -a "Google Chrome" --args --user-data-dir="$PROFILE_DIR" --load-extension="/Users/charitydupont/Desktop/Luna 2.0 Meet Companion/meet-extension" --use-fake-ui-for-media-stream --use-fake-device-for-media-stream --remote-debugging-port=9223 --allow-insecure-localhost --ignore-certificate-errors --autoplay-policy=no-user-gesture-required "$MEET_URL"




