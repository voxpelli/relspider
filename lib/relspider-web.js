"use strict";

var express = require('express'),
  http = require('http'),
  api = require('./relspider-api'),
  server;

var app = express()
  .use(express.favicon())
  .use('/api', api);

app.get('/', function (req, res) {
  res.set("Content-Type", "text/plain");
  res.send("RelSpider is a pre-alpha proof of concept index and API for crawling and looking up the identity graphs of profiles on the social web and thus find which other sites a person is a member of.\n\nThis is a DEMO of RelSpider - it might and probably will be totally broken now or in the future, if not for other reasons then due to the limitations of the free Heroku hosting it is currently running on and which is imposing very limited speed, size etc. on the crawling as well as the indexes.\n\nBuilt by Pelle Wessman, @voxpelli, https://github.com/voxpelli/relspider");
});

if (require.main !== module) {
  // Export for use in eg tests

  module.exports = app;
} else {
  api.spider.start();

  server = http.createServer(app);
  server.listen(process.env.PORT || 8080);

  process.on('SIGTERM', function () {
    console.log('Shutting down the web gracefully...');

    api.spider.close();
    server.close();
  });

  process.on('SIGINT', function () {
    // Ignoring
  });
}
