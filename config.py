import os

# ── Gamma API Config ───────────────────────────────────────────────────────────
GAMMA_API_URL = "https://gamma-api.polymarket.com"
CLOB_WSS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
SPORTS_TAG_ID = 100639

# ── Filtering Constants ────────────────────────────────────────────────────────
MIN_EVENT_VOLUME = 1_000_000   # $1M — events we care about
MIN_TRADE_VALUE = 100_000      # $100k — alert threshold (configured by user)
PING_INTERVAL = 20           # seconds between keep-alive pings
REFRESH_INTERVAL = 1800      # Re-fetch events every 30 mins

# ── Telegram Config ────────────────────────────────────────────────────────────
TELEGRAM_ENABLED = True
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8326363584:AAHhOnM2fCWi6IVgXZBOL3bPgE4kDmm2pE4")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "7301455234")
