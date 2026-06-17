import urllib.request
import urllib.parse
import json
import subprocess
import ssl
import time
import datetime
import sys

LUNA_EMAIL = "l08483088@gmail.com"
POLL_INTERVAL = 30  # Poll every 30 seconds
LOOKAHEAD_MINUTES = 5
LOOKBACK_MINUTES = 5

joined_events = set()

def get_access_token():
    try:
        # Obtain user's gcloud authenticated application default credentials access token
        return subprocess.check_output(["gcloud", "auth", "application-default", "print-access-token"]).decode("utf-8").strip()
    except Exception as e:
        print(f"[Calendar Poller Error] Failed to get OAuth token: {e}", file=sys.stderr)
        return None

def poll_calendar():
    token = get_access_token()
    if not token:
        return

    # Calculate UTC time window
    now = datetime.datetime.now(datetime.UTC)
    time_min = (now - datetime.timedelta(minutes=LOOKBACK_MINUTES)).isoformat()
    time_max = (now + datetime.timedelta(minutes=LOOKAHEAD_MINUTES)).isoformat()

    # URL-encode query parameters
    params = urllib.parse.urlencode({
        "timeMin": time_min,
        "timeMax": time_max,
        "singleEvents": "true",
        "orderBy": "startTime"
    })
    
    url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events?{params}"
    context = ssl._create_unverified_context()
    
    # Try with billing project header first
    res_data = None
    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Goog-User-Project": "charitydupont"
        }
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, context=context) as response:
            res_data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (400, 403):
            # Fallback and try without the billing project header (required for personal Google accounts)
            try:
                headers = {
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                }
                req = urllib.request.Request(url, headers=headers, method="GET")
                with urllib.request.urlopen(req, context=context) as response:
                    res_data = json.loads(response.read().decode("utf-8"))
            except Exception as retry_err:
                print(f"[Calendar Poller Error] Retry without project header failed: {retry_err}", file=sys.stderr)
        else:
            print(f"[Calendar Poller Error] HTTP {e.code}: {e.read().decode('utf-8')}", file=sys.stderr)
    except Exception as e:
        print(f"[Calendar Poller Error] {e}", file=sys.stderr)

    if not res_data:
        return
        
    for event in res_data.get("items", []):
        event_id = event.get("id")
        summary = event.get("summary", "No Title")
        hangout_link = event.get("hangoutLink")
        
        if not hangout_link:
            continue
        
        # Check attendees
        attendees = event.get("attendees", [])
        luna_invited = any(a.get("email") == LUNA_EMAIL for a in attendees)
        
        if luna_invited and event_id not in joined_events:
            print(f"\n[Calendar Poller] Detected active meeting invite for Luna: \"{summary}\"")
            print(f"[Calendar Poller] Meet URL: {hangout_link}")
            
            # Trigger local join-meet API
            trigger_join(hangout_link)
            joined_events.add(event_id)

def trigger_join(meet_url):
    url = "http://127.0.0.1:8000/api/join-meet"
    payload = json.dumps({"url": meet_url}).encode("utf-8")
    
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            if res_data.get("success"):
                print("[Calendar Poller] Successfully triggered Luna auto-join.")
            else:
                print(f"[Calendar Poller Error] Join API failed: {res_data.get('error')}", file=sys.stderr)
    except Exception as e:
        print(f"[Calendar Poller Error] Failed to call local join API: {e}", file=sys.stderr)

def main():
    print(f"[Calendar Poller] Starting Google Calendar daemon for user primary calendar...")
    print(f"[Calendar Poller] Monitoring invites for dedicated email: {LUNA_EMAIL}")
    print(f"[Calendar Poller] Polling every {POLL_INTERVAL} seconds...")
    
    while True:
        poll_calendar()
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
