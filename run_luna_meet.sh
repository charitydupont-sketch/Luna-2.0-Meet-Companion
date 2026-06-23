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

# Clear Chrome Singleton lock files to prevent startup hangs after unclean shutdowns
rm -f "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonSocket" "$PROFILE_DIR/SingletonCookie"
mkdir -p "$PROFILE_DIR"


# Support conditional headless mode (headless by default, specify --headful to show browser window)
HEADLESS_FLAG="--headless=new"
if [ "$2" == "--headful" ]; then
    HEADLESS_FLAG=""
    echo "Running Chrome in HEADFUL (visible) mode..."
else
    echo "Running Chrome in HEADLESS (background) mode..."
fi

if [ -n "$HEADLESS_FLAG" ]; then
    # Start Google Chrome binary directly in background with bot bypass flags
    "$CHROME_PATH" --user-data-dir="$PROFILE_DIR" --load-extension="/Users/charitydupont/Desktop/Luna 2.0 Meet Companion/meet-extension" --use-fake-ui-for-media-stream --use-fake-device-for-media-stream --mute-audio --remote-debugging-port=9223 --disable-web-security --allow-insecure-localhost --ignore-certificate-errors --autoplay-policy=no-user-gesture-required --no-first-run --no-default-browser-check --window-size=1280,800 --disable-blink-features=AutomationControlled --user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36" "$HEADLESS_FLAG" "$MEET_URL" > /tmp/luna_chrome_headless.log 2>&1 &
else
    # Start Google Chrome forcing a new isolated instance on macOS
    open -n -a "Google Chrome" --args --user-data-dir="$PROFILE_DIR" --load-extension="/Users/charitydupont/Desktop/Luna 2.0 Meet Companion/meet-extension" --use-fake-ui-for-media-stream --use-fake-device-for-media-stream --remote-debugging-port=9223 --disable-web-security --allow-insecure-localhost --ignore-certificate-errors --autoplay-policy=no-user-gesture-required --no-first-run --no-default-browser-check --window-size=1280,800 --disable-blink-features=AutomationControlled --user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36" "$MEET_URL"
fi

# Launch the CDP Script Injector Daemon in the background
echo "Launching CDP Script Injector Daemon..."
python3 -u "/Users/charitydupont/Desktop/Luna 2.0 Meet Companion/luna_cdp_agent.py" > /tmp/luna_cdp_agent.log 2>&1 &

# Launch the Gemini Brain Daemon in the background
echo "Launching Gemini Brain Daemon..."
python3 -u "/Users/charitydupont/Desktop/Luna 2.0 Meet Companion/luna_brain.py" > /tmp/luna_brain.log 2>&1 &




