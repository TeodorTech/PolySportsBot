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
                        CREATE TABLE IF NOT EXISTS signals (
                            id SERIAL PRIMARY KEY,
                            event_name TEXT NOT NULL,
                            outcome TEXT NOT NULL,
                            side TEXT,
                            price DECIMAL(10, 4),
                            trade_value DECIMAL(18, 2),
                            timestamp_utc TIMESTAMP WITH TIME ZONE,
                            external_ts TEXT,
                            is_win BOOLEAN DEFAULT NULL, 
                            market_id TEXT,             
                            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                        );
                    ''')
            print("[DB INFO] Database schema initialized.")
        except Exception as e:
            print(f"[DB ERROR] Schema initialization failed: {e}")
        finally:
            conn.close()

    @staticmethod
    def save_signal(event_name: str, outcome: str, side: str, price: float, value: float, ts: str, market_id: str):
        """Save a new signal to the database if the connection is available."""
        conn = Database.get_connection()
        if not conn:
            return

        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute('''
                        INSERT INTO signals 
                        (event_name, outcome, side, price, trade_value, timestamp_utc, external_ts, market_id)
                        VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP, %s, %s)
                    ''', (event_name, outcome, side, price, value, ts, market_id))
            print("  [DB INFO] Signal saved to database.")
        except Exception as e:
            print(f"  [DB ERROR] Failed to save signal: {e}")
        finally:
            conn.close()
