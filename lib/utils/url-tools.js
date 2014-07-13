"use strict";

var Promise = require('promise')
  , url = require('url')
  , cache = require('./cache')
  , request = require('./request')
  , cacheURL
  , validURL;

cacheURL = function (page, defaultTtl) {
  var cacheKey = 'fetchURL:' + page;

  return new Promise(function (resolve, reject) {
    cache.get(cacheKey, function (err, result) {
      //TODO: On cache error - sleep for a while and retry?
      if (!err && (result || result === '')) {
        console.log('Found cache for ' + page);
        resolve(result.fail ? false : result);
      } else {
        console.log('No cache for ' + page);
        try {
          request(page, function (error, response, body) {
            var ttl = defaultTtl || 3600,
              result;

            if (error) {
              reject(error);
            } else {
              if (response.statusCode === 200) {
                result = body || '';
              } else if (response.statusCode === 404 || response.statusCode === 410) {
                result = '';
              } else {
                ttl = 7200;
                result = false;
              }
              cache.set(cacheKey, result === false ? { fail : true } : result, ttl);
              resolve(result);
            }
          });
        } catch (error) {
          reject(error);
        }
      }
    });
  });
};

validURL = function (page) {
  var parsed = url.parse(page);

  if (!parsed.protocol || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    console.log('Not a web URL: ' + page);
    return false;
  }
  if (parsed.host && parsed.host.length > 255) {
    console.log('Hostname is too long: ' + page);
    return false;
  }
  if (page.length > 1024) {
    console.log('URL is too long: ' + page);
    return false;
  }

  return true;
};

module.exports = {
  cacheURL : cacheURL,
  validURL : validURL,
};
