# kissjsplaylist

Node.js service that grabs a radio playlist for a selected date and creates a private Spotify playlist from it.
The default date is yesterday.

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
SESSION_SECRET=a_long_random_string
```

`SESSION_SECRET` signs the session cookie.
If you do not set it, the server makes a random secret at start, and all sessions end when the server stops.

In your Spotify app settings, make sure `REDIRECT_URI` is registered exactly (for local use: `http://localhost:5000/spotify`).

## Run

```bash
npm start
```

Server starts on `PORT` (default `5000`).

## Endpoints

- `GET /`:
	Returns the HTML page from `public/index.html`.

- `GET /index.json`:
	Returns parsed playlist items as JSON.
	Query params:
	- `type=kiss|hitradio|evropa`
	- `date=YYYY-MM-DD` (default: yesterday)

	Example:

	```bash
	curl "http://localhost:5000/index.json?type=evropa&date=2026-06-05"
	```

- `GET /login`:
	Starts Spotify OAuth flow.
	If the session already has a Spotify token, it redirects to `/playlist`.
	Query params: `type=kiss|hitradio|evropa` and `date=YYYY-MM-DD` (stored in OAuth state)

	Example:

	```bash
	http://localhost:5000/login?type=evropa&date=2026-06-05
	```

- `GET /spotify`:
	OAuth callback endpoint. It saves the Spotify token in the session and redirects to `/playlist`.

- `GET /playlist`:
	Creates the playlist. Query params: `type` and `date`, as in `/index.json`.
	If the session has no Spotify token, it redirects to `/login`.
	This endpoint:
	- loads playlist from selected source for the selected date,
	- searches tracks on Spotify,
	- creates a private playlist named like `KissJC 2026-6-5`, `Evropa 2026-6-5`, etc.,
	- adds matched tracks,
	- streams an HTML page with a table as progress output,
	- shows a link to the new playlist on Spotify.

- `GET /logout`:
	Removes the Spotify token from the session.

## Notes

- The server keeps the Spotify token only in a session cookie.
	The browser removes the cookie when the browser session ends.
	Users do not share tokens.

- Each source keeps its playlist for a different number of days:
	- `kiss`: today and yesterday.
	- `hitradio`: today and up to 2 days back.
	- `evropa`: today and up to 7 days back.
- The playlist name uses the selected date.

- Track matching uses a simple `track:<name> artist:<author>` search query.
- Single quotes and `&` are removed from search terms for basic sanitization.
- Not every track is guaranteed to be found on Spotify.

## Deployment

This repo includes a `Procfile`, so it can be deployed on platforms that support Procfile-based Node apps.

Set the same environment variables in your deployment environment.
To make a session secret, use:

```bash
openssl rand -hex 32
```

## Troubleshooting

- `date not available for <source>`: select a date in the range of that source (see "Notes").
- `unknown source`: ensure `type` is one of `kiss`, `hitradio`, or `evropa`.
- Spotify OAuth errors: check `CLIENT_ID`, `CLIENT_SECRET`, and exact redirect URI match.
- Empty or partial playlists: source site markup may have changed or tracks may not exist on Spotify.
