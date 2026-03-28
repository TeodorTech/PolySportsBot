import json
import threading
import time
from datetime import datetime, timezone

import requests
import websocket

# ── Config ───────────────────────────────────────────────────────────────────
GAMMA_API_URL = "https://gamma-api.polymarket.com"
CLOB_WSS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
SPORTS_TAG_ID = 100639
MIN_EVENT_VOLUME = 500_000   # $2M — events we care about
MIN_TRADE_VALUE = 1       # $50k — alert threshold
PING_INTERVAL = 20             # seconds between keep-alive pings
REFRESH_INTERVAL = 1800        # Re-fetch events every 30 mins

# ── Telegram config ───────────────────────────────────────────────────────────
TELEGRAM_ENABLED = True
TELEGRAM_BOT_TOKEN = "8326363584:AAHhOnM2fCWi6IVgXZBOL3bPgE4kDmm2pE4"
TELEGRAM_CHAT_ID = "7301455234"
# ─────────────────────────────────────────────────────────────────────────────


# ── 1. Fetch sports events from Gamma API ────────────────────────────────────

def fetch_events(offset: int = 0, limit: int = 100) -> list[dict]:
    """Fetch one page of active sports events ordered by volume."""
    params = {
        "tag_id": SPORTS_TAG_ID,
        "related_tags": "true",
        "active": "true",
        "closed": "false",
        "order": "volume",
        "ascending": "false",
        "offset": offset,
        "limit": limit,
    }
    response = requests.get(f"{GAMMA_API_URL}/events", params=params)
    response.raise_for_status()
    return response.json()


def fetch_all_sports_events() -> list[dict]:
    """
    Page through sports events and return only those
    with volume >= MIN_EVENT_VOLUME.
    """
    all_events: list[dict] = []
    limit = 100
    offset = 0

    print("Fetching sports events from Polymarket Gamma API...")

    while True:
        page = fetch_events(offset=offset, limit=limit)
        if not page:
            break

        all_events.extend(page)
        last_volume = float(page[-1].get("volume") or 0)

        if last_volume < MIN_EVENT_VOLUME or len(page) < limit:
            break

        offset += limit

    filtered = [
        e for e in all_events
        if float(e.get("volume") or 0) >= MIN_EVENT_VOLUME
    ]
    return filtered


def build_lookup_tables(
    events: list[dict],
) -> tuple[dict[str, str], dict[str, str], dict[str, str], dict[str, float], dict[str, str], dict[str, str]]:
    """
    Build lookup dicts keyed by CLOB token ID, plus an event-to-volume table.
    token_to_event      : token_id -> event title
    token_to_market     : token_id -> market question
    token_to_mktid      : token_id -> market id
    event_to_volume     : event title -> float volume
    token_to_start_time : token_id -> start time string (ISO 8601)
    token_to_outcome    : token_id -> outcome name (e.g. "Yes", "Team A")
    """
    token_to_event: dict[str, str] = {}
    token_to_market: dict[str, str] = {}
    token_to_mktid: dict[str, str] = {}
    event_to_volume: dict[str, float] = {}
    token_to_start_time: dict[str, str] = {}
    token_to_outcome: dict[str, str] = {}

    for event in events:
        markets = event.get("markets", [])
        if not markets:
            continue

        event_name = event.get("title") or event.get("slug") or "N/A"
        volume = float(event.get("volume") or 0)
        event_to_volume[event_name] = volume

        # Only the first market per event (moneyline)
        market = markets[0]
        market_id = str(market.get("id", "N/A"))
        market_name = (
            market.get("question")
            or market.get("groupItemTitle")
            or "N/A"
        )
        clob_raw = market.get("clobTokenIds")
        if isinstance(clob_raw, str):
            try:
                clob_ids = json.loads(clob_raw)
            except json.JSONDecodeError:
                clob_ids = [clob_raw]
        elif isinstance(clob_raw, list):
            clob_ids = clob_raw
        else:
            clob_ids = []

        outcomes_raw = market.get("outcomes")
        if isinstance(outcomes_raw, str):
            try:
                outcomes = json.loads(outcomes_raw)
            except json.JSONDecodeError:
                outcomes = []
        elif isinstance(outcomes_raw, list):
            outcomes = outcomes_raw
        else:
            outcomes = []

        start_time = event.get("startTime") or event.get("startDate")

        for i, token_id in enumerate(clob_ids):
            token_to_event[token_id] = event_name
            token_to_market[token_id] = market_name
            token_to_mktid[token_id] = market_id
            if start_time:
                token_to_start_time[token_id] = start_time
            if i < len(outcomes):
                token_to_outcome[token_id] = str(outcomes[i])

    return token_to_event, token_to_market, token_to_mktid, event_to_volume, token_to_start_time, token_to_outcome


# ── 2. Signal delivery (console + email) ─────────────────────────────────────

def _build_signal_lines(
    event_name: str,
    outcome: str,
    side: str,
    price: float,
    value: float,
    ts: str,
) -> list[str]:
    """Return the signal as a list of plain-text lines."""
    # Select emoji based on trade value
    if value < 200_000:
        emoji = "🦀"
    elif value < 450_000:
        emoji = "🦈"
    else:
        emoji = "🐳"

    header = f"{emoji} {event_name.upper()}"
    sep = "=" * 70
    bet_info = f"BET ON  : {outcome}" if side.upper() == "BUY" else f"BET AGAINST: {outcome}"
    
    return [
        sep,
        f"  {header}",
        sep,
        f"  {bet_info}",
        f"  Price   : ${price:.4f}",
        f"  Value   : ${value:>12,.2f}",
        f"  Time    : {ts}",
        sep,
    ]




def send_signal(
    event_name: str,
    outcome: str,
    side: str,
    price: float,
    value: float,
    ts: str,
) -> None:
    """Print signal to console and send Telegram alert."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    lines = _build_signal_lines(
        event_name=event_name,
        outcome=outcome,
        side=side,
        price=price,
        value=value,
        ts=ts,
    )

    # Console output
    print("\n" + "\n".join(lines))

    # Telegram output
    if TELEGRAM_ENABLED:
        # Re-parse the lines or build a fresh HTML message
        # We know the first non-empty line after the first separator is our title with emoji
        # We will use the lines list we just built.
        
        # Clean up lines for Telegram
        neat_lines = [l.strip() for l in lines if l.strip() and "=" not in l]
        
        def h_esc(s: str) -> str:
            return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

        # The first line is our emoji + event title
        title_line = neat_lines[0]
        tg_body = f"<b>{h_esc(title_line)}</b>\n\n"
        
        for l in neat_lines[1:]:
            if " : " in l:
                key, val = l.split(" : ", 1)
                tg_body += f"<b>{h_esc(key)}:</b> {h_esc(val)}\n"
            else:
                tg_body += f"{h_esc(l)}\n"

        threading.Thread(
            target=_send_telegram,
            args=(tg_body,),
            daemon=True,
        ).start()


def _send_telegram(message: str) -> None:
    """Send a text message to Telegram via Bot API. Logs errors without crashing."""
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "HTML",
        }
        response = requests.post(url, json=payload, timeout=10)
        if response.status_code != 200:
            print(f"  [TELEGRAM ERROR] {response.status_code}: {response.text}")
        else:
            print(f"  [TELEGRAM] Alert sent to {TELEGRAM_CHAT_ID}")
    except Exception as exc:
        print(f"  [TELEGRAM ERROR] Failed to send message: {exc}")


# ── 3. WebSocket watcher ─────────────────────────────────────────────────────

class PolymarketWatcher:
    def __init__(
        self,
        asset_ids: list[str],
        token_to_event: dict[str, str],
        token_to_market: dict[str, str],
        token_to_mktid: dict[str, str],
        event_to_volume: dict[str, float],
        token_to_start_time: dict[str, str],
        token_to_outcome: dict[str, str],
    ) -> None:
        self.asset_ids = asset_ids
        self.token_to_event = token_to_event
        self.token_to_market = token_to_market
        self.token_to_mktid = token_to_mktid
        self.event_to_volume = event_to_volume
        self.token_to_start_time = token_to_start_time
        self.token_to_outcome = token_to_outcome
        self.ws: websocket.WebSocketApp | None = None
        self._ping_thread: threading.Thread | None = None
        self._refresh_thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    # ── WebSocket callbacks ──────────────────────────────────────────────────

    def on_open(self, ws: websocket.WebSocketApp) -> None:
        print(f"\nConnected to Polymarket CLOB WebSocket.")
        self.subscribe()
        self._start_threads()

    def subscribe(self) -> None:
        """Send or update the 'market' subscription with current asset IDs."""
        if not self.ws or not self.asset_ids:
            return

        unique_events = sorted(
            list(set(self.token_to_event.values())),
            key=lambda e: self.event_to_volume.get(e, 0),
            reverse=True,
        )
        print("\nTracking (by volume):")
        for event in unique_events:
            vol = self.event_to_volume.get(event, 0)
            print(f"  ${vol:>12,.0f} | {event}")

        subscription = {
            "assets_ids": self.asset_ids,
            "type": "market",
        }
        self.ws.send(json.dumps(subscription))
        print(f"Watching trades >= ${MIN_TRADE_VALUE:,.0f}\n")

    def on_message(
        self, ws: websocket.WebSocketApp, raw: str
    ) -> None:
        try:
            messages = json.loads(raw)
        except json.JSONDecodeError:
            return

        # The server may send a single dict or a list of dicts
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

            # Only process BUY signals
            if side.upper() != "BUY":
                continue

            if value < MIN_TRADE_VALUE:
                continue

            event_name = self.token_to_event.get(
                token_id, "Unknown Event"
            )
            market_name = self.token_to_market.get(
                token_id, "Unknown Market"
            )
            market_id = self.token_to_mktid.get(token_id, "N/A")
            outcome_name = self.token_to_outcome.get(token_id, "Unknown")

            # Convert ms timestamp to readable string
            try:
                ts_ms = int(ts_raw)
                msg_dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
                ts_str = msg_dt.strftime("%Y-%m-%d %H:%M:%S UTC")
                
                # Check against game start time
                start_time_raw = self.token_to_start_time.get(token_id)
                if start_time_raw:
                    # Replacing Z with +00:00 for fromisoformat compatibility in Py 3.9
                    start_dt = datetime.fromisoformat(start_time_raw.replace("Z", "+00:00"))
                    if msg_dt >= start_dt:
                        # Trade occurred after game start, skip it
                        continue
            except (ValueError, TypeError):
                ts_str = str(ts_raw)

            send_signal(
                event_name=event_name,
                outcome=outcome_name,
                side=side,
                price=price,
                value=value,
                ts=ts_str,
            )

    def on_error(
        self, ws: websocket.WebSocketApp, error: Exception
    ) -> None:
        print(f"\n[WS ERROR] {error}")

    def on_close(
        self,
        ws: websocket.WebSocketApp,
        close_status_code: int,
        close_msg: str,
    ) -> None:
        self._stop_event.set()
        print(
            f"\n[WS CLOSED] code={close_status_code} "
            f"reason={close_msg}"
        )

    # ── Background threads ───────────────────────────────────────────────────

    def _start_threads(self) -> None:
        self._stop_event.clear()
        
        # Ping thread
        if not self._ping_thread or not self._ping_thread.is_alive():
            self._ping_thread = threading.Thread(
                target=self._ping_loop, daemon=True
            )
            self._ping_thread.start()

        # Refresh thread
        if not self._refresh_thread or not self._refresh_thread.is_alive():
            self._refresh_thread = threading.Thread(
                target=self._refresh_loop, daemon=True
            )
            self._refresh_thread.start()

    def _ping_loop(self) -> None:
        while not self._stop_event.wait(PING_INTERVAL):
            if self.ws:
                try:
                    self.ws.send("ping")
                except Exception:
                    break

    def _refresh_loop(self) -> None:
        """Periodically re-fetch events and update subscriptions if needed."""
        while not self._stop_event.wait(REFRESH_INTERVAL):
            try:
                print("\n[REFRESH] Scanning for new qualifying events...")
                events = fetch_all_sports_events()
                new_t2e, new_t2m, new_t2mi, new_e2v, new_t2st, new_t2o = build_lookup_tables(events)
                new_ids = sorted(list(new_t2e.keys()))

                if new_ids != sorted(self.asset_ids):
                    print(f"[REFRESH] Found {len(new_ids)} tokens (was {len(self.asset_ids)}). Updating subscription...")
                    self.asset_ids = new_ids
                    self.token_to_event = new_t2e
                    self.token_to_market = new_t2m
                    self.token_to_mktid = new_t2mi
                    self.event_to_volume = new_e2v
                    self.token_to_start_time = new_t2st
                    self.token_to_outcome = new_t2o
                    
                    # Send updated subscription over the existing WebSocket
                    self.subscribe()
                else:
                    print("[REFRESH] No new markets found. Staying on current list.")
            except Exception as exc:
                print(f"[REFRESH ERROR] Failed to refresh events: {exc}")

    # ── Run ──────────────────────────────────────────────────────────────────

    def run(self) -> None:
        while True:
            self.ws = websocket.WebSocketApp(
                CLOB_WSS_URL,
                on_open=self.on_open,
                on_message=self.on_message,
                on_error=self.on_error,
                on_close=self.on_close,
            )
            self.ws.run_forever()
            print("[WS] Reconnecting in 5 seconds...")
            time.sleep(5)


# ── 4. Entry point ───────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 70)
    print(" Polymarket Sports Watcher — Signals on trades >= $50k")
    print("=" * 70 + "\n")

    # Step 1 — fetch qualifying events
    try:
        events = fetch_all_sports_events()
    except requests.HTTPError as exc:
        print(f"HTTP error fetching events: {exc}")
        return
    except requests.ConnectionError:
        print("Connection error — check your internet connection.")
        return

    if not events:
        print("No sports events found with volume >= $1M. Exiting.")
        return

    print(
        f"Found {len(events)} sports event(s) "
        f"with volume >= ${MIN_EVENT_VOLUME:,.0f}.\n"
    )

    # Step 2 — build lookup tables and collect all token IDs
    token_to_event, token_to_market, token_to_mktid, event_to_volume, token_to_start_time, token_to_outcome = (
        build_lookup_tables(events)
    )
    all_token_ids = list(token_to_event.keys())

    if not all_token_ids:
        print("No CLOB token IDs found in the fetched events. Exiting.")
        return

    # Send startup test
    if TELEGRAM_ENABLED:
        _send_telegram("🚀 <b>Polymarket Bot Started!</b> Watching for large trades...")

    # Step 3 — start watcher (blocks until Ctrl+C)
    watcher = PolymarketWatcher(
        asset_ids=all_token_ids,
        token_to_event=token_to_event,
        token_to_market=token_to_market,
        token_to_mktid=token_to_mktid,
        event_to_volume=event_to_volume,
        token_to_start_time=token_to_start_time,
        token_to_outcome=token_to_outcome,
    )
    try:
        watcher.run()
    except KeyboardInterrupt:
        print("\n\nStopped by user. Goodbye.")


if __name__ == "__main__":
    main()