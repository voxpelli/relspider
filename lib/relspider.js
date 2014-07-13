"use strict";

var Crawler = require('./models/crawler')
  , Profile = require('./models/profile');

// Other things to do
//TODO: Replace polling for new pages to fetch with message queue based pushing?
//TODO: At upstart - check for any errors - like non-fired callbacks
//TODO: Add Neo4j indexes on "hasWebhooks" and "unfetched"

module.exports = function () {
  var crawlerInstance = new Crawler();

  return {
    addNewProfile : function (options) {
      return Profile.create(options);
    },
    forceRefresh : function (pageUrl) {
      return Profile.forceRefresh(pageUrl);
    },
    getRelated : function (pageUrl, webhook) {
      return Profile.getRelated(pageUrl, webhook);
    },
    getFriendsFeeds : function (pageUrl) {
      return Profile.getFriendsFeeds(pageUrl);
    },
    start : function () {
      crawlerInstance.start();
    },
    close : function () {
      crawlerInstance.close().then(function () {
        require('utils/cache').close();
        require('utils/bookshelf').knex.destroy();
      });
    }
  };
};
