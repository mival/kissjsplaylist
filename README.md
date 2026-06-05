# kissjsplaylist

Node.js service that grabs yesterday's radio playlist and creates a private Spotify playlist from it.

Supported sources:
- `kiss` (default)
- `hitradio`
- `evropa`

## What it does

1. Downloads playlist data from a selected radio website.
2. Searches each song on Spotify.
3. Creates a private playlist in your Spotify account.
4. Adds found tracks

## Requirements

- Node.js 18+
- Spotify developer app credentials

## Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file in the project root:

```env
PORT=5000
CLIENT_ID=your_spotify_client_id
CLIENT_SECRET=your_spotify_client_secret
REDIRECT_URI=http://localhost:5000/spotify
```

In your Spotify app settings, make sure `REDIRECT_URI` is registered exactly (for local use: `http://localhost:5000/spotify`).

## Run

```bash
npm start
```

Server starts on `PORT` (default `5000`).

## Endpoints

- `GET /`:
	Returns parsed playlist items as JSON.
	Query param: `type=kiss|hitradio|evropa`

	Example:

	```bash
	curl "http://localhost:5000/?type=kiss"
	```

- `GET /login`:
	Starts Spotify OAuth flow.
	Query param: `type=kiss|hitradio|evropa` (stored in OAuth state)

	Example:

	```bash
	http://localhost:5000/login?type=evropa
	```

- `GET /spotify`:
	OAuth callback endpoint. After Spotify login, this endpoint:
	- loads playlist from selected source,
	- searches tracks on Spotify,
	- creates a private playlist named like `KissJC 2026-6-5`, `Evropa 2026-6-5`, etc.,
	- adds matched tracks,
	- streams a simple HTML table as progress output.

## Notes

- Track matching uses a simple `track:<name> artist:<author>` search query.
- Single quotes and `&` are removed from search terms for basic sanitization.
- Not every track is guaranteed to be found on Spotify.

## Deployment

This repo includes a `Procfile`, so it can be deployed on platforms that support Procfile-based Node apps.

Set the same environment variables in your deployment environment.

## Troubleshooting

- `unknown source`: ensure `type` is one of `kiss`, `hitradio`, or `evropa`.
- Spotify OAuth errors: check `CLIENT_ID`, `CLIENT_SECRET`, and exact redirect URI match.
- Empty or partial playlists: source site markup may have changed or tracks may not exist on Spotify.
