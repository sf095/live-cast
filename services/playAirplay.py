#!/usr/bin/env python3
"""
AirPlay Playback and Control Service
Bypasses RTSP 501 Not Implemented errors for Smart TVs.
"""
import sys
import asyncio
import pyatv
from pyatv.support.rtsp import RtspSession
from pyatv.support.http import HttpResponse
from pyatv.storage.file_storage import FileStorage

# Monkey patch RtspSession.exchange to bypass smart TV RTSP 501 errors
original_exchange = RtspSession.exchange

async def patched_exchange(self, *args, **kwargs):
    try:
        return await original_exchange(self, *args, **kwargs)
    except pyatv.exceptions.HttpError as e:
        if any(err in str(e) for err in ["501", "404", "Not Implemented", "Not Found"]):
            print(f"[AirPlay-Patch] Ignoring RTSP HttpError during exchange: {e}", file=sys.stderr)
            return HttpResponse("RTSP", "1.0", 200, "OK", {}, b"")
        raise e

RtspSession.exchange = patched_exchange

from pyatv.support.http import HttpConnection

original_send_and_receive = HttpConnection.send_and_receive

async def patched_send_and_receive(self, method, uri, *args, **kwargs):
    if method == "POST" and uri == "/play":
        print("[AirPlay-Patch] Rewriting POST /play to use text/parameters", file=sys.stderr)
        import plistlib
        body = kwargs.get("body")
        headers = kwargs.get("headers", {})
        if body:
            try:
                plist_data = plistlib.loads(body)
                url = plist_data.get("Content-Location")
                position = plist_data.get("Start-Position-Seconds", 0.0)
                
                # Format as plain text parameters
                new_body = f"Content-Location: {url}\nStart-Position: {position}\n"
                kwargs["body"] = new_body.encode("utf-8")
                
                # Update headers
                new_headers = dict(headers)
                new_headers["Content-Type"] = "text/parameters"
                if "Content-Length" in new_headers:
                    del new_headers["Content-Length"]
                kwargs["headers"] = new_headers
                
                # Force content_type
                kwargs["content_type"] = "text/parameters"
            except Exception as e:
                print(f"[AirPlay-Patch] Failed to parse plist: {e}", file=sys.stderr)

    return await original_send_and_receive(self, method, uri, *args, **kwargs)

HttpConnection.send_and_receive = patched_send_and_receive

async def main():
    if len(sys.argv) < 3:
        print("Usage: playAirplay.py <command> <ip> [url]")
        print("Commands: play, stop")
        sys.exit(1)

    command = sys.argv[1]
    ip = sys.argv[2]
    url = sys.argv[3] if len(sys.argv) > 3 else None

    loop = asyncio.get_running_loop()
    storage = FileStorage.default_storage(loop)
    await storage.load()

    # Scan specific host
    atvs = await pyatv.scan(loop, hosts=[ip], storage=storage)
    if not atvs:
        print(f"Error: Could not find Apple TV at {ip}", file=sys.stderr, flush=True)
        sys.exit(1)

    atv = await pyatv.connect(atvs[0], loop, storage=storage)

    try:
        if command == "play":
            if not url:
                print("Error: play command requires a URL", file=sys.stderr, flush=True)
                sys.exit(1)
            # Send play command
            await atv.stream.play_url(url)
            print("Casting started successfully.", flush=True)
            # Keep process alive to ensure connection remains stable during initial buffer
            await asyncio.sleep(5)
        elif command == "stop":
            # Send stop command
            await atv.remote_control.stop()
            print("Casting stopped.", flush=True)
        else:
            print(f"Error: Unknown command: {command}", file=sys.stderr, flush=True)
            sys.exit(1)
    except Exception as e:
        print(f"Error executing command: {e}", file=sys.stderr, flush=True)
        sys.exit(1)
    finally:
        close_tasks = atv.close()
        if close_tasks:
            await asyncio.wait(close_tasks)

if __name__ == "__main__":
    asyncio.run(main())
