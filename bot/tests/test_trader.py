"""
Unit tests for the most critical trader logic.
Run with: python -m pytest tests/test_trader.py -v
"""
import sys
import os
import pytest
from unittest.mock import MagicMock, patch

# Allow imports from bot/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_event_data(outcomes, clob_ids, start_time=None, active=True):
    """Build a minimal Gamma API event payload."""
    import json
    return {
        "startTime": start_time,
        "markets": [
            {
                "outcomes": json.dumps(outcomes),
                "clobTokenIds": json.dumps(clob_ids),
                "active": active,
            }
        ],
    }


# ---------------------------------------------------------------------------
# 1. FOK response parsing — order_id is only returned on a confirmed fill
# ---------------------------------------------------------------------------

class TestFOKResponseParsing:
    """place_trade should return order_id only when status is matched/filled/mev."""

    def _call_place_trade(self, resp: dict):
        """
        Invoke just the response-parsing logic from place_trade by mocking
        everything up to post_order.
        """
        mock_client = MagicMock()
        mock_client.get_balance_allowance.return_value = {"balance": str(100 * 1_000_000)}
        mock_client.create_market_order.return_value = MagicMock()
        mock_client.post_order.return_value = resp

        with patch.dict(os.environ, {"POLY_PRIVATE_KEY": "0xdeadbeef"}):
            from trader import place_trade
            return place_trade(mock_client, "token123", 0.55, 5.0)

    def test_matched_status_returns_order_id(self):
        order_id, _ = self._call_place_trade({"orderID": "abc123", "status": "matched"})
        assert order_id == "abc123"

    def test_filled_status_returns_order_id(self):
        order_id, _ = self._call_place_trade({"orderID": "abc123", "status": "filled"})
        assert order_id == "abc123"

    def test_mev_status_returns_order_id(self):
        order_id, _ = self._call_place_trade({"orderID": "abc123", "status": "mev"})
        assert order_id == "abc123"

    def test_fill_price_from_response(self):
        order_id, price = self._call_place_trade({"orderID": "abc123", "status": "matched", "price": "0.62"})
        assert order_id == "abc123"
        assert price == 0.62

    def test_fill_price_falls_back_to_best_ask(self):
        order_id, price = self._call_place_trade({"orderID": "abc123", "status": "matched"})
        assert order_id == "abc123"
        assert price == 0.55  # best_ask passed into place_trade

    def test_cancelled_status_returns_none(self):
        order_id, price = self._call_place_trade({"orderID": "abc123", "status": "cancelled"})
        assert order_id is None
        assert price is None

    def test_empty_status_returns_none(self):
        order_id, price = self._call_place_trade({"orderID": "abc123", "status": ""})
        assert order_id is None

    def test_missing_order_id_returns_none(self):
        order_id, price = self._call_place_trade({"status": "matched"})
        assert order_id is None

    def test_empty_response_returns_none(self):
        order_id, price = self._call_place_trade({})
        assert order_id is None


# ---------------------------------------------------------------------------
# 2. Balance check — trade is skipped when balance is insufficient
# ---------------------------------------------------------------------------

class TestBalanceCheck:

    def _call_place_trade_with_balance(self, balance_usdc: float, amount_usd: float):
        mock_client = MagicMock()
        mock_client.get_balance_allowance.return_value = {
            "balance": str(int(balance_usdc * 1_000_000))
        }
        mock_client.create_market_order.return_value = MagicMock()
        mock_client.post_order.return_value = {"orderID": "abc123", "status": "matched"}

        with patch.dict(os.environ, {"POLY_PRIVATE_KEY": "0xdeadbeef"}):
            from trader import place_trade
            return place_trade(mock_client, "token123", 0.55, amount_usd)

    def test_sufficient_balance_places_trade(self):
        order_id, _ = self._call_place_trade_with_balance(balance_usdc=100.0, amount_usd=5.0)
        assert order_id == "abc123"

    def test_exact_balance_places_trade(self):
        order_id, _ = self._call_place_trade_with_balance(balance_usdc=5.0, amount_usd=5.0)
        assert order_id == "abc123"

    def test_insufficient_balance_returns_none(self):
        order_id, _ = self._call_place_trade_with_balance(balance_usdc=4.99, amount_usd=5.0)
        assert order_id is None


# ---------------------------------------------------------------------------
# 3. Token ID lookup — outcome label matching is case-insensitive
# ---------------------------------------------------------------------------

class TestGetTokenIdForOutcome:

    def _call(self, outcome_label: str, event_data: dict):
        with patch("trader.GammaAPI.fetch_event_details", return_value=event_data), \
             patch("trader.get_best_ask", return_value=0.60):
            from trader import get_token_id_for_outcome
            return get_token_id_for_outcome("event123", outcome_label)

    def test_exact_match_returns_token(self):
        data = make_event_data(["Jets", "Kraken"], ["token_jets", "token_kraken"])
        token_id, price = self._call("Jets", data)
        assert token_id == "token_jets"
        assert price == 0.60

    def test_case_insensitive_match(self):
        data = make_event_data(["Jets", "Kraken"], ["token_jets", "token_kraken"])
        token_id, price = self._call("jets", data)
        assert token_id == "token_jets"

    def test_second_outcome_matched_correctly(self):
        data = make_event_data(["Jets", "Kraken"], ["token_jets", "token_kraken"])
        token_id, price = self._call("Kraken", data)
        assert token_id == "token_kraken"

    def test_unknown_outcome_returns_none(self):
        data = make_event_data(["Jets", "Kraken"], ["token_jets", "token_kraken"])
        token_id, price = self._call("Lakers", data)
        assert token_id is None
        assert price is None

    def test_gamma_api_failure_returns_none(self):
        with patch("trader.GammaAPI.fetch_event_details", side_effect=Exception("timeout")):
            from trader import get_token_id_for_outcome
            token_id, price = get_token_id_for_outcome("event123", "Jets")
        assert token_id is None
        assert price is None


# ---------------------------------------------------------------------------
# 4. Dedup guard — already-traded events are skipped
# ---------------------------------------------------------------------------

class TestDedupGuard:

    def test_already_traded_event_is_skipped(self):
        qualifying = [
            {"event_id": "e1", "event_title": "Jets vs Kraken",
             "consensus_outcome": "Jets", "consensus_volume": 80_000}
        ]
        with patch("trader.get_qualifying_events", return_value=qualifying), \
             patch("trader.init_clob_client", return_value=MagicMock()), \
             patch("trader.Database.has_trade_for_event", return_value=True), \
             patch("trader.get_token_id_for_outcome") as mock_token, \
             patch("trader.place_trade") as mock_trade:
            from trader import run
            run()
            mock_token.assert_not_called()
            mock_trade.assert_not_called()

    def test_new_event_proceeds_to_trade(self):
        qualifying = [
            {"event_id": "e1", "event_title": "Jets vs Kraken",
             "consensus_outcome": "Jets", "consensus_volume": 80_000}
        ]
        with patch("trader.get_qualifying_events", return_value=qualifying), \
             patch("trader.init_clob_client", return_value=MagicMock()), \
             patch("trader.Database.has_trade_for_event", return_value=False), \
             patch("trader.get_token_id_for_outcome", return_value=("token_jets", 0.55)), \
             patch("trader.place_trade", return_value=("order_abc", 0.55)) as mock_trade, \
             patch("trader.Database.save_trade"), \
             patch("trader.Notifier.send_trade_alert"):
            from trader import run
            run()
            mock_trade.assert_called_once()

    def test_failed_trade_not_saved_to_db(self):
        qualifying = [
            {"event_id": "e1", "event_title": "Jets vs Kraken",
             "consensus_outcome": "Jets", "consensus_volume": 80_000}
        ]
        with patch("trader.get_qualifying_events", return_value=qualifying), \
             patch("trader.init_clob_client", return_value=MagicMock()), \
             patch("trader.Database.has_trade_for_event", return_value=False), \
             patch("trader.get_token_id_for_outcome", return_value=("token_jets", 0.55)), \
             patch("trader.place_trade", return_value=(None, None)), \
             patch("trader.Database.save_trade") as mock_save, \
             patch("trader.Notifier.send_trade_alert"):
            from trader import run
            run()
            mock_save.assert_not_called()
