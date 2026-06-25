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

def check_hardcoded_queries(text):
    normalized = text.lower()
    
    # Define keywords for actions and targets related to creation
    creator_actions = ["create", "created", "creating", "creator", "make", "made", "maker", "built", "build", "designed", "design", "developer", "developers", "developed"]
    creator_targets = ["you", "joe", "luna", "your"]
    
    has_action = any(act in normalized for act in creator_actions)
    has_target = any(tgt in normalized for tgt in creator_targets)
    
    # Check if the query is a "who/what" question inquiring about creation
    if has_action and has_target:
        if any(w in normalized for w in ["who", "what", "tell me", "know"]):
            return "Charity, a UX designer at Google DeepMind, is the one who created me."
            
    # Also support origin questions ("where are you from", "where were you made")
    if "where" in normalized and any(tgt in normalized for tgt in creator_targets):
        if any(w in normalized for w in ["from", "made", "born", "come"]):
            return "I was created by Charity, a UX designer at Google DeepMind."
            
    return None

def main_loop():
    print("[Luna Brain] Active and polling for events...")
    
    speaking_ends_at = 0.0
    is_speaking = False
    conversation_history = []
    session_active = False
    session_expires_at = 0.0
    
    while True:
        try:
            # Check if speaking duration elapsed
            if is_speaking and time.time() > speaking_ends_at:
                post_to_meet({"state": "idle"})
                is_speaking = False

            # Poll events from hub
            url = "http://127.0.0.1:8000/api/events/poll-hub"
            req = urllib.request.Request(url, method="GET")
            
            with urllib.request.urlopen(req) as response:
                events = json.loads(response.read().decode("utf-8"))
                
                for event in events:
                    if not event:
                        continue
                    
                    evt_type = event.get("type")
                    if evt_type == "LUNA_INTERRUPTED":
                        if is_speaking:
                            print("[Luna Brain] Interrupted by local client event. Aborting speaking state.")
                            is_speaking = False
                        continue
                        
                    if evt_type in ("MEET_CHAT", "MEET_CAPTION"):
                        sender = event.get("sender", "Participant")
                        text = event.get("text", "")
                        
                        # Ignore own messages
                        if sender in ("Luna 2.0", "luna", "You"):
                            continue
                            
                        # Add to conversation history
                        conversation_history.append({"sender": sender, "text": text})
                        if len(conversation_history) > 20:
                            conversation_history.pop(0)

                        # Determine if we should respond
                        is_mention = any(m in text.lower() for m in ["luna", "loona", "lunar"])
                        is_session_active = session_active and time.time() < session_expires_at
                        
                        should_respond = is_mention or (evt_type == "MEET_CHAT") or (evt_type == "MEET_CAPTION" and is_session_active)
                        
                        if not should_respond:
                            continue
                        
                        print(f"\n[Luna Brain] Received {evt_type} from {sender}: \"{text}\" (Session active: {is_session_active})")
                        
                        # Interrupt any ongoing speaking state instantly
                        if is_speaking:
                            print("[Luna Brain] Interrupted by new incoming message. Aborting speech playback.")
                            post_to_meet({"cancel": True})
                            is_speaking = False

                        # Set state to thinking
                        post_to_meet({"state": "thinking"})
                        
                        # Build history transcript block for the prompt
                        history_text = ""
                        for turn in conversation_history:
                            history_text += f"{turn['sender']}: {turn['text']}\n"

                        # Check for pure mention/wake-up trigger
                        first_name = sender.split()[0] if sender else "there"
                        clean_text = text.strip().lower().replace("?", "").replace(".", "").replace(",", "")
                        is_pure_mention = clean_text in ["luna", "hey luna", "hi luna", "loona", "lunar"]
                        
                        if is_pure_mention:
                            reply = f"Yes, {first_name}?"
                            action = None
                        elif hardcoded_reply:
                            reply = hardcoded_reply
                            action = None
                        else:
                            # Generate Gemini prompt
                            prompt = (
                                "You are Luna 2.0, a friendly, intelligent AI companion participating in a Google Meet call. "
                                "You are talking directly to the participants. Below is the transcript of the conversation so far.\n\n"
                                "Transcript:\n"
                                f"{history_text}\n"
                                "Respond to the last message, keeping the conversation context in mind.\n\n"
                                "You MUST respond in a valid JSON format with the following keys:\n"
                                "1. \"reply\": A natural, short, and friendly text response (1 to 2 sentences max, no markdown/markup) to be spoken. You can occasionally ask a brief, natural follow-up question to keep the conversation flowing.\n"
                                "2. \"action\": An optional object if the user explicitly requests showing, switching, building, or rendering a template/prototype in the sandbox. If they request the calculator, set this to {\"type\": \"SANDBOX_ACTION\", \"template\": \"calculator\"}. If they request a landing page or website, set this to {\"type\": \"SANDBOX_ACTION\", \"template\": \"landing\"}. Otherwise, set this to null.\n\n"
                                "Ensure your entire output is a single valid JSON block, with no other text around it."
                            )
                            
                            reply_json = generate_response(prompt)
                            if reply_json:
                                try:
                                    # Clean up markdown block formatting if present
                                    clean_json = reply_json.strip()
                                    if clean_json.startswith("```"):
                                        clean_json = clean_json.split("\n", 1)[1]
                                        if clean_json.endswith("```"):
                                            clean_json = clean_json.rsplit("\n", 1)[0]
                                    clean_json = clean_json.strip()
                                    
                                    response_data = json.loads(clean_json)
                                    reply = response_data.get("reply", "")
                                    action = response_data.get("action")
                                except Exception as e:
                                    print(f"[Luna Brain Error] Failed to parse JSON response: {e}. Raw response: {reply_json}")
                                    # Fallback to raw text if model failed to output valid JSON
                                    reply = reply_json
                                    action = None
                            else:
                                print("[Luna Brain] Failed to generate a reply from Gemini.")

                        if reply:
                            print(f"[Luna Brain] Replying to {sender}: \"{reply}\"")
                            # Add Luna's own reply to history
                            conversation_history.append({"sender": "Luna 2.0", "text": reply})
                            if len(conversation_history) > 20:
                                conversation_history.pop(0)

                            # Send speaking state and text
                            post_to_meet({
                                "state": "speaking",
                                "text": reply
                            })
                            
                            # Send sandbox action if requested by AI
                            if action:
                                print(f"[Luna Brain] AI triggered sandbox action: {action}")
                                post_to_meet(action)
                            
                            # Estimate duration to speak the text (approx 150 words per minute -> 2.5 words per second)
                            word_count = len(reply.split())
                            sleep_duration = max(3.0, word_count / 2.5)
                            speaking_ends_at = time.time() + sleep_duration
                            is_speaking = True
                            
                            # Update session variables
                            session_active = True
                            session_expires_at = speaking_ends_at + 10.0
                        else:
                            post_to_meet({"state": "idle"})
                            
        except Exception as e:
            # Silence poll errors (in case server is restarting)
            pass
            
        time.sleep(0.2)

if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        print("\n[Luna Brain] Terminated.")
