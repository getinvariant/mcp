// Live BTC/USD price via CoinGecko. Invariant intercepts this fetch and
// routes to whichever finance:price:crypto provider wins (coingecko, binance).

export async function btcUsd() {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  );
  const data = await res.json();
  const price = data?.bitcoin?.usd;
  if (typeof price !== "number") {
    throw new Error("could not read BTC/USD price from response");
  }
  return price;
}
