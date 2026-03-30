DROP TABLE IF EXISTS whale_activity CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS signals CASCADE;

CREATE TABLE events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    total_volume DECIMAL(18, 2),
    whales_won BOOLEAN DEFAULT NULL,
    status TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE whale_activity (
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
