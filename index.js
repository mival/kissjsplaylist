require('dotenv').config();
const PORT = process.env.PORT || 5000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const fetch = require('node-fetch');
const RSVP = require('rsvp');
const cheerio = require('cheerio');
const rp = require('request-promise');
const SpotifyWebApi = require('spotify-web-api-node');
global.Buffer = global.Buffer || require('buffer').Buffer;
const sanityRegex = /[&']/g;

const spotifyApi = new SpotifyWebApi({
  clientId : CLIENT_ID,
  clientSecret : CLIENT_SECRET,
  redirectUri : 'https://kissjc-playlist.herokuapp.com/callback'
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

const authorize = () => {
  const options = {
    method: 'POST',
    url: 'https://accounts.spotify.com/api/token',
    headers:
    {
      'Cache-Control': 'no-cache',
      'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, 'binary').toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded' },
    form: { grant_type: 'client_credentials' }
  };

  return rp(options).then(data => {
    return JSON.parse(data).access_token;
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

// const run = () => {
//   return new RSVP.Promise(resolve => {
//     loadPlaylist().then(items => {
//       items = (items.slice(0,2));
//       authorize().then(token => {
//         spotifyApi.setAccessToken(token);
//         RSVP.all(items.map(item => search(item))).then(data => {
//           console.log(data);
//           console.log(data.map(item => item.uri))
//     //       spotifyApi.addTracksToPlaylist('mival1234', '3ca9AxafpbLDOqhnvvDIkf', ["spotify:track:4iV5W9uYEdYUVa79Axb7Rh", "spotify:track:1301WleyT98MSxVHPZCA6M"]).then(data=>{
//     //         console.log(data);
//     //       }, e => {
//     // console.error(e);
//     //       })
//     resolve(data);
//         })
//       });
//     });
//   });
// }


const express = require('express');
const app = express();


app.get('/', (req, res) => {
  loadPlaylist().then(data => {
    res.status(200).json(data);
  });
});

app.get('/spotify', (req, res) => {
  let limit = req.query.limit || 3;
  if (limit > 10) {
    limit = 10;
  }

  loadPlaylist().then(items => {
    items = items.slice(0, limit);
    authorize().then(token => {
      spotifyApi.setAccessToken(token);
      RSVP.all(items.map(item => search(item))).then(data => {
        res.status(200).json(data);
      });
    });
  });
});

app.listen(PORT, () => console.log(`Listening on port ${PORT}!`));
