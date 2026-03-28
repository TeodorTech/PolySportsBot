import os

# ── Gamma API Config ───────────────────────────────────────────────────────────
GAMMA_API_URL = "https://gamma-api.polymarket.com"
DATA_API_URL = "https://data-api.polymarket.com"
CLOB_WSS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
SPORTS_TAG_ID = 100639

# ── Filtering Constants ────────────────────────────────────────────────────────
MIN_EVENT_VOLUME = int(os.getenv("MIN_EVENT_VOLUME", 1_000_000))
MIN_TRADE_VALUE = int(os.getenv("MIN_TRADE_VALUE", 50_000))
PING_INTERVAL = int(os.getenv("PING_INTERVAL", 20))           
REFRESH_INTERVAL = int(os.getenv("REFRESH_INTERVAL", 1800))   

# ── Telegram Config ────────────────────────────────────────────────────────────
TELEGRAM_ENABLED = True
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8326363584:AAHhOnM2fCWi6IVgXZBOL3bPgE4kDmm2pE4")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "7301455234")

# ── Database Config ────────────────────────────────────────────────────────────
# Railway automatically provides DATABASE_URL
DATABASE_URL = os.getenv("DATABASE_URL")
