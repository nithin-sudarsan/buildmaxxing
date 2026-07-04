# BuildMaxxing

AI concierge for finding London cafes and third spaces that are good to work from.

## What is built

- Home search and filter UI with 20 seed London workcafes
- Map-first home UI with Google Maps pins and a collapsible cafe sidebar
- Main-screen concierge prompt with OpenRouter ranked recommendations
- In-map cafe detail modal enriched from Google Places details, photos, hours, ratings, and reviews
- Work score calculation across WiFi, plugs, seating, noise, calls, and laptop friendliness
- `/feedback` natural-language feedback extraction
- OpenRouter support with deterministic fallbacks
- Local generated cafe imagery under `public/workcafes`

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Optional AI env

The app works without keys. To use OpenRouter instead of deterministic fallbacks:

```bash
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=openai/gpt-4o-mini
NEXT_PUBLIC_SITE_URL=http://localhost:3000
GOOGLE_MAPS_API_KEY=your_server_google_maps_key_here
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key_here
```

Without `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, the home screen uses a local dark-map fallback so the demo still works. `GOOGLE_MAPS_API_KEY` is optional locally because the server detail route can fall back to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

## API routes

- `POST /api/agent/concierge`
- `POST /api/agent/feedback`
- `POST /api/agent/work-buddy`
- `GET /api/cafes/[id]`
- `GET /api/places/photo`

## Checks

```bash
npm run lint
npm run build
```
