"use strict";

var _ = require('underscore')
  , cheerio = require('cheerio')
  , metrics = require('metrics')
  , statsmix = require('metrics-statsmix')
  , NotFoundError = require('../utils/errors').NotFoundError
  , options = require('../config')
  , Profile = require('./profile')
  , Promise = require('promise')
  , request = require('../utils/request')
  , url = require('url')
  , VError = require('verror')
  , Crawler;

Crawler = function () {
  this.queue = [];
  this.crawlMetric = new metrics.Counter();
  this.successMetric = new metrics.Counter();

  if (options.statsmix) {
    this.statsmix = new statsmix.Client();
    this.statsmix.addMetric('Crawl rate', this.crawlMetric, { track : true });
    this.statsmix.addMetric('Success rate', this.successMetric, { track : true });
  }
};

Crawler.prototype.findRelations = function (targetUrl) {
  console.log('Fetching', targetUrl, '...');

  this.crawlMetric.inc();

  //TODO: Add better headers - like Accept
  return request.promise(targetUrl, { followRedirect : false }).then(function (response) {
    if (response.statusCode >= 300 && response.statusCode < 400) {
      var fakeRelations = {}
        , location = url.resolve(targetUrl, response.headers.location);

      fakeRelations = {};
      fakeRelations[response.statusCode === 301 ? 'canonical' : 'me'] = {};
      fakeRelations[response.statusCode === 301 ? 'canonical' : 'me'][location] = '';

      console.log('Redirect', response.statusCode, 'from', targetUrl, 'to', location);

      return fakeRelations;
    } else if (
      response.statusCode === 200 &&
      response.headers['content-type'] && response.headers['content-type'].split(';')[0] === 'text/html' &&
      response.body && response.body.trim()
    ) {
      return this.parseRelations(cheerio.load(response.body), targetUrl);
    } else {
      if (
        response.statusCode === 200 &&
        (!response.headers['content-type'] || response.headers['content-type'].split(';')[0] !== 'text/html')
      ) {
        console.log('Non-supported content-type: ' + (response.headers['content-type'] || 'No content type at all!'));
      }
      return false;
    }
  }.bind(this)).then(undefined, function (err) {
    throw new VError(err, 'failed to find relations for "%s"', targetUrl);
  });
};

Crawler.prototype.parseRelations = function ($, pageUrl) {
  var relationTypes = {
    canonical : { linksOnly: true },
    me : {}
  };

  if (options.crawlXFN) {
    relationTypes.contact = {};
  }
  //TODO: Instead of saving feeds as relations, perhaps we should save them as data in postgres and just add a flag about their existance to neo4j – as feeds will never have any outgoing relations and thus are a dead end!
  if (options.crawlFeeds) {
    relationTypes.alternate = {
      linksOnly: true,
      validTypes: ['application/atom+xml', 'application/rss+xml', 'application/activitystream+json'],
    };
  }

  return Promise.all(_.map(relationTypes, function (options, rel) {
    //TODO: Add some setImmediate amidst all of this to open up for IO!
    return this.parseRelation($, rel, pageUrl, options);
  }.bind(this))).then(function (result) {
    return _.reduce(result, function (result, relations) {
      return _.extend(result, relations);
    });
  });
};

Crawler.prototype.parseRelation = function ($, rel, pageUrl, options) {
  var authors
    , relations = {}
    , i
    , length
    , anchor
    , href
    , text
    , result;

  authors = $('head > link[rel~="' + rel + '"]' + (options.linksOnly ? '' : ', a[rel~="' + rel + '"]'));

  console.log("...found", authors.length, '"' + rel + '"-relations on "' + pageUrl + '".');

  for (i = 0, length = authors.length; i < length; i += 1) {
    anchor = authors.eq(i);

    if (options.validTypes && options.validTypes.indexOf(anchor.attr('type')) === -1) {
      continue;
    }

    href = url.resolve(pageUrl, anchor.attr('href'));
    text = anchor.text();

    if (href === pageUrl) {
      continue;
    } else if (relations[href]) {
      if (relations[href].text.indexOf(text) === -1) {
        relations[href].text.push(text);
      }
    } else {
      relations[href] = {
        text : [text]
      };
    }
  }

  result = {};
  result[rel] = relations;
  return Promise.resolve(result);
};

Crawler.prototype.start = function () {
  console.log('Starting crawler!');
  this.next();
};

Crawler.prototype.next = function (retryCount) {
  var crawlerInstance = this;

  console.log('Searches for a page to fetch...');

  if (this.closingDown) {
    console.log('Closing down - not going to queue anything new');
    return;
  } else if (this.queue.length >= options.parallelFetches) {
    console.log('Reached max parallell fetches!');
    return;
  }

  Profile.reserve(options.timings).then(function (profile) {
    if (!profile) {
      retryCount = Math.min(options.timings.maxExponentialPaus, retryCount ? retryCount + 1 : 1);

      console.log('No page found - pausing for ' + Math.pow(2, retryCount - 1) + ' seconds. Time now: ' + (new Date()).toISOString());

      crawlerInstance.delayedFetch = setTimeout(function () {
        crawlerInstance.delayedFetch = false;
        crawlerInstance.next(retryCount);
      }, 1000 * Math.pow(2, retryCount - 1));

      throw new NotFoundError('No profiles to reserve');
    }

    console.log('Initializing fetch of:', profile.get('url'));

    crawlerInstance.queue.push(profile.get('url'));

    setImmediate(crawlerInstance.next.bind(crawlerInstance));

    return profile
      .unwanted()
      .then(function (unwanted) {
        console.log((unwanted ? 'Unwanted' : 'Wanted') + ':', profile.get('url'));
        if (unwanted) {
          return profile.destroy()
            .then(function () {
              throw new NotFoundError('Unwanted profile');
            });
        }
      })
      .then(profile.reserveHost.bind(profile))
      .then(function (reserved) {
        console.log(reserved ? 'Unthrottled' : 'Throttled', 'host for:', profile.get('url'));
        if (!reserved) {
          throw new NotFoundError('Profile host throttled');
        }
      })
      .then(function () {
        return profile.ensureCrawlable().then(undefined, function (err) {
          return profile.flagAsFailed().then(function () {
            throw err;
          });
        });
      })
      .then(function (allowed) {
        console.log(allowed ? 'Allowed' : 'Disallowed', 'crawling for:', profile.get('url'));
        if (!allowed) {
          return profile.flagAsFailed().then(function () {
            throw new NotFoundError('Profile not crawlable');
          });
        }
      })
      .then(function () {
        return profile;
      })
      .then(undefined, function (err) {
        crawlerInstance.removeFromQueue(profile);
        throw err;
      });
  })
  .then(function (profile) {
    return crawlerInstance.findRelations(profile.get('url'))
      .then(profile.setRelations.bind(profile))
      .then(function () {
        crawlerInstance.successMetric.inc();
      })
      .then(profile.flagAsFetched.bind(profile))
      .then(undefined, function (err) {
        console.error('Failed to fetch page, got error:', err.message);
        console.log(err.stack);
        return profile.flagAsFailed();
      })
      .then(crawlerInstance.removeFromQueue.bind(crawlerInstance, profile));
  })
  .then(undefined, function (err) {
    if (err.name !== 'NotFoundError') {
      console.error('Unexpected error before fetching page: ', err.message);
      console.log(err.stack);
    }
  });
};

Crawler.prototype.removeFromQueue = function (profile) {
  console.log('Removing from queue');

  profile = profile.get('url');

  this.queue.splice(this.queue.indexOf(profile), 1);

  if (this.closingDown && !this.queue.length) {
    this.readyToClose();
  } else if (this.queue.length + 1 === options.parallelFetches) {
    console.log('Freeing up fetches!');
    setImmediate(this.next.bind(this));
  }
};

Crawler.prototype.close = Crawler.prototype.stop = function () {
  this.closingDown = true;

  if (this.delayedFetch) {
    clearTimeout(this.delayedFetch);
    this.delayedFetch = false;
  }

  if (!this.queue.length) {
    return Promise.resolve();
  }

  return new Promise(function (resolve) {
    this.readyToClose = resolve;
  }.bind(this)).then(function () {
    this.statsmix.close();
  }.bind(this));
};

module.exports = Crawler;
