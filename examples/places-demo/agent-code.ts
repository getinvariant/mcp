// Code a coding agent would write — geocode an address via Geoapify.
// We do NOT import Invariant SDK here. fetch is patched at process startup.

export async function geocodeAddresses(text: string): Promise<Response> {
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(text)}&apiKey=YOUR_KEY_HERE`;
  return await fetch(url);
}
