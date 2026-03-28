import requests
import threading
from datetime import datetime, timezone
from config import TELEGRAM_ENABLED, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

class Notifier:
    """Service for delivering signals to console and Telegram."""
    
    @staticmethod
    def build_signal_lines(event_name, outcome, side, price, value, ts):
        """Build pretty plain-text lines for console."""
        # Emoji decision
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

    @classmethod
    def send_signal(cls, event_name, outcome, side, price, value, ts):
        """Log to console and push to Telegram."""
        lines = cls.build_signal_lines(event_name, outcome, side, price, value, ts)
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
