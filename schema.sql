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
