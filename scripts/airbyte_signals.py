#!/usr/bin/env python3
"""
Airbyte leading-signal ingestion (CLAUDE.md ADD — AIRBYTE).

Pulls each paid provider's public STATUS PAGE (Statuspage v2 summary.json) with
a PyAirbyte declarative HTTP source, maps the incident indicator to a health
factor in [0,1], and writes one row per provider into the ClickHouse
`provider_context` table. The bureau score (lib/ledger/clickhouse.ts SCORE_SQL)
multiplies each provider's creditworthiness by this health, so an active
incident docks the score BEFORE any of our own calls fail.

Why PyAirbyte: Airbyte has no ClickHouse PyAirbyte cache and no turnkey generic
HTTP source, so the legitimate path is a declarative-manifest HTTP source read
into a local cache, then a typed write to ClickHouse (per Airbyte docs).

Setup:
    python3 -m venv .venv && source .venv/bin/activate
    pip install airbyte clickhouse-connect python-dotenv
    python scripts/airbyte_signals.py

Reads CLICKHOUSE_URL / CLICKHOUSE_USER / CLICKHOUSE_PASSWORD / CLICKHOUSE_DATABASE
from .env (same as the Node app).
"""
import os
import sys
from urllib.parse import urlparse

try:
    import airbyte as ab  # PyAirbyte
except ImportError:
    sys.exit("pip install airbyte clickhouse-connect python-dotenv first")
import clickhouse_connect
from dotenv import load_dotenv

load_dotenv()

# Real Statuspage v2 summary endpoints for our paid map rivals.
# (Mapbox runs Statuspage; add others as they expose a status API.)
PROVIDER_STATUS = {
    "mapbox": "https://status.mapbox.com",
}

# Statuspage indicator -> leading-signal health factor.
INDICATOR_HEALTH = {
    "none": 1.0,
    "minor": 0.85,
    "major": 0.5,
    "critical": 0.2,
}


def build_source(base_url: str):
    """A declarative-manifest PyAirbyte HTTP source for one Statuspage."""
    manifest = {
        "version": "0.1.0",
        "type": "DeclarativeSource",
        "check": {"type": "CheckStream", "stream_names": ["status"]},
        "streams": [
            {
                "type": "DeclarativeStream",
                "name": "status",
                "retriever": {
                    "type": "SimpleRetriever",
                    "requester": {
                        "type": "HttpRequester",
                        "url_base": base_url,
                        "path": "/api/v2/summary.json",
                        "http_method": "GET",
                    },
                    "record_selector": {
                        "type": "RecordSelector",
                        "extractor": {"type": "DpathExtractor", "field_path": ["status"]},
                    },
                },
            }
        ],
    }
    return ab.get_source(
        "source-declarative-manifest",
        config={"__injected_declarative_manifest": manifest},
        install_if_missing=True,
    )


def clickhouse():
    url = urlparse(os.environ["CLICKHOUSE_URL"])
    secure = url.scheme == "https"
    return clickhouse_connect.get_client(
        host=url.hostname,
        port=url.port or (8443 if secure else 8123),
        username=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=os.environ.get("CLICKHOUSE_DATABASE", "default"),
        secure=secure,
    )


def main():
    ch = clickhouse()
    ch.command(
        """
        CREATE TABLE IF NOT EXISTS provider_context (
          ts DateTime64(3) DEFAULT now64(3), provider String, source String,
          status String, health Float64, note String
        ) ENGINE = MergeTree ORDER BY (provider, ts)
        """
    )

    rows = []
    for provider, base in PROVIDER_STATUS.items():
        src = build_source(base)
        src.check()
        src.select_all_streams()
        result = src.read()
        records = list(result["status"])
        indicator = (records[0].get("indicator") if records else "none") or "none"
        health = INDICATOR_HEALTH.get(indicator, 1.0)
        note = (records[0].get("description") if records else "") or ""
        print(f"{provider}: indicator={indicator} -> health={health} ({note})")
        rows.append([provider, "statuspage", indicator, health, note])

    if rows:
        ch.insert(
            "provider_context",
            rows,
            column_names=["provider", "source", "status", "health", "note"],
        )
        print(f"wrote {len(rows)} provider_context rows to ClickHouse")


if __name__ == "__main__":
    main()
