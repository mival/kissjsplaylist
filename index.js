require('dotenv').config();
const PORT = process.env.PORT || 5000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const fetch = require('node-fetch');
const RSVP = require('rsvp');
const cheerio = require('cheerio');
const SpotifyWebApi = require('spotify-web-api-node');
const PQueue = require('p-queue');

global.Buffer = global.Buffer || require('buffer').Buffer;
const sanityRegex = /[&']/g;

const scopes = ['playlist-modify-private'];

const spotifyApi = new SpotifyWebApi({
  clientId : CLIENT_ID,
  clientSecret : CLIENT_SECRET,
  redirectUri : 'https://kissjc-playlist.herokuapp.com/spotify',
  // redirectUri : 'http://192.168.0.198:5000/spotify',
});

const search = item => {
  return spotifyApi.searchTracks(`track:${item.name.replace(sanityRegex,'')} artist:${item.author.replace(sanityRegex,'')}`)
  .then(function(data) {
    const items = data.body.tracks.items;
    if (items.length>0) {
      // const tractURL = items.map(item => item.external_urls.spotify)[0];
      item['trackUrl'] = items[0].external_urls.spotify;
      item['uri'] = items[0].uri;
    }
    return item;
  });
};

const loadPlaylist = () => {
  return fetch('https://www.kiss.cz/playlist/dnes.html').then(res => res.text())
    .then(body => {
      const $ = cheerio.load(body);
      // <span class="eventEvent pull-left"> <span>BOB SINCLAIR &amp; GARRY PINE</span> LOVE GENERATION </span>
      const data = [];
      $('.event_widget .eventEvent').each((index, item) => {
        const arr =  $(item).text().replace(/^\s+|\s+$/gm,'').split('\n');
        data.push({index, author: arr[0].toLowerCase(), name: arr[1].toLowerCase()});
      });
      return data;
    });
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

const express = require('express');
const app = express();


app.get('/', (req, res) => {
  loadPlaylist().then(data => {
    console.log('count', data.length);
    res.status(200).json(data);
  }, e => {
    res.status(500).render(e);
  });
});


app.get('/login', (req, res) => {
  res.redirect(spotifyApi.createAuthorizeURL(scopes, 'login-state'));
});

app.get('/spotify', (req, res) => {
  const token = req.query.code;
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



    loadPlaylist().then(items => {
      console.log('search count', items.length);
      const trackIds = [];
      const queue = new PQueue({concurrency: 1});
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
        const tracks = trackIds.filter(function(n){ return n != undefined });
        const queue = new PQueue({concurrency: 1});
        const timeNow = new Date();

        spotifyApi.createPlaylist('mival1234', `KissJC ${timeNow.getFullYear()}-${timeNow.getMonth()+1}-${timeNow.getDate()}`, { 'public' : false }).then(data => {
          const playlistId = data.body.id;
          console.log('new playlist', playlistId);
          chunks(tracks, 50).forEach(chunk => {
            queue.add(() => spotifyApi.addTracksToPlaylist('mival1234', playlistId, chunk).then(() => {
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


      // RSVP.all(items.map(item => )).then(data => {

      // }, e => {
      //   console.error('search error', e);
      //   res.status(500).send(e);
      // });
    // }, e => {
    //   console.error('load error', e);
    //   res.status(500).send(e);
    // });

  }, e => {
    console.error('login error', e);
    res.status(500).send(e);
  });
});

app.listen(PORT, () => console.log(`Listening on port ${PORT}!`));
