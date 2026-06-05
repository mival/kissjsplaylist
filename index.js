import dotenv from 'dotenv';
import fetch from 'node-fetch';
import cheerio from 'cheerio';
import SpotifyWebApi from 'spotify-web-api-node';
import PQueue from 'p-queue';
import buffer from 'buffer';
import express from 'express';

dotenv.config();

const PORT = process.env.PORT || 5000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:5000/spotify';

global.Buffer = global.Buffer || buffer.Buffer;
const sanityRegex = /[&']/g;

const scopes = ['playlist-modify-private'];

const spotifyApi = new SpotifyWebApi({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectUri: REDIRECT_URI
});

const search = item => {
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

const loadPlaylist = (source = "kiss") => {
  if (source === "hitradio") {
    return fetch('https://hitradio.cz/playlist/hitradio-city_1/1').then(res => res.text())
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
    return fetch('https://www.kiss.cz/playlist/vcera.html').then(res => res.text())
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
  } else if (source === "evropa") {
    const date = new Date();
    // yesterday
    date.setDate(date.getDate() - 1);

    return fetch(`https://www.evropa2.cz/playlist?playDay=${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`).then(res => res.text())
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
  } else {
    return Promise.reject('unknown source');
  }
};

const checkLogin = () => {
  return !!spotifyApi.getAccessToken();
};

const chunks = (array, size) => {
  var results = [];
  while (array.length) {
    results.push(array.splice(0, size));
  }
  return results;
};

const app = express();


app.get('/', (req, res) => {
  const type = req.query.type;
  loadPlaylist(type).then(data => {
    console.log('count', data.length);
    res.status(200).json(data);
  }, e => {
    res.status(500).render(e);
  });
});


app.get('/login', (req, res) => {
  const type = req.query.type || 'kiss';
  res.redirect(spotifyApi.createAuthorizeURL(scopes, type));
});

app.get('/spotify', (req, res) => {
  const token = req.query.code;
  const type = req.query.state || 'kiss';
  if (!checkLogin() && !token) {
    res.redirect('/login');
    return;
  }

  spotifyApi.authorizationCodeGrant(token).then(data => {
    console.log('The token expires in ' + data.body['expires_in']);
    console.log('The access token is ' + data.body['access_token']);
    console.log('The refresh token is ' + data.body['refresh_token']);

    // Set the access token on the API object to use it in later calls
    spotifyApi.setAccessToken(data.body['access_token']);
    spotifyApi.setRefreshToken(data.body['refresh_token']);



    loadPlaylist(type).then(items => {
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

      const trackIds = [];
      const queue = new PQueue({ concurrency: 1 });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.write('<table><thead><tr><th>Artist</th><th>Name</th><tr></thead><tbody>');
      items.forEach(item => {
        console.log('processing', item);
        queue.add(() => {
          return search(item).then(trackItem => {
            trackIds.push(trackItem.uri);
            console.log('completed', item);
            res.write(`<tr><td>${item.author}</td><td>${item.name}</td></tr>`);
          }, e => {
            console.error('queue item error', e);
            res.status(500).send(e);
          });
        });
      });
      queue.onIdle().then(() => {
        console.log('All work is done');
        const tracks = trackIds.filter(function (n) { return n != undefined });
        const queue = new PQueue({ concurrency: 1 });
        const timeNow = new Date();
        const yesterday = new Date(timeNow.setDate(timeNow.getDate() - 1));

        spotifyApi.createPlaylist(`${namePrefix} ${yesterday.getFullYear()}-${yesterday.getMonth() + 1}-${yesterday.getDate()}`, { 'public': false }).then(data => {
          const playlistId = data.body.id;
          console.log('new playlist', playlistId);
          chunks(tracks, 50).forEach(chunk => {
            queue.add(() => spotifyApi.addTracksToPlaylist(playlistId, chunk).then(() => {
              console.log('success added track chunk');
            }, e => {
              console.error('search error', e);
              res.status(500).send(e);
            }));
          });
        });

        queue.onIdle().then(() => {
          console.log('success');
          res.write('</tbody></table>');
          res.end();
        }, e => {
          console.error('queue error', e);
          res.status(500).send(e);
        });

      }, e => {
        console.error('queue error', e);
        res.status(500).send(e);
      });
    }, e => {
      console.error('playlist error', e);
      res.status(500).send(e);
    });
  }, e => {
    console.error('login error', e);
    res.status(500).send(e);
  });
});

app.listen(PORT, () => console.log(`Listening on port ${PORT}!`));
