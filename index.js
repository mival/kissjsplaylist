import dotenv from 'dotenv';
import fetch from 'node-fetch';
import cheerio from 'cheerio';
import SpotifyWebApi from 'spotify-web-api-node';
import PQueue from 'p-queue';
import buffer from 'buffer';
import express from 'express';
import cookieSession from 'cookie-session';
import crypto from 'crypto';
import { escapeHtml, layoutStart, layoutEnd, message } from './layout.js';

dotenv.config();

const PORT = process.env.PORT || 5000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:5000/spotify';
const SESSION_SECRET = process.env.SESSION_SECRET;

global.Buffer = global.Buffer || buffer.Buffer;
const sanityRegex = /[&']/g;

const scopes = ['playlist-modify-private'];

// Each request gets its own API object, so users do not share tokens.
const createSpotifyApi = (session = {}) => new SpotifyWebApi({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectUri: REDIRECT_URI,
  accessToken: session.accessToken,
  refreshToken: session.refreshToken
});

const saveTokens = (session, body) => {
  session.accessToken = body['access_token'];
  if (body['refresh_token']) {
    session.refreshToken = body['refresh_token'];
  }
  // Refresh the token 1 minute before it expires.
  session.expiresAt = Date.now() + (body['expires_in'] - 60) * 1000;
};

// Returns an API object with a valid token, or null if the user must log in.
const getSpotifyApi = req => {
  const session = req.session;
  if (!session.accessToken) {
    return Promise.resolve(null);
  }
  const api = createSpotifyApi(session);
  if (Date.now() < session.expiresAt) {
    return Promise.resolve(api);
  }
  return api.refreshAccessToken().then(data => {
    saveTokens(session, data.body);
    api.setAccessToken(session.accessToken);
    return api;
  }, e => {
    console.error('refresh token error', e);
    req.session = null;
    return null;
  });
};

const search = (spotifyApi, item) => {
  return spotifyApi.searchTracks(`track:${item.name.replace(sanityRegex, '')} artist:${item.author.replace(sanityRegex, '')}`)
    .then(function (data) {
      const items = data.body.tracks.items;
      if (items.length > 0) {
        // const tractURL = items.map(item => item.external_urls.spotify)[0];
        item['trackUrl'] = items[0].external_urls.spotify;
        item['uri'] = items[0].uri;
      }
      return item;
    });
};

// Number of days back that each source can load. 0 is today.
const maxDaysBack = {
  kiss: 1,
  hitradio: 2,
  evropa: 7
};

const formatDate = date => {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
};

const yesterday = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return formatDate(date);
};

const daysBack = date => {
  return Math.round((Date.parse(formatDate(new Date())) - Date.parse(date)) / (24 * 60 * 60 * 1000));
};

const loadPlaylist = (source = "kiss", date = yesterday()) => {
  if (!(source in maxDaysBack)) {
    return Promise.reject('unknown source');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
    return Promise.reject('incorrect date');
  }
  const days = daysBack(date);
  if (days < 0 || days > maxDaysBack[source]) {
    return Promise.reject(`date not available for ${source}`);
  }

  if (source === "hitradio") {
    return fetch(`https://hitradio.cz/playlist/hitradio-city_1/${days}`).then(res => res.text())
      .then(body => {
        const $ = cheerio.load(body);
        const data = [];
        $('.web-container .component-card-playlist').get().reverse().forEach((item, index) => {
          const author = $(item).find('.artist').text().replace(/^\s+|\s+$/gm, '').toLowerCase();
          const name = $(item).find('.song').text().replace(/^\s+|\s+$/gm, '').toLowerCase();
          const time = $(item).find('.broadcast-at').text().replace(/^\s+|\s+$/gm, '');
          data.push({ index, author, name, time });
        });
        return data;
      });
  } else if (source === "kiss") {
    return fetch(`https://www.kiss.cz/playlist/${days === 0 ? 'dnes' : 'vcera'}.html`).then(res => res.text())
      .then(body => {
        const $ = cheerio.load(body);
        // <span class="eventEvent pull-left"> <span>BOB SINCLAIR &amp; GARRY PINE</span> LOVE GENERATION </span>
        const data = [];
        $('.event_widget .event').get().reverse().forEach((item, index) => {
          const $item = $(item);
          const time = $item.find('.eventTime').text().replace(/^\s+|\s+$/gm, '');
          const arr = $(item).find('.eventEvent').text().replace(/^\s+|\s+$/gm, '').split('\n');
          data.push({ index, author: (arr[0] || "").toLowerCase(), name: (arr[1] || "").toLowerCase(), time});
        });
        return data;
      });
  } else {
    return fetch(`https://www.evropa2.cz/playlist?playDay=${date}`).then(res => res.text())
      .then(body => {
        const $ = cheerio.load(body);
        const data = [];
        const jsData = $('#__NEXT_DATA__').html();
        const parsedData = JSON.parse(jsData).props.pageProps.playlist.reverse();
        parsedData.forEach((item, index) => {
          const author = item.songArtist.toLowerCase();
          const name = item.songTitle.toLowerCase();
          const time = item.songStart.split(' ')[1];
          data.push({ index, author, name, time });
        });
        return data;
      });
  }
};

const chunks = (array, size) => {
  var results = [];
  while (array.length) {
    results.push(array.splice(0, size));
  }
  return results;
};

const app = express();

// A reverse proxy can end HTTPS. This lets Express see the request as secure.
app.set('trust proxy', 1);

if (!SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set. Sessions end when the server stops.');
}

// The cookie has no maxAge, so the browser removes it at the end of the session.
app.use(cookieSession({
  name: 'session',
  secret: SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production'
}));

app.use(express.static('public'));

app.get('/index.json', (req, res) => {
  const type = req.query.type;
  const date = req.query.date;
  loadPlaylist(type, date).then(data => {
    console.log('count', data.length);
    res.status(200).json(data);
  }, e => {
    res.status(500).json({ error: String(e) });
  });
});


const playlistUrl = (type, date) => `/playlist?${new URLSearchParams({ type, date })}`;

app.get('/login', (req, res) => {
  const type = req.query.type || 'kiss';
  const date = req.query.date || yesterday();
  getSpotifyApi(req).then(api => {
    if (api) {
      res.redirect(playlistUrl(type, date));
      return;
    }
    // Spotify sends the state back to the callback unchanged.
    // The library does not encode the state, so use only URL-safe characters.
    const state = `${type}_${date}`;
    res.redirect(createSpotifyApi().createAuthorizeURL(scopes, state));
  });
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

app.get('/spotify', (req, res) => {
  const code = req.query.code;
  const [type = 'kiss', date = yesterday()] = (req.query.state || '').split('_');
  if (!code) {
    res.redirect(`/login?${new URLSearchParams({ type, date })}`);
    return;
  }

  createSpotifyApi().authorizationCodeGrant(code).then(data => {
    console.log('The token expires in ' + data.body['expires_in']);
    saveTokens(req.session, data.body);
    res.redirect(playlistUrl(type, date));
  }, e => {
    console.error('login error', e);
    sendError(res, e);
  });
});

app.get('/playlist', (req, res) => {
  const type = req.query.type || 'kiss';
  const date = req.query.date || yesterday();

  getSpotifyApi(req).then(spotifyApi => {
    if (!spotifyApi) {
      res.redirect(`/login?${new URLSearchParams({ type, date })}`);
      return;
    }

    loadPlaylist(type, date).then(items => {
      console.log('search count', items.length);
      let namePrefix = 'KissJC';

      switch (type) {
        case 'hitradio':
          namePrefix = 'HitradioCity';
          break;
        case 'evropa':
          namePrefix = 'Evropa2';
          break;
      }

      // Keep the old name format without leading zeros, for example "KissJC 2026-6-5".
      const playlistDate = date.split('-').map(Number).join('-');
      const playlistName = `${namePrefix} ${playlistDate}`;

      const trackIds = [];
      const queue = new PQueue({ concurrency: 1 });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.write(layoutStart(playlistName));
      res.write(message(`Hledám skladby na Spotify (počet: ${items.length}) a vytvářím playlist <strong>${escapeHtml(playlistName)}</strong>…`));
      res.write(`<div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="bg-slate-100 text-slate-600">
          <tr>
            <th class="px-4 py-2 font-medium">Čas</th>
            <th class="px-4 py-2 font-medium">Interpret</th>
            <th class="px-4 py-2 font-medium">Skladba</th>
            <th class="px-4 py-2 font-medium">Spotify</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">`);
      res.locals.tableOpen = true;
      items.forEach(item => {
        console.log('processing', item);
        queue.add(() => {
          return search(spotifyApi, item).then(trackItem => {
            console.log('completed', item);
            if (trackItem.uri) {
              trackIds.push(trackItem.uri);
            }
            const found = trackItem.trackUrl
              ? `<a href="${escapeHtml(trackItem.trackUrl)}" class="text-green-700 hover:underline">nalezeno</a>`
              : '<span class="text-slate-400">nenalezeno</span>';
            res.write(`<tr class="hover:bg-slate-50"><td class="px-4 py-2">${escapeHtml(item.time)}</td><td class="px-4 py-2 capitalize">${escapeHtml(item.author)}</td><td class="px-4 py-2 capitalize">${escapeHtml(item.name)}</td><td class="px-4 py-2">${found}</td></tr>`);
          }, e => {
            // One failed search does not stop the playlist.
            console.error('queue item error', e);
            res.write(`<tr><td class="px-4 py-2">${escapeHtml(item.time)}</td><td class="px-4 py-2 capitalize">${escapeHtml(item.author)}</td><td class="px-4 py-2 capitalize">${escapeHtml(item.name)}</td><td class="px-4 py-2 text-red-700">chyba</td></tr>`);
          });
        });
      });

      return queue.onIdle().then(() => {
        console.log('All work is done');
        res.write('</tbody></table></div>');
        res.locals.tableOpen = false;
        return spotifyApi.createPlaylist(playlistName, { 'public': false });
      }).then(data => {
        const playlistId = data.body.id;
        const playlistUrl = data.body.external_urls.spotify;
        console.log('new playlist', playlistId);
        const addQueue = new PQueue({ concurrency: 1 });
        chunks([...trackIds], 50).forEach(chunk => {
          addQueue.add(() => spotifyApi.addTracksToPlaylist(playlistId, chunk).then(() => {
            console.log('success added track chunk');
          }));
        });
        return addQueue.onIdle().then(() => playlistUrl);
      }).then(playlistUrl => {
        console.log('success');
        res.write(`<div class="mt-6">${message(`Hotovo. Playlist <strong>${escapeHtml(playlistName)}</strong> je vytvořený. Nalezené skladby: ${trackIds.length} z ${items.length}. <a href="${escapeHtml(playlistUrl)}" class="font-medium underline">Otevřít na Spotify</a>`, 'success')}</div>`);
        res.write('<p class="text-sm"><a href="/" class="text-green-700 hover:underline">Zpět na úvodní stránku</a> · <a href="/logout" class="text-slate-500 hover:underline">Odhlásit ze Spotify</a></p>');
        res.write(layoutEnd());
        res.end();
      });
    }).catch(e => {
      console.error('playlist error', e);
      sendError(res, e);
    });
  });
});

// Show the error in the page layout. If the page is already streaming, add the error to its end.
const sendError = (res, e) => {
  const text = `Playlist se nepodařilo vytvořit: ${escapeHtml(e && e.message ? e.message : e)}`;
  if (!res.headersSent) {
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.write(layoutStart('Chyba'));
  } else if (res.locals.tableOpen) {
    res.write('</tbody></table></div>');
  }
  res.write(`<div class="mt-6">${message(text, 'error')}</div>`);
  res.write(`<a href="/" class="text-green-700 hover:underline">Zpět na úvodní stránku</a>`);
  res.write(layoutEnd());
  res.end();
};

app.listen(PORT, () => console.log(`Listening on port ${PORT}!`));
