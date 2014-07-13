"use strict";

if (!process.env.DATABASE_URL) {
  require('dotenv').load();
}

var prefix = 'RELSPIDER_'
  , env = process.env
  , config;

config = {
  version : require('../package.json').version,
  env: env.NODE_ENV || 'production',
  neo4j : env.NEO4J_URL || env.GRAPHENEDB_URL || 'http://localhost:7474',
  pg : env.DATABASE_URL,
  statsmix : process.env.STATSMIX_URL,
  cache : env[prefix + 'CACHE'] || ((env.MEMCACHE_USERNAME || env.MEMCACHIER_USERNAME) ? 'memcached' : 'memory'),
  parallelFetches : parseInt(env[prefix + 'PARALLEL'] || 60, 10),
  maxJumpsAway : parseInt(env[prefix + 'MAX_JUMPS'] || 40, 10),
  crawlXFN : env[prefix + 'PARSE_XFN'] && env[prefix + 'PARSE_XFN'] !== '0' && env[prefix + 'PARSE_XFN'] !== 'false',
  crawlFeeds : env[prefix + 'PARSE_FEEDS'] && env[prefix + 'PARSE_FEEDS'] !== '0' && env[prefix + 'PARSE_FEEDS'] !== 'false',
  timings: {
    secondsToThrottle : Math.max(5, env[prefix + 'SECONDS_TO_THROTTLE'] || 10),
    maxExponentialPaus : 4,
    maxAgeWithoutRequest : 1000 * 60 * 60 * 24 * 7, // A week in milliseconds
    minMinutesBetweenRefresh : 1,
    minutesToLock : 10,
    minutesUntilRefresh : 60 * 24,
  }
};

if (config.env === 'test') {
  config.pg = process.env.DATABASE_TEST_URL || "postgres://postgres@localhost/relspider_test";
}

module.exports = config;
