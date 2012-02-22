var connect = require('connect'),
  relspider = require('./relspider'),
  lookup, add,
  spider = relspider();

lookup = function (req, res) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({error : 'Method Not Allowed'}));
  } else if (!req.query.url) {
    res.statusCode = 400;
    res.end(JSON.stringify({error : 'Missing url parameter'}));
  } else {
    //TODO: Make it possible to check for a relation between two pages as well
    spider.getRelated(req.query.url, req.query.callback, function (err, result, incomplete) {
      var response;
      if (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({error : 'An unexpected error occured'}));
      } else if (result === false) {
        res.statusCode = 202;
        res.end(JSON.stringify({status : req.query.callback ? 'Request has been registered' : 'Traversing the social graph – not yet done'}));
      } else {
        response = {
          url : req.query.url,
          related : result
        };
        if (incomplete) {
          response.incomplete = true;
        }
        res.end(JSON.stringify(response));
      }
    });
  }
};

add = function (req, res, callback) {
  res.setHeader("Content-Type", "application/json");
  //FIXME: Deactivated method checking for now
  if (false && req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({error : 'Method Not Allowed'}));
  } else if (!req.query.url) {
    res.statusCode = 400;
    res.end(JSON.stringify({error : 'Missing url parameter'}));
  } else {
    spider.addNewUnfetchedPage(req.query.url, function (err, node, alreadyExists) {
      if (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({error : 'An unexpected error occured'}));
      } else if (alreadyExists) {
        res.statusCode = 400;
        res.end(JSON.stringify({error : 'Page already added or fetched'}));
      } else {
        res.end(JSON.stringify(true));
      }
    });
  }
};

module.exports = connect()
  .use(connect.basicAuth('pelle', 'hej123'))
  .use(connect.query())
  .use('/lookup', lookup)
  .use('/add', add);
