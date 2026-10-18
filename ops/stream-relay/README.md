# Cicada continuous stream relay

Vercel Functions end live responses at their duration limit. `/api/stream-preview`
now redirects the browser to this Worker, which streams the upstream body directly.
Do not fetch this relay from a Vercel Function and pipe it back through that function.

The relay allows the catalog's existing public audio origins, checks redirects,
and imposes a 15-second connection deadline that is cleared once headers arrive.
It never imposes an audio-session deadline or buffers the entire response.
New providers require a reviewed allowlist entry in `src/index.js`.

From this directory: `npm ci`, `npm run build`, `cf deploy --prebuilt --dry-run`,
then `cf deploy --prebuilt`. Requires Node 22.18+ and cf authentication.
Run `npm run test:streams` at repository root before release. After release verify
an actual MP3 stream stays open beyond the previous function duration, and check
World Traveler switching and recovery in a browser. Source outages and network
interruptions still require the client's existing automatic reconnect behavior.
