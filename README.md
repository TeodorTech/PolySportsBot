# 🐳 PolySports Whale Watcher

A high-performance monorepo for tracking, analyzing, and visualizing "Whale" activity in Polymarket's sports betting markets.

## 📁 Project Structure

This project uses a monorepo architecture to separate data ingestion from visualization:

- **`/bot`**: A Python-based real-time engine that monitors the Polymarket CLOB WebSocket for large-volume alerts.
- **`/dashboard`**: (Pending) A Next.js full-stack application for displaying event analytics and manual outcome management.
- **`schema.sql`**: The shared relational database definition (PostgreSQL).

---

## 🤖 The Bot (Python)

The core engine is designed for speed and precision. It performs the following:

1.  **Real-time Monitoring:** Connects to Polymarket's WebSocket to intercept every individual trade.
2.  **Filtering Logic:**
    *   **Volume Thresholds:** Only flags trades above a configurable "Whale" threshold (default: $50,000).
    *   **Pre-match Focus:** Automatically ignores trades that happen after the official game start time.
    *   **Moneyline Priority:** Focuses on standard "Winner" markets to maintain signal clarity.
3.  **Data Persistence:** Performs real-time upserts into a relational database, linking individual whale bets to their parent sports events.

---

## 📊 The Dashboard (Next.js)

The Dashboard transforms raw whale logs into a clean, actionable analytics experience.

### 🎨 Design Philosophy
- **Modern Classic:** A simple, high-utility aesthetic. No glassmorphism or distracting visuals.
- **Dark Mode First:** Deep blacks and sharp whites for maximum readability.
- **Entry View:** A bold title and subtitle followed immediately by the list of upcoming events (> $1M volume) ordered by total investment.
- **Event Deep-Dive:** Clean, detailed lists of specific whale trades and a clear side-by-side volume comparison for each outcome.

### ⚙️ How It Works
1.  **Direct DB Access:** Connects directly to the Railway PostgreSQL instance via the shared `DATABASE_URL`.
2.  **Server Actions:** Uses Next.js Server Components for secure, high-performance data fetching.
3.  **Real-Time Context:** Aggregates `whale_activity` logs on-the-fly to show a breakdown of Whale Volume (e.g., Team A ($2.4M) vs. Team B ($1.1M)).
4.  **Admin Toggle:** A dedicated switch for each settled event to manually update the `whales_won` status.

### 🔌 Database Communication Model
- **Read Logic:** Fetches `events` and summarizes relevant `whale_activity` specifically for high-volume matches.
- **Write Logic:** Precise `UPDATE` calls to settle outcomes once game results are official.

---

### 🧠 Core Business Logic
To maintain the highest quality of signals, the dashboard follows these rules:

1.  **Event Visibility:** Only show events that have reached a global volume of **$1,000,000+**. This ensures we only analyze high-liquidity matches.
2.  **Whale Breakdown:** For every event, visualize the total distribution of "Whale Money" across all possible outcomes (e.g., Team A vs Team B).
3.  **Manual Outcome Control:** Provides an admin interface to manually toggle the `whales_won` boolean once a game is officially resolved.

---

## 🛠️ Tech Stack

- **Backend:** Python (Requests, Websockets, Psycopg2)
- **Frontend:** Next.js (TypeScript, Tailwind CSS, Recharts)
- **Database:** PostgreSQL (Hosted on Railway)
- **Notifications:** Telegram Bot API

---

## 🚀 Getting Started

### Prerequisites
- A PostgreSQL database (Railway recommended).
- A Polymarket account for API access (optional).
- Python 3.10+ and Node.js 18+.

### Installation
```bash
# Set up the Python Bot
cd bot
pip install -r requirements.txt
python main.py
