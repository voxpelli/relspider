var connect = require('connect'),
  api = require('./relspider-api');

//TODO: Switch to Express instead of Connect

connect()
  .use(connect.favicon())
  .use('/api', api)
  .use('/', function (req, res, callback) {
    res.setHeader("Content-Type", "text/plain");
    res.end("Rel-Spider is a proof of concept index and API for looking up other profiles in a person's social graph.\n\nBuilt by Pelle Wessman, @voxpelli, http://github.com/voxpelli");
  })
  .use(connect.static(__dirname + '/../public'))
  .listen(process.env.PORT || 8080);