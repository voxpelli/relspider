"use strict";

var knex;

knex = require('knex')({
  client: 'pg',
  connection: require('../config').pg
});

module.exports = require('bookshelf')(knex);
