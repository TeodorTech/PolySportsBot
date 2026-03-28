import requests
from config import MIN_EVENT_VOLUME, TELEGRAM_ENABLED
from gamma_api import GammaAPI, build_lookup_tables
from notifier import Notifier
from watcher import PolymarketWatcher
from database import Database

def main() -> None:
    print("=" * 70)
    print(" Polymarket Sports Watcher — Pre-match Entry Signals Only")
    print("=" * 70 + "\n")

    # Step 0 — Initialize Database
    Database.init_db()

    # Step 1 — Fetch qualifying events
    try:
        events = GammaAPI.fetch_all_sports_events()
    except Exception as exc:
        print(f"[FATAL] Failed to fetch events: {exc}")
        return

    if not events:
        print(f"[FATAL] No sports events found with volume >= ${MIN_EVENT_VOLUME:,.0f}. Exiting.")
        return

    print(f"[INIT] Found {len(events)} qualifying events.\n")

    # Step 2 — Build lookup tables
    (token_to_event, token_to_market, token_to_mktid, 
     event_to_volume, token_to_start_time, token_to_outcome) = build_lookup_tables(events)
    
    all_token_ids = list(token_to_event.keys())
    if not all_token_ids:
        print("[FATAL] No CLOB token IDs found in events. Exiting.")
        return

    # Startup test
    if TELEGRAM_ENABLED:
        try:
            Notifier._send_telegram_worker("🚀 <b>Polymarket Bot Started!</b> Pre-match Moneyline Entry Signals.")
        except:
            pass

    # Step 3 — Run watcher
    watcher = PolymarketWatcher(
        asset_ids=all_token_ids,
        token_to_event=token_to_event,
        token_to_market=token_to_market,
        token_to_mktid=token_to_mktid,
        event_to_volume=event_to_volume,
        token_to_start_time=token_to_start_time,
        token_to_outcome=token_to_outcome
    )
    
    try:
        watcher.run()
    except KeyboardInterrupt:
        print("\n\n[USER] Stopped by user. Goodbye.")

if __name__ == "__main__":
    main()