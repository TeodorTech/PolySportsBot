import os

# ── Gamma API Config ───────────────────────────────────────────────────────────
GAMMA_API_URL = "https://gamma-api.polymarket.com"
DATA_API_URL = "https://data-api.polymarket.com"
CLOB_WSS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
SPORTS_TAG_ID = 100639

# ── Filtering Constants ────────────────────────────────────────────────────────
MIN_EVENT_VOLUME = int(os.getenv("MIN_EVENT_VOLUME", 100_000))
MIN_TRADE_VALUE = int(os.getenv("MIN_TRADE_VALUE", 5_000))
MIN_NOTIFY_VALUE = int(os.getenv("MIN_NOTIFY_VALUE", 25_000))
PING_INTERVAL = int(os.getenv("PING_INTERVAL", 20))           
REFRESH_INTERVAL = int(os.getenv("REFRESH_INTERVAL", 600))
REFRESH_INTERVAL_NIGHT = int(os.getenv("REFRESH_INTERVAL_NIGHT", 3600))

# ── Telegram Config ────────────────────────────────────────────────────────────
TELEGRAM_ENABLED = True
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

# ── Trader Config ─────────────────────────────────────────────────────────────
_blocked_raw = os.getenv("BLOCKED_SPORTS", "Soccer")
BLOCKED_SPORTS = [s.strip() for s in _blocked_raw.split(",") if s.strip()]
TRADE_AMOUNT = float(os.getenv("TRADE_AMOUNT", 10))       # USD per trade
POLY_PRIVATE_KEY = os.getenv("POLY_PRIVATE_KEY")          # Wallet private key (0x...)
POLY_API_KEY = os.getenv("POLY_API_KEY")
POLY_API_SECRET = os.getenv("POLY_API_SECRET")
POLY_API_PASSPHRASE = os.getenv("POLY_API_PASSPHRASE")
POLY_CHAIN_ID = int(os.getenv("POLY_CHAIN_ID", 137))      # 137 = Polygon mainnet
POLY_FUNDER = os.getenv("POLY_FUNDER")                    # Proxy address (0xFA05...)

# ── Database Config ────────────────────────────────────────────────────────────
# Railway automatically provides DATABASE_URL
DATABASE_URL = os.getenv("DATABASE_URL")
