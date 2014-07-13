/* jshint nonew:false */
/* global describe, beforeEach, afterEach, it */

"use strict";

var _ = require('underscore')
  , url = require('url')
  , chai = require('chai')
  , chaiAsPromised = require('chai-as-promised')
  , request = require('supertest')
  , nock = require('nock')
  , knex = require('../../lib/utils/bookshelf').knex
  , dbUtils = require('../db-utils');

chai.use(chaiAsPromised);
chai.should();

describe('RelSpider Crawler', function () {
  var dnsLookup, Crawler = require('../../lib/models/crawler');

  beforeEach(function () {
    dnsLookup = require('dns').lookup;

    return dbUtils.clearDb()
      .then(dbUtils.setupSchema);
  });

  afterEach(function () {
    require('dns').lookup = dnsLookup;
  });

  describe('parseSourcePage', function () {
    this.timeout(20000);

    var pages, urls, domains, crawlerInstance;

    beforeEach(function () {
      pages = {
        'http://example.com/foo': '<a rel="me" href="http://example.org/bar"></a>',
        'http://example.org/bar': '<p>Empty page</p>',
      };

      urls = _.keys(pages);

      pages = _.map(pages, function (content, pageUrl) {
        pageUrl = url.parse(pageUrl);

        return nock('http://' + pageUrl.host)
          .get('/robots.txt').reply(404)
          .get(pageUrl.pathname)
          .reply(200, content, {
            'Content-Type': 'text/html; charset=utf-8',
          });
      });

      domains = {
        'example.com': '1.1.1.1',
        'example.org': '2.2.2.2',
      };

      require('dns').lookup = function (domain, callback) {
        if (domains[domain]) {
          callback(null, domains[domain]);
        } else {
          dnsLookup.apply(this, arguments);
        }
      };

      crawlerInstance = new Crawler();
    });

    afterEach(function () {
      return crawlerInstance.stop();
    });

    it('should crawl all available links', function (done) {
      crawlerInstance.start();

      request(require('../../lib/relspider-api'))
        .get('/lookup')
        .query({ url: 'http://example.com/foo' })
        .expect(202)
        .end(function (err) {
          if (err) {
            return done(err);
          }
          setTimeout(function () {
            knex('urls').select('url').then(function (result) {
              crawlerInstance.queue.length.should.equal(0);
              result.length.should.equal(pages.length);
              _.each(result, function (row) {
                urls.indexOf(row.url).should.not.equal(-1);
              });
              _.each(pages, function (pageMock) {
                pageMock.done();
              });
            }).then(done, done);
          }, 6000);
        });
    });

    it('should fire a webhook when all links have been crawled', function (done) {
      //TODO: seems like the firing isn't made because of the Neo4j query
      var hook = nock('http://example.net')
        .post('/webhook', {
          url: 'http://example.com/foo',
          related: [
            'http://example.com/foo',
            'http://example.org/bar',
          ],
        })
        .reply(200);

      crawlerInstance.start();

      request(require('../../lib/relspider-api'))
        .get('/lookup')
        .query({
          url: 'http://example.com/foo',
          callback: 'http://example.net/webhook',
        })
        .expect(202)
        .end(function (err) {
          if (err) {
            return done(err);
          }
          setTimeout(function () {
            hook.done();
            done();
          }, 4000);
        });
    });
  });
});
