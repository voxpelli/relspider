"use strict";

var genericMemcachedCache = require('genericcache').genericMemcachedCache
  , genericMemoryCache = require('genericcache').genericMemoryCache
  , genericCache = require('genericcache').genericCache
  , options = require('../config');

module.exports = genericCache(options.cache === 'memcached' ? genericMemcachedCache : genericMemoryCache);
