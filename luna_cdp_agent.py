import asyncio
import websockets
import json
import urllib.request
import urllib.parse
import os
import sys
import functools

print = functools.partial(print, flush=True)

pending_responses = {}


async def evaluate(websocket, expression):
    import random
    message_id = random.randint(100, 10000)
    
    loop = asyncio.get_running_loop()
    fut = loop.create_future()
    pending_responses[message_id] = fut
    
    await websocket.send(json.dumps({
        "id": message_id,
        "method": "Runtime.evaluate",
        "params": {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        }
    }))
    
    return await fut

async def read_loop(websocket):
    def log_event(msg_text):
        try:
            with open('/tmp/luna_read_loop.log', 'a') as f:
                f.write(msg_text + "\n")
        except:
            pass
        print(msg_text)

    try:
        while True:
            msg = await websocket.recv()
            evt = json.loads(msg)
            log_event(f"[CDP Debug] Event received: id={evt.get('id')}, method={evt.get('method')}, keys={list(evt.keys())}")
            
            if 'error' in evt:
                log_event(f"[CDP Error] Command {evt.get('id')} failed: {evt.get('error')}")
            
            msg_id = evt.get('id')

            if msg_id in pending_responses:
                fut = pending_responses.pop(msg_id)
                if 'result' in evt and 'result' in evt['result']:
                    val = evt['result']['result'].get('value')
                    fut.set_result(val)
                else:
                    fut.set_result(None)
            
            elif 'method' in evt:
                method = evt['method']
                if method == 'Log.entryAdded':
                    entry = evt['params']['entry']
                    log_event(f"[Meet Browser Log] {entry.get('level').upper()}: {entry.get('text')}")
                elif method == 'Runtime.consoleAPICalled':
                    params = evt['params']
                    args_text = " ".join([str(a.get('value', a.get('description', ''))) for a in params.get('args', [])])
                    if args_text.startswith("LUNA_EVENT:"):
                        event_json = args_text[len("LUNA_EVENT:"):]
                        asyncio.create_task(handle_luna_event(websocket, event_json))
                    else:
                        log_event(f"[Meet Console] {params.get('type').upper()}: {args_text}")
                elif method == 'Runtime.exceptionThrown':
                    details = evt['params']['exceptionDetails']
                    exc = details.get('exception', {})
                    log_event(f"[Meet JS Exception] {details.get('text')} {exc.get('description', exc.get('value', ''))} at {details.get('url')}:{details.get('lineNumber')}:{details.get('columnNumber')}")
    except asyncio.CancelledError:
        pass
    except Exception as e:
        log_event(f"Read Loop Exception: {e}")

def post_to_hub(evt_type, payload):
    try:
        url = 'http://127.0.0.1:8000/api/events/to-hub'
        forward_data = dict(payload)
        forward_data['type'] = evt_type
        
        data = json.dumps(forward_data).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as response:
            pass
    except Exception as e:
        print(f"[CDP Agent] Error posting event {evt_type} to hub: {e}")

def fetch_tts_data(text):
    try:
        url = f"http://127.0.0.1:8000/api/tts?text={urllib.parse.quote(text)}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as response:
            audio_bytes = response.read()
            if audio_bytes:
                import base64
                b64_data = base64.b64encode(audio_bytes).decode('utf-8')
                return f"data:audio/wav;base64,{b64_data}"
    except Exception as e:
        print(f"[CDP Agent] Error fetching TTS from hub: {e}")
    return None

def fetch_poll_events():
    try:
        url = 'http://127.0.0.1:8000/api/events/poll-meet'
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        pass
    return None

async def handle_luna_event(websocket, event_json):
    try:
        event = json.loads(event_json)
        evt_type = event.get('type')
        payload = event.get('payload', {})
        
        print(f"[CDP Agent] Captured Luna event: {evt_type}")
        
        if evt_type in ('BROWSER_LOG', 'MEET_CHAT'):
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, post_to_hub, evt_type, payload)
            
        elif evt_type == 'FETCH_TTS':
            text = payload.get('text', '')
            if text:
                loop = asyncio.get_running_loop()
                data_url = await loop.run_in_executor(None, fetch_tts_data, text)
                if data_url:
                    print(f"[CDP Agent] TTS fetched successfully ({len(data_url)} bytes). Injecting audio payload to page context...")
                    safe_url = data_url.replace("'", "\\'")
                    expr = f"window.postMessage({{ type: 'LUNA_AUDIO_DATA', dataUrl: '{safe_url}' }}, '*')"
                    await evaluate(websocket, expr)
                else:
                    print(f"[CDP Agent] TTS fetch returned empty response.")
                    safe_text = text.replace("'", "\\'")
                    expr = f"window.postMessage({{ type: 'LUNA_AUDIO_ERROR', text: '{safe_text}', error: 'Failed to fetch TTS' }}, '*')"
                    await evaluate(websocket, expr)
    except Exception as e:
        print(f"[CDP Agent] Error handling Luna event: {e}")

async def poll_meet_loop(websocket):
    print("[CDP Agent] Starting incoming events polling loop...")
    while True:
        try:
            loop = asyncio.get_running_loop()
            events = await loop.run_in_executor(None, fetch_poll_events)
            if events:
                for event in events:
                    print(f"[CDP Agent] Dispatching polled sync event to page context: {event}")
                    expr = f"window.postMessage({{ type: 'LUNA_SYNC', payload: {json.dumps(event)} }}, '*')"
                    await evaluate(websocket, expr)
        except Exception as e:
            pass
        await asyncio.sleep(0.8)


def report_active_meet(meet_url):
    try:
        url = 'http://127.0.0.1:8000/api/active-meet'
        data = json.dumps({'url': meet_url}).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as response:
            pass
        print(f"[CDP Agent] Reported active Meet URL: {meet_url}")
    except Exception as e:
        print(f"[CDP Agent] Failed to report active Meet URL: {e}")

def get_requested_meet_url():
    try:
        if os.path.exists('/tmp/luna_active_meet.json'):
            with open('/tmp/luna_active_meet.json', 'r') as f:
                data = json.load(f)
                return data.get('url')
    except Exception as e:
        print(f"[CDP Agent] Error reading active meet URL: {e}")
    return None

async def main():
    # CDP Agent main loop
    try:
        with open('/Users/charitydupont/Desktop/Luna 2.0 Meet Companion/meet-extension/orb-injector.js', 'r') as f:
            injector_code = f.read()
        with open('/Users/charitydupont/Desktop/Luna 2.0 Meet Companion/meet-extension/content.js', 'r') as f:
            content_code = f.read()
    except Exception as e:
        print(f"[CDP Agent] Error reading script files: {e}")
        return


    while True:
        try:
            print("[CDP Agent] Connecting to Chrome DevTools port 9223...")
            req = urllib.request.Request('http://127.0.0.1:9223/json')
            with urllib.request.urlopen(req) as response:
                targets = json.loads(response.read().decode())
                
            meet_target = None
            for t in targets:
                url = t.get('url', '')
                type_ = t.get('type', '')
                from urllib.parse import urlparse
                parsed = urlparse(url)
                if type_ in ('page', 'iframe') and 'meet.google.com' in parsed.netloc and 'frameType=' not in url and 'frame?' not in url:
                    meet_target = t
                    break

                    
            if not meet_target:
                requested_url = get_requested_meet_url()
                if requested_url:
                    # Find first page target
                    page_target = None
                    for t in targets:
                        if t.get('type') == 'page':
                            page_target = t
                            break
                    if page_target:
                        print(f"[CDP Agent] Navigating active target to requested Meet URL: {requested_url}")
                        ws_url = page_target['webSocketDebuggerUrl']
                        async with websockets.connect(ws_url) as websocket:
                            await websocket.send(json.dumps({"id": 1, "method": "Page.enable"}))
                            await websocket.send(json.dumps({
                                "id": 2,
                                "method": "Page.navigate",
                                "params": { "url": requested_url }
                            }))
                            await asyncio.sleep(2)
                        continue
                
                print("[CDP Agent] No Google Meet page target found. Retrying in 2 seconds...")
                await asyncio.sleep(2)
                continue

            ws_url = meet_target['webSocketDebuggerUrl']
            meet_url = meet_target['url'].split('?')[0]
            print(f"[CDP Agent] Found Meet target URL: {meet_url}")
            print(f"[CDP Agent] Connecting target WS: {ws_url}")
            
            # Report the active URL to local Node server
            report_active_meet(meet_url)
            
            async with websockets.connect(ws_url) as websocket:
                reader_task = asyncio.create_task(read_loop(websocket))
                
                # Wake up the tab if it is discarded/backgrounded
                await websocket.send(json.dumps({"id": 10, "method": "Page.bringToFront"}))
                await asyncio.sleep(2.0)
                
                # Enable Runtime, Page, Log, and Console domains
                await websocket.send(json.dumps({"id": 1, "method": "Runtime.enable"}))
                await websocket.send(json.dumps({"id": 2, "method": "Page.enable"}))
                await websocket.send(json.dumps({"id": 3, "method": "Log.enable"}))
                await websocket.send(json.dumps({"id": 4, "method": "Console.enable"}))

                
                # Programmatically inject the WebRTC override code via CDP (bypasses enterprise CSP and extension blocks)
                print("[CDP Agent] Registering orb-injector.js and content.js on page load...")
                await websocket.send(json.dumps({
                    "id": 12,
                    "method": "Page.addScriptToEvaluateOnNewDocument",
                    "params": { "source": injector_code }
                }))
                await websocket.send(json.dumps({
                    "id": 13,
                    "method": "Page.addScriptToEvaluateOnNewDocument",
                    "params": { "source": content_code }
                }))
                await asyncio.sleep(0.5)
                
                # Start background sync poller loop
                poller_task = asyncio.create_task(poll_meet_loop(websocket))

                # Trigger a reload to ensure V8 compiles the newly registered injector code on page start
                print("[CDP Agent] Triggering page reload to compile and activate injector...")
                await websocket.send(json.dumps({"id": 20, "method": "Page.reload"}))

                print("[CDP Agent] Daemon active. Monitoring logs and polling events...")
                
                try:
                    # Wait for reader task to exit (meaning connection was closed or encountered error)
                    await reader_task
                finally:
                    poller_task.cancel()
                print("[CDP Agent] Connection closed. Triggering reconnection...")
                raise RuntimeError("Websocket connection closed")

        except Exception as e:
            print(f"[CDP Agent] Error: {e}")
            print("Retrying in 3 seconds...")
            await asyncio.sleep(3)

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[CDP Agent] Terminated by user.")
