import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from socketserver import ThreadingTCPServer

import websockets


def process_plain_http_request(connection, request):
    """Answer plain HTTP requests on the WS port with a friendly 200.

    Port probers (VS Code auto-forwarding in WSL, browsers preconnecting,
    curl health checks) send ordinary HTTP requests with `Connection:
    keep-alive`; without this hook the websockets library rejects them with a
    full ERROR traceback on every probe.
    """
    connection_header = request.headers.get("Connection", "")
    if "upgrade" not in connection_header.lower():
        return connection.respond(
            HTTPStatus.OK,
            "ROS monitor bridge WebSocket endpoint - connect via ws://\n",
        )
    return None  # proceed with the normal WebSocket handshake


async def websocket_broadcaster(runtime, logger):
    logger.info("WebSocket broadcaster task running.")
    while True:
        event = await runtime.event_queue.get()
        if runtime.connected_clients:
            payload = json.dumps(event)
            await asyncio_gather_sends(runtime.connected_clients, payload)
        runtime.event_queue.task_done()


async def asyncio_gather_sends(clients, payload):
    import asyncio

    await asyncio.gather(
        *[asyncio.create_task(send_to_client(client, payload)) for client in list(clients)],
        return_exceptions=True,
    )


async def send_to_client(client, payload):
    try:
        await client.send(payload)
    except websockets.exceptions.ConnectionClosed:
        pass


def create_ws_handler(runtime, logger):
    async def ws_handler(websocket, *args):
        runtime.connected_clients.add(websocket)
        addr = websocket.remote_address
        logger.info(f"WebSocket client connected from {addr[0]}:{addr[1]}. Active clients: {len(runtime.connected_clients)}")
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    logger.info(f"Received from client {addr}: {data}")
                except json.JSONDecodeError:
                    logger.warning("Received invalid JSON from client.")
        except websockets.exceptions.ConnectionClosedOK:
            pass
        except Exception as exc:
            logger.error(f"WebSocket connection error with {addr}: {exc}")
        finally:
            runtime.connected_clients.discard(websocket)
            logger.info(
                f"WebSocket client disconnected {addr[0]}:{addr[1]}. Remaining: {len(runtime.connected_clients)}"
            )

    return ws_handler


class CORSHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def log_message(self, format, *args):
        pass


def run_http_server(root_dir, port, logger):
    os.chdir(root_dir)
    ThreadingTCPServer.allow_reuse_address = True
    with ThreadingTCPServer(("", port), CORSHTTPRequestHandler) as httpd:
        logger.info(f"Serving frontend static files from: {root_dir}")
        logger.info(f"Open in browser: http://localhost:{port}")
        try:
            httpd.serve_forever()
        except Exception as exc:
            logger.info(f"HTTP Server stopped: {exc}")

