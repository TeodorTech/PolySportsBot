import os
import psycopg2
from config import DATABASE_URL
from datetime import datetime

class Database:
    @staticmethod
    def get_connection():
        """Get a connection to the PostgreSQL database if configured."""
        if not DATABASE_URL:
            return None
        try:
            return psycopg2.connect(DATABASE_URL)
        except Exception as e:
            print(f"[DB ERROR] Could not connect to database: {e}")
            return None

    @staticmethod
    def init_db():
        """Initialize the database schema."""
        if not DATABASE_URL:
            print("[DB WARN] No DATABASE_URL provided. Skipping database logs.")
            return

        conn = Database.get_connection()
        if not conn:
            return

        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute('''
                        CREATE TABLE IF NOT EXISTS events (
                            id TEXT PRIMARY KEY,
                            title TEXT NOT NULL,
                            total_volume DECIMAL(18, 2),
                            sport TEXT,
                            odds DECIMAL(10, 2),
                            outcomes TEXT[],
                            result_outcome TEXT,
                            whales_won BOOLEAN DEFAULT NULL,
                            status TEXT,
                            game_start_time TIMESTAMP WITH TIME ZONE,
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                        );

                        ALTER TABLE events ADD COLUMN IF NOT EXISTS outcomes TEXT[];
                        ALTER TABLE events ADD COLUMN IF NOT EXISTS result_outcome TEXT;
                        ALTER TABLE events ADD COLUMN IF NOT EXISTS game_start_time TIMESTAMP WITH TIME ZONE;

                        CREATE TABLE IF NOT EXISTS trades (
                            id SERIAL PRIMARY KEY,
                            event_id TEXT REFERENCES events(id),
                            outcome TEXT NOT NULL,
                            token_id TEXT NOT NULL,
                            price DECIMAL(10, 4),
                            amount_usd DECIMAL(18, 2),
                            order_id TEXT,
                            status TEXT DEFAULT 'placed',
                            placed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                        );

                        CREATE TABLE IF NOT EXISTS whale_activity (
                            id SERIAL PRIMARY KEY,
                            event_id TEXT REFERENCES events(id),
                            outcome TEXT NOT NULL,
                            token_id TEXT,
                            side TEXT,
                            price DECIMAL(10, 4),
                            trade_value DECIMAL(18, 2),
                            timestamp_utc TIMESTAMP WITH TIME ZONE,
                            external_ts TEXT,
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                        );

                        ALTER TABLE whale_activity ADD COLUMN IF NOT EXISTS token_id TEXT;
                    ''')
            print("[DB INFO] Database schema initialized (Events & Whale Activity).")
        except Exception as e:
            print(f"[DB ERROR] Schema initialization failed: {e}")
        finally:
            conn.close()

    @staticmethod
    def save_whale_activity(event_id: str, event_name: str, total_volume: float, outcome: str, side: str, price: float, value: float, ts: str, sport: str = 'Sports', outcomes: list = None, token_id: str = None, game_start_time: str = None):
        """Save a new whale activity to the database, processing the event upsert first."""
        conn = Database.get_connection()
        if not conn:
            return

        try:
            with conn:
                with conn.cursor() as cur:
                    # Guard: event_id must be present
                    if not event_id:
                        print(f"  [DB WARN] Skipping save — event_id is missing for '{event_name}'")
                        return

                    # 1. Check if an event with the same title already exists (Polymarket
                    #    may return a different id for the same real-world event after restart).
                    cur.execute('SELECT id FROM events WHERE title = %s LIMIT 1', (event_name,))
                    row = cur.fetchone()
                    if row:
                        event_id = row[0]

                    # 2. UPSERT the event (using the real Event ID)
                    game_start_dt = None
                    if game_start_time:
                        try:
                            from datetime import datetime, timezone
                            game_start_dt = datetime.fromisoformat(game_start_time.replace("Z", "+00:00"))
                        except Exception:
                            pass

                    cur.execute('''
                        INSERT INTO events (id, title, total_volume, sport, outcomes, status, game_start_time)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE
                        SET title = EXCLUDED.title, total_volume = EXCLUDED.total_volume,
                            sport = EXCLUDED.sport,
                            outcomes = COALESCE(EXCLUDED.outcomes, events.outcomes),
                            game_start_time = COALESCE(EXCLUDED.game_start_time, events.game_start_time)
                    ''', (event_id, event_name, total_volume, sport, outcomes or [], 'active', game_start_dt))

                    # 2. INSERT the whale activity
                    cur.execute('''
                        INSERT INTO whale_activity
                        (event_id, outcome, token_id, side, price, trade_value, timestamp_utc, external_ts)
                        VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, %s)
                    ''', (event_id, outcome, token_id, side, price, value, ts))
            print(f"  [DB INFO] Whale activity saved to database — {event_name} (Vol: ${total_volume:,.0f}).")
        except Exception as e:
            print(f"  [DB ERROR] Failed to save whale activity: {e}")
        finally:
            conn.close()


    @staticmethod
    def has_trade_for_event(event_id: str) -> bool:
        """Return True if we have already placed a trade for this event."""
        conn = Database.get_connection()
        if not conn:
            return False
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT 1 FROM trades WHERE event_id = %s LIMIT 1', (event_id,))
                return cur.fetchone() is not None
        except Exception as e:
            print(f"[DB ERROR] has_trade_for_event: {e}")
            return False
        finally:
            conn.close()

    @staticmethod
    def save_trade(event_id: str, outcome: str, token_id: str, price: float, amount_usd: float, order_id: str, status: str = 'placed'):
        """Record a placed trade."""
        conn = Database.get_connection()
        if not conn:
            return
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute('''
                        INSERT INTO trades (event_id, outcome, token_id, price, amount_usd, order_id, status)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ''', (event_id, outcome, token_id, price, amount_usd, order_id, status))
        except Exception as e:
            print(f"[DB ERROR] save_trade: {e}")
        finally:
            conn.close()
