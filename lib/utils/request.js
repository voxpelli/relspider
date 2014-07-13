"use strict";

var request = require('request')
  , Promise = require('promise')
  , options = require('../config');

request = request.defaults({
  jar: false,
  timeout: 5000,
  maxRedirects : 9, // Test to see if error like the once described in https://github.com/mikeal/request/issues/107 can be fixed
  headers: {
    'User-Agent' : 'RelSpider/' + options.version + ' (https://github.com/voxpelli/relspider)'
  }
});

request.promise = Promise.denodeify(request);

module.exports = request;
