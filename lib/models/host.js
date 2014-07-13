"use strict";

var bookshelf = require('../utils/bookshelf')
  , knex = bookshelf.knex
  , options = require('../config')
  , VError = require('verror')
  , Host
  , reserve;

//TODO: Add an IP column as well in here and do a reserver WHERE host = hostname OR ip = IP

reserve = function (host, ip) {
  //TODO: Maybe parts of this should be part of the original toFetch() query instead - so that we never selects a URL that can't be fetched
  //TODO: Can we maybe make this into more of one of a database query
  console.log('Checking throttling of', host);

  return knex('hosts')
    .update({
      fetched: knex.raw('NOW()'),
      count: knex.raw('count + 1')
    })
    .where(function () {
      this.where('host', host).orWhere('ip', ip);
    })
    .where('fetched', '<', knex.raw("NOW() - interval '" + parseInt(options.timings.secondsToThrottle, 10) + " seconds'"))
    .returning('host')
    .then(function (rows) {
      if (rows[0]) {
        return rows;
      }
      return knex('hosts')
        .insert({
          host: host,
          ip: ip,
          added: knex.raw('NOW()'),
          fetched: knex.raw('NOW()'),
          count: 1
        })
        .returning('host');
    })
    .then(function () {
      return true;
    })
    .then(undefined, function (err) {
      // If there's actually a throttled URL, then we will receive this error
      if (parseInt(err.code, 10) === 23505) {
        console.log('Throttling ' + host + '!');
        return false;
      } else {
        throw new VError(err, 'Couldn\'t check throttle status of host "%s"', host);
      }
    });
};

Host = bookshelf.Model.extend({
  tableName: 'hosts',
  idAttribute: 'host',
}, {
  reserve: reserve
});

module.exports = Host;
