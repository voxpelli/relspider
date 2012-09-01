var express = require('express'),
  api = require('./relspider-api');

var app = express()
  .use(express.favicon())
  .use('/api', api);

app.get('/', function (req, res) {
  res.set("Content-Type", "text/plain");
  res.send("Rel-Spider is a proof of concept index and API for crawling and looking up the identity graphs of profiles on the social web and thus find which other sites a person is a member of.\n\nBuilt by Pelle Wessman, @voxpelli, http://github.com/voxpelli");
});

app.listen(process.env.PORT || 8080);
