# Skin Decode

1. Install Node 18+ (nodejs.org).
2. Copy `.env.example` to `.env` and paste your Anthropic API key (console.anthropic.com).
3. Run `node server.js` and open http://localhost:3000

The key stays on the server and never reaches the browser. If the key is missing or the AI is unreachable, the chatbot automatically falls back to its built-in answers.
Deploy to any Node host (Render, Railway, Fly.io): set `ANTHROPIC_API_KEY` as an environment variable and use `node server.js` as the start command.
Do not upload `.env` anywhere public.

## Product photos
Photos are not bundled (they belong to the brands). Add your own to `images/` and `images/products/`; names are listed in the README.txt files there. Missing photos fall back to a brand-name tile, so the site never shows a broken image.
