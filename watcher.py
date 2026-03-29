import json
import threading
import time
import websocket
from datetime import datetime, timezone
from config import CLOB_WSS_URL, MIN_TRADE_VALUE, PING_INTERVAL, REFRESH_INTERVAL
from gamma_api import GammaAPI, build_lookup_tables
from notifier import Notifier
from database import Database

class PolymarketWatcher:
    """Manager for WebSocket trades and Periodic refreshes."""
    def __init__(self, asset_ids, token_to_event, token_to_market, 
                 token_to_mktid, event_to_volume, token_to_start_time, 
                 token_to_outcome):
        self.asset_ids = asset_ids
        self.token_to_event = token_to_event
        self.token_to_market = token_to_market
        self.token_to_mktid = token_to_mktid
        self.event_to_volume = event_to_volume
        self.token_to_start_time = token_to_start_time
        self.token_to_outcome = token_to_outcome
        
        self.ws = None
        self._ping_thread = None
        self._refresh_thread = None
        self._stop_event = threading.Event()

    def subscribe(self) -> None:
        """Send or update the 'market' subscription with current asset IDs."""
        if not self.ws or not self.asset_ids:
            return

        unique_events = sorted(
            list(set(self.token_to_event.values())),
            key=lambda e: self.event_to_volume.get(e, 0),
            reverse=True,
        )
        print("\n[WATCHER] Active Markets:")
        for event in unique_events:
            vol = self.event_to_volume.get(event, 0)
            print(f"  ${vol:>12,.0f} | {event}")

        subscription = {
            "assets_ids": self.asset_ids,
            "type": "market",
        }
        self.ws.send(json.dumps(subscription))
        print(f"[WATCHER] Watching trades >= ${MIN_TRADE_VALUE:,.0f}\n")

    def on_message(self, ws, raw):
        """Handler for trade messages."""
        try:
            # Attempt to parse as JSON first (standard for trades)
            messages = json.loads(raw)
            if isinstance(messages, dict):
                messages = [messages]

            for msg in messages:
                if msg.get("event_type") != "last_trade_price":
                    continue

                token_id = msg.get("asset_id", "")
                price = float(msg.get("price") or 0)
                size = float(msg.get("size") or 0)
                side = msg.get("side", "N/A")
                ts_raw = msg.get("timestamp", "")
                value = price * size

                # Filter: BUY ONLY
                if side.upper() != "BUY":
                    continue
                
                # Filter: Value threshold
                if value < MIN_TRADE_VALUE:
                    continue

                # Metadata
                event_name = self.token_to_event.get(token_id, "Unknown")
                market_name = self.token_to_market.get(token_id, "N/A")
                outcome_name = self.token_to_outcome.get(token_id, "Unknown")
                market_id = self.token_to_mktid.get(token_id, "N/A")

                # Timestamp and Date comparison
                try:
                    ts_ms = int(ts_raw)
                    msg_dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
                    ts_str = msg_dt.strftime("%Y-%m-%d %H:%M:%S UTC")
                    
                    # Filtering: Game Start Time
                    start_time_raw = self.token_to_start_time.get(token_id)
                    if start_time_raw:
                        start_dt = datetime.fromisoformat(start_time_raw.replace("Z", "+00:00"))
                        if msg_dt >= start_dt:
                            continue  # Ignore trades after game start
                except (ValueError, TypeError):
                    ts_str = str(ts_raw)

                # Send Alert
                Notifier.send_signal(
                    event_name=event_name,
                    market_name=market_name,
                    outcome=outcome_name,
                    side=side,
                    price=price,
                    value=value,
                    ts=ts_str
                )

                # Save to Database
                Database.save_signal(
                    event_name=event_name,
                    outcome=outcome_name,
                    side=side,
                    price=price,
                    value=value,
                    ts=ts_str,
                    market_id=market_id
                )

        except (json.JSONDecodeError, TypeError):
            # Silently skip any non-JSON messages (like 'pong' or heartbeats)
            return
        except Exception as exc:
            # Only log actual processing or logic errors
            print(f"[WATCHER LOGIC ERROR] {exc}")

    def on_open(self, ws):
        print(f"[WATCHER] Connected to CLOB WebSocket.")
        self.subscribe()
        self._start_threads()

    def _start_threads(self) -> None:
        self._stop_event.clear()
        if not self._ping_thread or not self._ping_thread.is_alive():
            self._ping_thread = threading.Thread(target=self._ping_loop, daemon=True)
            self._ping_thread.start()

        if not self._refresh_thread or not self._refresh_thread.is_alive():
            self._refresh_thread = threading.Thread(target=self._refresh_loop, daemon=True)
            self._refresh_thread.start()

    def _ping_loop(self):
        while not self._stop_event.wait(PING_INTERVAL):
            if self.ws:
                try:
                    self.ws.send("ping")
                except:
                    break

    def _refresh_loop(self):
        """Re-scan for qualify events and update subscriptions."""
        while not self._stop_event.wait(REFRESH_INTERVAL):
            try:
                print("\n[REFRESH] Scanning for new qualifying events...")
                events = GammaAPI.fetch_all_sports_events()
                (new_t2e, new_t2m, new_t2mi, new_e2v, 
                 new_t2st, new_t2o) = build_lookup_tables(events)
                
                new_ids = sorted(list(new_t2e.keys()))
                if new_ids != sorted(self.asset_ids):
                    print(f"[REFRESH] Found {len(new_ids)} tokens. Updating subscriptions...")
                    self.asset_ids = new_ids
                    self.token_to_event = new_t2e
                    self.token_to_market = new_t2m
                    self.token_to_mktid = new_t2mi
                    self.event_to_volume = new_e2v
                    self.token_to_start_time = new_t2st
                    self.token_to_outcome = new_t2o
                    self.subscribe()
            except Exception as exc:
                print(f"[REFRESH ERROR] Failed to refresh: {exc}")

    def run(self) -> None:
        while True:
            self.ws = websocket.WebSocketApp(
                CLOB_WSS_URL,
                on_open=self.on_open,
                on_message=self.on_message,
                on_error=lambda ws, e: print(f"[WS ERROR] {e}"),
                on_close=lambda ws, c, m: print(f"[WS CLOSED] {c}: {m}"),
            )
            self.ws.run_forever()
            print("[WATCHER] Reconnecting in 5s...")
            time.sleep(5)
