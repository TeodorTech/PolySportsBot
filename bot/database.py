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
                            whales_won BOOLEAN DEFAULT NULL,
                            status TEXT,
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                        );

                        CREATE TABLE IF NOT EXISTS whale_activity (
                            id SERIAL PRIMARY KEY,
                            event_id TEXT REFERENCES events(id),
                            outcome TEXT NOT NULL,
                            side TEXT,
                            price DECIMAL(10, 4),
                            trade_value DECIMAL(18, 2),
                            timestamp_utc TIMESTAMP WITH TIME ZONE,
                            external_ts TEXT,
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                        );
                    ''')
            print("[DB INFO] Database schema initialized (Events & Whale Activity).")
        except Exception as e:
            print(f"[DB ERROR] Schema initialization failed: {e}")
        finally:
            conn.close()

    @staticmethod
    def save_whale_activity(event_id: str, event_name: str, total_volume: float, outcome: str, side: str, price: float, value: float, ts: str, sport: str = 'Sports'):
        """Save a new whale activity to the database, processing the event upsert first."""
        conn = Database.get_connection()
        if not conn:
            return

        try:
            with conn:
                with conn.cursor() as cur:
                    # 1. Check if an event with the same title already exists (Polymarket
                    #    may return a different id for the same real-world event after restart).
                    cur.execute('SELECT id FROM events WHERE title = %s LIMIT 1', (event_name,))
                    row = cur.fetchone()
                    if row:
                        event_id = row[0]

                    # 2. UPSERT the event (using the real Event ID)
                    cur.execute('''
                        INSERT INTO events (id, title, total_volume, sport, status)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE
                        SET title = EXCLUDED.title, total_volume = EXCLUDED.total_volume,
                            sport = EXCLUDED.sport
                    ''', (event_id, event_name, total_volume, sport, 'active'))

                    # 2. INSERT the whale activity
                    cur.execute('''
                        INSERT INTO whale_activity 
                        (event_id, outcome, side, price, trade_value, timestamp_utc, external_ts)
                        VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP, %s)
                    ''', (event_id, outcome, side, price, value, ts))
            print(f"  [DB INFO] Whale activity saved to database (Vol: ${total_volume:,.0f}).")
        except Exception as e:
            print(f"  [DB ERROR] Failed to save whale activity: {e}")
        finally:
            conn.close()
