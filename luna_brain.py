import urllib.request
import urllib.error
import json
import subprocess
import ssl
import time

def get_access_token():
    try:
        return subprocess.check_output(["gcloud", "auth", "application-default", "print-access-token"]).decode("utf-8").strip()
    except Exception as e:
        print(f"[Luna Brain Error] Failed to get OAuth token: {e}")
        return None

def generate_response(prompt):
    token = get_access_token()
    if not token:
        return None
        
    project_id = "gdm-inception"
    url = f"https://us-central1-aiplatform.googleapis.com/v1/projects/{project_id}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent"
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    body = {
        "contents": {
            "role": "user",
            "parts": {
                "text": prompt
            }
        },
        "generationConfig": {
            "maxOutputTokens": 1024,
            "temperature": 0.7
        }
    }
    
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST"
    )
    
    context = ssl._create_unverified_context()
    
    try:
        with urllib.request.urlopen(req, context=context) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            text = res_data["candidates"][0]["content"]["parts"][0]["text"]
            return text.strip()
    except urllib.error.HTTPError as e:
        print(f"[Luna Brain Error] HTTP Error {e.code}: {e.read().decode('utf-8')}")
    except Exception as e:
        print(f"[Luna Brain Error] Exception: {e}")
    return None

def post_to_meet(payload):
    try:
        url = "http://127.0.0.1:8000/api/events/to-meet"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req) as response:
            pass
    except Exception as e:
        print(f"[Luna Brain Error] Failed to post to Meet: {e}")

def main_loop():
    print("[Luna Brain] Active and polling for events...")
    
    while True:
        try:
            # Poll events from hub
            url = "http://127.0.0.1:8000/api/events/poll-hub"
            req = urllib.request.Request(url, method="GET")
            
            with urllib.request.urlopen(req) as response:
                events = json.loads(response.read().decode("utf-8"))
                
                for event in events:
                    if not event:
                        continue
                    
                    evt_type = event.get("type")
                    if evt_type in ("MEET_CHAT", "MEET_CAPTION"):
                        sender = event.get("sender", "Participant")
                        text = event.get("text", "")
                        
                        # Ignore own messages
                        if sender in ("Luna 2.0", "luna", "You"):
                            continue
                            
                        # If it is a spoken caption, only respond if she is mentioned
                        if evt_type == "MEET_CAPTION" and "luna" not in text.lower():
                            continue
                        
                        print(f"\n[Luna Brain] Received {evt_type} from {sender}: \"{text}\"")
                        
                        # Set state to thinking
                        post_to_meet({"state": "thinking"})
                        
                        # Generate Gemini prompt
                        prompt = (
                            "You are Luna 2.0, a friendly, intelligent AI companion participating in a Google Meet call. "
                            "You are talking directly to the participants. Respond to the message below. "
                            "Keep your response natural, short, and friendly (1 to 2 sentences max). Do not use markdown bold/italics or other markup.\n\n"
                            f"Participant {sender} says: \"{text}\"\n"
                            "Luna 2.0:"
                        )
                        
                        reply = generate_response(prompt)
                        if reply:
                            print(f"[Luna Brain] Replying to {sender}: \"{reply}\"")
                            # Send speaking state and text
                            post_to_meet({
                                "state": "speaking",
                                "text": reply
                            })
                            
                            # Estimate duration to speak the text (approx 150 words per minute -> 2.5 words per second)
                            word_count = len(reply.split())
                            sleep_duration = max(3.0, word_count / 2.5)
                            time.sleep(sleep_duration)
                            
                            # Set back to idle
                            post_to_meet({"state": "idle"})
                        else:
                            print("[Luna Brain] Failed to generate a reply.")
                            post_to_meet({"state": "idle"})
                            
        except Exception as e:
            # Silence poll errors (in case server is restarting)
            pass
            
        time.sleep(1.0)

if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        print("\n[Luna Brain] Terminated.")
