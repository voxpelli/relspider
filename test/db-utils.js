"use strict";

var knex = require('../lib/utils/bookshelf').knex,
  Promise = require('promise'),
  options = require('../lib/config'),
  installSchema = require('../lib/install-schema'),
  tables = [
    'urls',
    'hosts',
    'webhooks',
    'knex_migrations',
  ];

// Avoid running tests in non-test environments
if (options.env !== 'test') {
  throw new Error('Expected a test environment, got: ' + options.env);
}

module.exports = {
  clearDb : function () {
    var lastDeleted = Promise.resolve(true);

    tables.forEach(function (table) {
      lastDeleted = lastDeleted.then(function () {
        return knex.schema.dropTableIfExists(table);
      });
    });

    return lastDeleted;
  },

  setupSchema : function () {
    return installSchema();
  },
};
