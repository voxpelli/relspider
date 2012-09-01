var express = require('express'),
  relspider = require('./relspider'),
  lookup, add,
  spider = relspider();

lookup = function (req, res) {
  if (req.method !== 'GET') {
    res.json(405, {error : 'Method not allowed'});
  } else if (!req.query.url) {
    res.statusCode = 400;
    res.json(400, {error : 'Missing url parameter'});
  } else {
    spider.getRelated(req.query.url, req.query.callback, function (err, result, incomplete) {
      var response;
      if (err) {
        res.json(400, {error : 'An unexpected error occured'});
      } else if (result === false) {
        res.json(202, {status : req.query.callback ? 'Request has been registered' : 'Traversing the identity graph – not yet done'});
      } else {
        response = {
          url : req.query.url,
          related : result
        };
        if (incomplete) {
          response.incomplete = true;
        }
        res.json(response);
      }
    });
  }
};

add = function (req, res) {
  //FIXME: Deactivated method checking for now
  if (false && req.method !== 'POST') {
    res.json(405, {error : 'Method not allowed'});
  } else if (!req.query.url) {
    res.json(400, {error : 'Missing url parameter'});
  } else {
    spider.addNewUnfetchedPage(req.query.url, function (err, node, alreadyExists) {
      if (err) {
        res.json(400, {error : 'An unexpected error occured'});
      } else if (alreadyExists) {
        res.json(400, {error : 'Page already added or fetched'});
      } else {
        res.json(202, 'Request has been registered');
      }
    });
  }
};

module.exports = express()
  .set('jsonp callback name', 'jsonp');

if (process.env.RELSPIDER_API_USER && process.env.RELSPIDER_API_PASS) {
  module.exports.use(express.basicAuth(process.env.RELSPIDER_API_USER, process.env.RELSPIDER_API_PASS));
}

module.exports.use(express.query())
  .use('/lookup', lookup)
  .use('/add', add);
