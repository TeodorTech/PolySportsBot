"""
trader.py — Polymarket auto-trader (run as a cron job every 20 minutes).

Logic:
  1. Find watched events starting in < 1 hour (from DB / Gamma API).
  2. For each, check whale_activity: needs >= 1 trade with trade_value >= $50k.
  3. Compute consensus outcome (outcome with highest total whale volume).
  4. Skip if already traded this event.
  5. Look up the token_id for the consensus outcome from Gamma API.
  6. Place a market buy for TRADE_AMOUNT USD.
  7. Record the trade in the trades table.
"""

import json
import requests
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
load_dotenv()


def log(msg: str):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"[{ts}] {msg}", flush=True)

from config import (
    GAMMA_API_URL,
    TRADE_AMOUNT,
    POLY_PRIVATE_KEY,
    POLY_API_KEY,
    POLY_API_SECRET,
    POLY_API_PASSPHRASE,
    POLY_CHAIN_ID,
    POLY_FUNDER,
    DATABASE_URL,
)
from database import Database
from gamma_api import GammaAPI
from notifier import Notifier

# Minimum single trade value to qualify an event for trading
CONVICTION_THRESHOLD = 50_000


def get_qualifying_events() -> list[dict]:
    """
    Query the DB for active events with at least one whale trade >= CONVICTION_THRESHOLD.

    Returns a list of dicts:
        {event_id, event_title, consensus_outcome, consensus_token_id, consensus_volume}
    """
    import psycopg2

    if not DATABASE_URL:
        log("No DATABASE_URL set — cannot query events.")
        return []

    try:
        conn = psycopg2.connect(DATABASE_URL)
    except Exception as e:
        log(f"DB connection failed: {e}")
        return []

    query = """
        SELECT
            e.id          AS event_id,
            e.title       AS event_title,
            w.outcome     AS consensus_outcome,
            w.token_id    AS consensus_token_id,
            SUM(w.trade_value) AS consensus_volume
        FROM events e
        JOIN whale_activity w ON w.event_id = e.id
        WHERE e.status = 'active'
          AND e.whales_won IS NULL
          AND EXISTS (
              SELECT 1 FROM whale_activity w2
              WHERE w2.event_id = e.id
                AND w2.trade_value >= %s
          )
        GROUP BY e.id, e.title, w.outcome, w.token_id
        HAVING SUM(w.trade_value) = (
            SELECT SUM(w3.trade_value)
            FROM whale_activity w3
            WHERE w3.event_id = e.id
            GROUP BY w3.outcome, w3.token_id
            ORDER BY SUM(w3.trade_value) DESC
            LIMIT 1
        )
        ORDER BY consensus_volume DESC
    """

    results = []
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(query, (CONVICTION_THRESHOLD,))
                rows = cur.fetchall()
                for row in rows:
                    results.append({
                        "event_id": row[0],
                        "event_title": row[1],
                        "consensus_outcome": row[2],
                        "consensus_token_id": row[3],
                        "consensus_volume": float(row[4]),
                    })
    except Exception as e:
        log(f"DB query failed: {e}")
    finally:
        conn.close()

    return results


def get_token_id_for_outcome(event_id: str, outcome_label: str, override_token_id: str = None) -> tuple:
    """
    Fetch event details from Gamma API and return the (token_id, best_ask_price)
    for the given outcome label.

    If override_token_id is provided (e.g. from stored whale_activity.token_id),
    it is used directly instead of searching by label — this resolves ambiguity
    in soccer markets where multiple markets share "Yes"/"No" outcomes.
    """
    try:
        event_data = GammaAPI.fetch_event_details(event_id)
    except Exception as e:
        log(f"Failed to fetch event details for {event_id}: {e}")
        return None, None

    # Guard: Do not trade if game is already resolved/finished
    event_status = event_data.get("status", "").lower()
    if event_status in ("resolved", "closed", "finished"):
        log(f"  SKIP — game is {event_status}, no longer tradeable.")
        return None, None

    # Only trade once the game has started — whale activity accumulated pre-game is the signal,
    # but execution happens at tip-off so we're not trading on stale pre-game odds.
    start_raw = event_data.get("startTime") or event_data.get("startDate")
    if start_raw:
        try:
            start_dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            minutes_to_start = (start_dt - now).total_seconds() / 60
            if minutes_to_start > 0:
                log(f"  SKIP — game starts in {minutes_to_start:.0f}min, waiting for tip-off.")
                return None, None
            log(f"  Game started {abs(minutes_to_start):.0f}min ago — proceeding.")
        except Exception:
            pass

    # If we already know the exact token, just fetch its price.
    if override_token_id:
        price = get_best_ask(override_token_id)
        return override_token_id, price

    for market in (event_data.get("markets") or []):
        outcomes_raw = market.get("outcomes")
        if isinstance(outcomes_raw, str):
            try:
                outcomes = json.loads(outcomes_raw)
            except Exception:
                outcomes = []
        elif isinstance(outcomes_raw, list):
            outcomes = outcomes_raw
        else:
            outcomes = []

        clob_raw = market.get("clobTokenIds")
        if isinstance(clob_raw, str):
            try:
                clob_ids = json.loads(clob_raw)
            except Exception:
                clob_ids = [clob_raw]
        elif isinstance(clob_raw, list):
            clob_ids = clob_raw
        else:
            clob_ids = []

        for i, token_id in enumerate(clob_ids):
            if i < len(outcomes) and str(outcomes[i]).strip().lower() == outcome_label.strip().lower():
                # Get best ask from CLOB REST API
                price = get_best_ask(token_id)
                return token_id, price

    log(f"Could not find token for outcome '{outcome_label}' in event {event_id}")
    return None, None


def get_best_ask(token_id: str):
    """Fetch the current best ask (lowest sell) price for a token from the CLOB API."""
    try:
        url = f"https://clob.polymarket.com/book?token_id={token_id}"
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        book = resp.json()
        asks = book.get("asks") or []
        if asks:
            return float(asks[0]["price"])
    except Exception as e:
        log(f"Could not fetch order book for {token_id}: {e}")
    return None


def init_clob_client():
    """
    Initialize and return a CLOB client with derived API credentials.
    Called once at startup — credentials are reused across all trades in the session.
    Returns None if credentials or dependencies are missing.
    """
    if not POLY_PRIVATE_KEY:
        log("POLY_PRIVATE_KEY not set — cannot initialize CLOB client.")
        return None

    try:
        from py_clob_client.client import ClobClient
    except ImportError:
        log("py-clob-client not installed. Run: pip install py-clob-client")
        return None

    try:
        log(f"[CLOB] Initializing client (chain_id={POLY_CHAIN_ID})...")
        base_client = ClobClient(
            host="https://clob.polymarket.com",
            key=POLY_PRIVATE_KEY,
            chain_id=POLY_CHAIN_ID,
        )
        creds = base_client.derive_api_key()
        log(f"[CLOB] Derived API key: {creds.api_key}")
        client = ClobClient(
            host="https://clob.polymarket.com",
            key=POLY_PRIVATE_KEY,
            chain_id=POLY_CHAIN_ID,
            creds=creds,
            signature_type=2,
            funder=POLY_FUNDER,
        )
        return client
    except Exception as e:
        log(f"[CLOB] Failed to initialize client: {type(e).__name__}: {e}")
        return None


def place_trade(client, token_id: str, price: float, amount_usd: float):
    """
    Place a market buy order via py-clob-client.
    Returns the order ID on success, None on failure.
    """
    try:
        from py_clob_client.clob_types import MarketOrderArgs, OrderType, BalanceAllowanceParams, AssetType
    except ImportError:
        log("py-clob-client not installed.")
        return None

    try:
        log(f"  [CLOB] Updating balance allowance...")
        client.update_balance_allowance(params=BalanceAllowanceParams(asset_type=AssetType.COLLATERAL))
        balance_data = client.get_balance_allowance(params=BalanceAllowanceParams(asset_type=AssetType.COLLATERAL))
        raw_balance = int(balance_data.get("balance", 0))
        usdc_balance = raw_balance / 1_000_000
        log(f"  [CLOB] Available balance: ${usdc_balance:.2f} USDC")
        if usdc_balance < amount_usd:
            log(f"  [CLOB] INSUFFICIENT BALANCE — need ${amount_usd}, have ${usdc_balance:.2f}")
            return None, None

        log(f"  [CLOB] Creating market order — token={token_id} amount=${amount_usd}...")
        order_args = MarketOrderArgs(
            token_id=token_id,
            amount=amount_usd,
            side="BUY",
        )
        signed_order = client.create_market_order(order_args)
        log(f"  [CLOB] Order signed, submitting...")
        resp = client.post_order(signed_order, OrderType.FOK)
        log(f"  [CLOB] Raw response: {resp}")

        # Accept filled, matched, delayed, or mev orders — all represent successful placement
        status = resp.get("status", "")
        order_id = resp.get("orderID") or resp.get("id")
        if not order_id or status.lower() not in ("matched", "filled", "delayed", "mev"):
            log(f"  [CLOB] Order rejected — status='{status}' response={resp}")
            return None, None

        # Use actual fill price from response if available, fall back to pre-order best ask
        fill_price = None
        for key in ["price", "avgPrice", "average_price"]:
            candidate = resp.get(key)
            if candidate is not None:
                try:
                    fill_price = float(candidate)
                    break
                except (TypeError, ValueError):
                    pass

        actual_price = fill_price if fill_price is not None else price
        price_source = "response" if fill_price is not None else "best_ask fallback"
        log(f"  [CLOB] Fill price: {actual_price:.4f} (source: {price_source})")

        return order_id, actual_price

    except Exception as e:
        log(f"  [CLOB] Order placement failed: {type(e).__name__}: {e}")
        return None, None




def run():
    log("=" * 60)
    log("TRADER JOB STARTED")
    log(f"Config — amount: ${TRADE_AMOUNT} | conviction: ${CONVICTION_THRESHOLD:,}")

    events = get_qualifying_events()
    if not events:
        log("No qualifying events found — nothing to trade.")
        log("TRADER JOB FINISHED")
        log("=" * 60)
        return

    log(f"Found {len(events)} qualifying event(s).")

    client = init_clob_client()
    if not client:
        log("Could not initialize CLOB client — aborting run.")
        log("TRADER JOB FINISHED")
        log("=" * 60)
        return

    traded = 0
    skipped = 0

    for ev in events:
        event_id = ev["event_id"]
        event_title = ev["event_title"]
        consensus_outcome = ev["consensus_outcome"]
        consensus_volume = ev["consensus_volume"]

        consensus_token_id = ev.get("consensus_token_id")

        log(f"Checking: {event_title}")
        log(f"  Consensus outcome: {consensus_outcome} (${consensus_volume:,.0f} whale volume)")

        # Guard: max one trade per event
        if Database.has_trade_for_event(event_id):
            log(f"  SKIP — already traded this event.")
            skipped += 1
            continue

        # Get token + price — prefer stored token_id (handles Yes/No soccer markets
        # where multiple markets share the same outcome label).
        # Fall back to outcome-label search for older records without a token_id.
        token_id, price = get_token_id_for_outcome(
            event_id, consensus_outcome, override_token_id=consensus_token_id
        )
        if not token_id:
            skipped += 1
            continue
        if not price:
            log(f"  SKIP — could not get price for '{consensus_outcome}'.")
            skipped += 1
            continue

        log(f"  Token ID: {token_id}")
        log(f"  Best ask: {price:.4f} (implied prob: {price*100:.1f}%)")
        log(f"  Trade size: ${TRADE_AMOUNT} → ~{round(TRADE_AMOUNT/price, 2)} shares")
        log(f"  Attempting order — event_id={event_id} outcome='{consensus_outcome}' token={token_id} price={price} amount=${TRADE_AMOUNT}")

        order_id, fill_price = place_trade(client, token_id, price, TRADE_AMOUNT)

        if order_id:
            log(f"  SUCCESS — Order ID: {order_id}")
            log(f"  Saved trade to DB — event='{event_title}' outcome='{consensus_outcome}' amount=${TRADE_AMOUNT}")
            Database.save_trade(
                event_id=event_id,
                outcome=consensus_outcome,
                token_id=token_id,
                price=fill_price,
                amount_usd=TRADE_AMOUNT,
                order_id=order_id,
                status="placed",
            )
            Notifier.send_trade_alert(
                success=True,
                event_name=event_title,
                outcome=consensus_outcome,
                price=fill_price,
                amount_usd=TRADE_AMOUNT,
                order_id=order_id,
            )
            traded += 1
        else:
            log(f"  FAILED — event='{event_title}' event_id={event_id} outcome='{consensus_outcome}' token={token_id} price={price}")
            Notifier.send_trade_alert(
                success=False,
                event_name=event_title,
                outcome=consensus_outcome,
                price=price,
                amount_usd=TRADE_AMOUNT,
                reason="order rejected by CLOB — check logs",
            )
            skipped += 1

    log(f"Summary — traded: {traded} | skipped: {skipped}")
    log("TRADER JOB FINISHED")
    log("=" * 60)


if __name__ == "__main__":
    import time
    POLL_INTERVAL = 5 * 60  # 5 minutes
    while True:
        try:
            run()
        except Exception as e:
            log(f"Unexpected error in run(): {type(e).__name__}: {e}")
        log(f"Sleeping {POLL_INTERVAL // 60} minutes until next run...")
        time.sleep(POLL_INTERVAL)
