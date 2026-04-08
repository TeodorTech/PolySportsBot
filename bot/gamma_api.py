import requests
import json
from config import GAMMA_API_URL, DATA_API_URL, SPORTS_TAG_ID, MIN_EVENT_VOLUME

# Tag IDs that are too generic to use as a sport label
_GENERIC_TAG_IDS = {1, 100639}  # "Sports", "Games"

# Preferred label priority: higher = more specific/recognisable
# Any label not listed gets priority 0
_LABEL_PRIORITY = {
    # Leagues / organisations (most specific)
    'nfl': 10, 'nba': 10, 'mlb': 10, 'nhl': 10, 'nascar': 10,
    'pga': 10, 'ufc': 10, 'mma': 10,
    'premier league': 10, 'champions league': 10, 'la liga': 10,
    'serie a': 10, 'bundesliga': 10, 'ligue 1': 10,
    'indian premier league': 10,
    'esports': 9, 'counter strike 2': 9, 'league of legends': 9,
    # Generic sport names (less specific but still useful)
    'basketball': 5, 'football': 5, 'soccer': 5, 'baseball': 5,
    'hockey': 5, 'tennis': 5, 'golf': 5, 'cricket': 5, 'rugby': 5,
    'boxing': 5, 'racing': 5,
}

class GammaAPI:
    """Client for interacting with the Polymarket Gamma API."""
    
    @staticmethod
    def fetch_events(offset: int = 0, limit: int = 100) -> list[dict]:
        """Fetch one page of active sports events ordered by volume."""
        params = {
            "tag_id": SPORTS_TAG_ID,
            "related_tags": "true",
            "active": "true",
            "closed": "false",
            "order": "volume",
            "ascending": "false",
            "offset": offset,
            "limit": limit,
        }
        response = requests.get(f"{GAMMA_API_URL}/events", params=params)
        response.raise_for_status()
        return response.json()

    @classmethod
    def fetch_all_sports_events(cls) -> list[dict]:
        """
        Page through sports events and return only those
        with volume >= MIN_EVENT_VOLUME.
        """
        all_events: list[dict] = []
        limit = 100
        offset = 0

        print(f"[GAMMA API] Fetching from {GAMMA_API_URL}...")

        while True:
            page = cls.fetch_events(offset=offset, limit=limit)
            if not page:
                break

            all_events.extend(page)
            last_volume = float(page[-1].get("volume") or 0)

            if last_volume < MIN_EVENT_VOLUME or len(page) < limit:
                break

            offset += limit

        filtered = [
            e for e in all_events
            if float(e.get("volume") or 0) >= MIN_EVENT_VOLUME
        ]
        return filtered

    @staticmethod
    def fetch_event_details(event_id: str) -> dict:
        """Fetch details for a single event by ID."""
        response = requests.get(f"{GAMMA_API_URL}/events/{event_id}")
        response.raise_for_status()
        return response.json()


def extract_sport_label(event: dict) -> str:
    """
    Extract the most specific sport label from an event's tags array.
    Skips generic tags (id 1 = 'Sports', id 100639 = 'Games') and picks
    the label with the highest known priority, falling back to 'Sports'.
    """
    tags = event.get("tags") or []
    best_label = None
    best_priority = -1

    for tag in tags:
        tag_id = tag.get("id")
        if tag_id in _GENERIC_TAG_IDS:
            continue
        label = (tag.get("label") or "").strip()
        if not label:
            continue
        priority = _LABEL_PRIORITY.get(label.lower(), 0)
        if priority > best_priority:
            best_priority = priority
            best_label = label

    return best_label or "Sports"


def build_lookup_tables(events: list[dict]):
    """
    Build lookup dicts keyed by CLOB token ID.
    Returns:
        token_to_event, token_to_market, token_to_mktid,
        event_to_volume, token_to_start_time, token_to_outcome,
        token_to_event_id, token_to_sport
    """
    token_to_event = {}
    token_to_market = {}
    token_to_mktid = {}
    event_to_volume = {}
    token_to_start_time = {}
    token_to_outcome = {}
    token_to_event_id = {}
    token_to_sport = {}

    for event in events:
        markets = event.get("markets", [])
        if not markets:
            continue

        event_name = event.get("title") or event.get("slug") or "N/A"
        event_id = str(event.get("id"))
        volume = float(event.get("volume") or 0)
        sport = extract_sport_label(event)
        event_to_volume[event_name] = volume

        event_token_count = 0
        for market in markets:
            # Filter for Moneyline markets ONLY.
            # Skip markets that are clearly Spreads, Totals, or Over/Unders.
            group_title = (market.get("groupItemTitle") or "").lower()
            question = (market.get("question") or "").lower()

            is_non_moneyline = any(x in group_title or x in question
                                  for x in ["spread", "total", "handicap", "over", "under", "more than", "less than"])

            # Also catch things like "Chiefs -3.5" or "Over 44.5"
            if ".5" in question or ".5" in group_title:
                is_non_moneyline = True

            if is_non_moneyline:
                continue

            market_id = str(market.get("id", "N/A"))
            market_name = market.get("groupItemTitle") or market.get("question") or "N/A"
            
            # Token IDs
            clob_raw = market.get("clobTokenIds")
            if isinstance(clob_raw, str):
                try:
                    clob_ids = json.loads(clob_raw)
                except json.JSONDecodeError:
                    clob_ids = [clob_raw]
            elif isinstance(clob_raw, list):
                clob_ids = clob_raw
            else:
                clob_ids = []

            # Outcomes
            outcomes_raw = market.get("outcomes")
            if isinstance(outcomes_raw, str):
                try:
                    outcomes = json.loads(outcomes_raw)
                except json.JSONDecodeError:
                    outcomes = []
            elif isinstance(outcomes_raw, list):
                outcomes = outcomes_raw
            else:
                outcomes = []

            start_time = event.get("startTime") or event.get("startDate")

            for i, token_id in enumerate(clob_ids):
                token_to_event[token_id] = event_name
                token_to_market[token_id] = market_name
                token_to_mktid[token_id] = market_id
                token_to_event_id[token_id] = event_id
                token_to_sport[token_id] = sport
                if start_time:
                    token_to_start_time[token_id] = start_time
                if i < len(outcomes):
                    token_to_outcome[token_id] = str(outcomes[i])
                event_token_count += 1

        # Debug: log all events and their token counts
        if event_token_count == 0:
            print(f"[EVENT] ⚠️  {event_name} (${volume:,.0f}) - 0 moneyline tokens (filtered out)")
        else:
            print(f"[EVENT] ✓ {event_name} (${volume:,.0f}) - {event_token_count} moneyline tokens")

    return (token_to_event, token_to_market, token_to_mktid,
            event_to_volume, token_to_start_time, token_to_outcome,
            token_to_event_id, token_to_sport)

