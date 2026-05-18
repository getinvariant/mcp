Build a live crypto and stock price dashboard as a single self-contained HTML file.

Requirements:
- Track these 10 assets: BTC, ETH, SOL, DOGE, AAPL, TSLA, NVDA, AMZN, META, SPY
- For each asset, fetch the current price using the Invariant `route` tool with task_type "finance:price"
- Display a clean table: symbol | price | which provider was used | call number
- Auto-refresh every 30 seconds — call `route` for all 10 assets again on each refresh
- Show a "last updated" timestamp and a refresh countdown
- Save it as dashboard.html and open it in the browser

Fetch all 10 prices now to populate the initial table before showing it to me.
