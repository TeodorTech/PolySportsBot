import requests
import threading
from datetime import datetime, timezone
from config import TELEGRAM_ENABLED, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

class Notifier:
    """Service for delivering signals to console and Telegram."""
    
    @staticmethod
    def build_signal_lines(event_name, market_name, outcome, side, price, value, ts):
        """Build pretty plain-text lines for console."""
        # Emoji decision
        if value < 100_000:
            emoji = "🦀"
        elif value < 250_000:
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
            f"  MARKET  : {market_name}",
            f"  {bet_info}",
            f"  Price   : ${price:.4f}",
            f"  Value   : ${value:>12,.2f}",
            f"  Time    : {ts}",
            sep,
        ]

    @classmethod
    def send_signal(cls, event_name, market_name, outcome, side, price, value, ts):
        """Log to console and push to Telegram."""
        lines = cls.build_signal_lines(event_name, market_name, outcome, side, price, value, ts)
        print("\n" + "\n".join(lines))

        if TELEGRAM_ENABLED:
            neat_lines = [l.strip() for l in lines if l.strip() and "=" not in l]
            
            def h_esc(s: str) -> str:
                return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

            title_line = neat_lines[0]
            tg_body = f"<b>{h_esc(title_line)}</b>\n\n"
            
            for l in neat_lines[1:]:
                if " : " in l:
                    key, val = l.split(" : ", 1)
                    tg_body += f"<b>{h_esc(key)}:</b> {h_esc(val)}\n"
                else:
                    tg_body += f"{h_esc(l)}\n"

            threading.Thread(
                target=cls._send_telegram_worker,
                args=(tg_body,),
                daemon=True,
            ).start()

    @classmethod
    def send_trade_alert(cls, success: bool, event_name: str, outcome: str, price: float, amount_usd: float, order_id: str = None, reason: str = None):
        """Notify on trade placement — success or failure."""
        if success:
            header = f"✅ TRADE PLACED — {event_name.upper()}"
            body_lines = [
                f"  Outcome : {outcome}",
                f"  Price   : {price:.4f} ({price*100:.1f}%)",
                f"  Amount  : ${amount_usd}",
                f"  Order ID: {order_id}",
            ]
        else:
            header = f"❌ TRADE FAILED — {event_name.upper()}"
            body_lines = [
                f"  Outcome : {outcome}",
                f"  Price   : {price:.4f} ({price*100:.1f}%)",
                f"  Amount  : ${amount_usd}",
                f"  Reason  : {reason or 'unknown'}",
            ]

        sep = "=" * 70
        lines = [sep, f"  {header}", sep] + body_lines + [sep]
        print("\n" + "\n".join(lines))

        if TELEGRAM_ENABLED:
            def h_esc(s: str) -> str:
                return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

            tg_body = f"<b>{h_esc(header)}</b>\n\n"
            for line in body_lines:
                if " : " in line:
                    key, val = line.split(" : ", 1)
                    tg_body += f"<b>{h_esc(key.strip())}:</b> {h_esc(val.strip())}\n"
                else:
                    tg_body += f"{h_esc(line.strip())}\n"

            threading.Thread(
                target=cls._send_telegram_worker,
                args=(tg_body,),
                daemon=True,
            ).start()

    @staticmethod
    def _send_telegram_worker(message: str):
        """Worker thread for non-blocking Telegram delivery."""
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
                print(f"  [TELEGRAM] Alert sent successfully.")
        except Exception as exc:
            print(f"  [TELEGRAM ERROR] Failed to send: {exc}")
