"use strict";

var express = require('express'),
  opml = require('opml-generator'),
  relspider = require('../'),
  lookup, friendsfeeds, add, refresh,
  spider = relspider();

lookup = function (req, res) {
  if (req.method !== 'GET') {
    res.json(405, {error : 'Method not allowed'});
  } else if (!req.query.url) {
    res.statusCode = 400;
    res.json(400, {error : 'Missing url parameter'});
  } else {
    spider.getRelated(req.query.url, req.query.callback).then(function (result) {
      var response;
      if (!result) {
        res.json(202, {status : req.query.callback ? 'Request has been registered' : 'Traversing the identity graph – not yet done'});
      } else {
        response = {
          url : req.query.url,
          related : result.urls
        };
        if (result.incomplete) {
          response.incomplete = true;
        }
        res.json(response);
      }
    }).then(undefined, function (err) {
      console.error('Lookup encountered an unexpected error:', err.message);
      console.log(err.stack);
      res.json(400, {error : 'An unexpected error occured'});
    });
  }
};

friendsfeeds = function (req, res) {
  if (req.method !== 'GET') {
    res.json(405, {error : 'Method not allowed'});
  } else if (!req.query.url) {
    res.statusCode = 400;
    res.json(400, {error : 'Missing url parameter'});
  } else {
    console.log('Friends feeds!');
    spider.getFriendsFeeds(req.query.url).then(function (result) {
      var outlines = [];

      result.forEach(function (feed) {
        outlines.push({
          text: 'Feed from ' + feed.url,
          type: 'rss',
          xmlUrl: feed.feed,
          htmlUrl: feed.url,
        });
      });

      res.set('Content-Type', 'application/xml');
      res.send(opml({
        title: 'Friends of ' + req.query.url,
        dateCreated: new Date(),
        ownerName: 'RelSpider'
      }, outlines));
    }).then(undefined, function (err) {
      console.error('Friendsfeeds encountered an unexpected error:', err.message);
      console.log(err.stack);
      res.json(400, {error : 'An unexpected error occured'});
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
    spider.addNewProfile({
      url : req.query.url,
      requested : true
    }).then(function (profileInstance) {
      if (profileInstance.has('fetched')) {
        res.json(200, 'Page already fetched');
      } else {
        res.json(202, 'Request has been registered');
      }
    }, function (err) {
      console.error('Add encountered an unexpected error:', err.message);
      console.log(err.stack);
      res.json(400, {error : 'An unexpected error occured'});
    });
  }
};

refresh = function (req, res) {
  //FIXME: Deactivated method checking for now
  if (false && req.method !== 'POST') {
    res.json(405, {error : 'Method not allowed'});
  } else if (!req.query.url) {
    res.json(400, {error : 'Missing url parameter'});
  } else {
    spider.forceRefresh(req.query.url).then(function () {
      res.json(202, 'Request has been registered');
    }, function (err) {
      console.error('Refresh encountered an unexpected error:', err.message);
      console.log(err.stack);
      res.json(400, {error : 'An unexpected error occured'});
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
  .use('/friends/feeds', friendsfeeds)
  .use('/add', add)
  .use('/refresh', refresh);

module.exports.spider = spider;
