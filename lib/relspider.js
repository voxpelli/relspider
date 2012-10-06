'use strict';

/*jslint node: true, indent: 2 */

var neo4jModule = require('neo4j'),
  pgModule = require('pg'),
  request = require('request'),
  robots = require('robots'),
  jsdom = require('jsdom'),
  step = require('step'),
  url = require('url'),
  u = require('underscore'),
  genericMemcachedCache,
  genericMemoryCache,
  genericCache;

// Other things to do
//TODO: Replace polling for new pages to fetch with message queue based pushing?
//TODO: At upstart - check for any errors - like non-fired callbacks
//TODO: Add Neo4j indexes on "hasWebhooks" and "unfetched"

genericMemcachedCache = {
  connect : function (options) {
    var memjs = require('memjs'),
      storage = memjs.Client.create(options.servers || undefined, options);

    return {
      set : function (key, value, ttl, callback) {
        var defaultTtl = storage.options.expires;
        storage.options.expires = ttl;

        if (u.isObject(value)) {
          value = JSON.stringify(value);
        } else if (!u.isString(value) && !u.isNumber(value)) {
          console.log("Can't cache this value in memcache", value);
          return;
        }

        storage.set(key, value, callback);

        storage.options.expires = defaultTtl;
      },
      get : function (key, callback) {
        storage.get(key,  function (err, value) {
          value = (value === null ? false : value.toString());
          if (value.length && value.substr(0, 1) === '{') {
            value = JSON.parse(value);
          }
          callback(err, value);
        });
      }
    };
  }
};

genericMemoryCache = {
  connect : function (options) {
    var NodeCache = require('node-cache'),
      storage = new NodeCache(options);

    return {
      set : function (key, value, ttl, callback) {
        storage.set(key, value, ttl, callback);
      },
      get : function (key, callback) {
        storage.get(key, function (err, value) {
          callback(err, value[key] === undefined ? false : value[key]);
        });
      }
    };
  }
};

genericCache = function (driver, options) {
  var storage = driver.connect(options || {});

  return {
    set : function (key, value, ttl, callback) {
      storage.set(key, value, ttl, callback ? function (err, result) {
        callback(err, result ? true : false);
      } : undefined);
    },
    get : function (key, callback) {
      storage.get(key, callback);
    }
  };
};

request = request.defaults({
  jar: false,
  timeout: 5000,
  maxRedirects : 9, // Test to see if error like the once described in https://github.com/mikeal/request/issues/107 can be fixed
  headers: {
    'User-Agent' : 'RelSpider (https://github.com/voxpelli/relspider)'
  }
});

module.exports = function (options) {
  options = options || {};

  u.defaults(options, {
    neo4j : process.env.NEO4J_URL || 'http://localhost:7474',
    pg : process.env.DATABASE_URL,
    parallelFetches : process.env.RELSPIDER_PARALLEL || 30,
    secondsToThrottle : 10,
    maxPaus : 4,
    minutesToLock : 10,
    cache : process.env.RELSPIDER_CACHE || ((process.env.MEMCACHE_USERNAME || process.env.MEMCACHIER_USERNAME) ? 'memcached' : 'memory'),
    cacheOptions : {}
  });

  var neo4j = new neo4jModule.GraphDatabase(options.neo4j),
    pg = new pgModule.Client(options.pg),
    cache = genericCache(options.cache === 'memcached' ? genericMemcachedCache : genericMemoryCache, options.cacheOptions),
    validURL,
    fetchURL,
    checkRobotsTxt,
    checkThrottled,
    isGraphComplete,
    fetchRelatedURLs,
    getRelated,
    fireHooks,
    setPageAsFailed,
    fetchNodeForPage,
    addNewUnfetchedPage,
    addAndConnectPage,
    toFetch,
    handleResponse,
    parseRelations,
    parseDomDocument,
    findRelations,
    removeFromFetchQueue,
    fetchQueue = [];

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

  fetchURL = function (page, defaultTtl, callback) {
    var cacheKey = 'fetchURL:' + page;

    if (u.isFunction(defaultTtl)) {
      callback = defaultTtl;
    }

    cache.get(cacheKey, function (err, result) {
      //TODO: On cache error - sleep for a while and retry?
      if (!err && result !== false) {
        console.log('Found cache for ' + page);
        callback(null, result.fail ? false : result);
      } else {
        console.log('No cache for ' + page);
        request(page, function (error, response, body) {
          var ttl = defaultTtl || 3600,
            result;

          if (error) {
            callback(true);
          } else {
            if (response.statusCode === 200) {
              result = body || '';
            } else if (response.statusCode === 404 || response.statusCode === 410) {
              result = '';
            } else {
              ttl = 7200;
              result = { fail : true };
            }
            cache.set(cacheKey, result, ttl);
            callback(null, result);
          }
        });
      }
    });
  };

  checkRobotsTxt = function (page, callback) {
    fetchURL(url.resolve(page, '/robots.txt'), 60 * 60 * 24, function (err, result) {
      var parser;

      if (err) {
        callback(true);
      } else if (result === false) {
        callback(null, false);
      } else {
        parser = new robots.RobotsParser();
        parser.parse(result);
        parser.canFetch('RelSpider', page, function (access) {
          callback(null, access);
        });
      }
    });
  };

  checkThrottled = function (page, callback) {
    //TODO: Maybe parts of this should be part of the original toFetch() query instead - so that we never selects a URL that can't be fetched
    var host = url.parse(page).host;
    // console.log('Checking throttling of ' + host);
    pg.query("UPDATE hosts SET fetched = NOW(), count = count + 1 WHERE host = $1 AND fetched < NOW() - interval '" + parseInt(options.secondsToThrottle, 10) + " seconds' RETURNING host", [host], function (err, result) {
      if (err) {
        callback(true);
      } else if (!result.rowCount) {
        //TODO: Can we avoid trying an insert when we're not given a lock?
        pg.query("INSERT INTO hosts (host, added, fetched, count) VALUES ($1, NOW(), NOW(), 1) RETURNING host", [host], function (err) {
          if (err) {
            if (parseInt(err.code, 10) === 23505) {
              console.log('Throttling ' + page + '!');
              callback(null, true);
            } else {
              callback(true);
            }
          } else {
            callback(null, false);
          }
        });
      } else {
        callback(null, false);
      }
    });
  };

  fetchNodeForPage = function (page, callback) {
    pg.query('SELECT node FROM urls WHERE url = $1', [page], function (err, result) {
      if (err) {
        callback(true);
      } else if (result.rowCount && result.rows[0].node) {
        neo4j.getNodeById(result.rows[0].node, callback);
      } else {
        callback(false, false);
      }
    });
  };

  isGraphComplete = function (node, callback) {
    var query = 'START n=node({id}), n2=node(*) MATCH allShortestPaths(n-[:me|alias*..40]->n2) WHERE n2.unfetched! = true RETURN COUNT(n2) AS unfetched';

    neo4j.query(query, {id : node.id}, function (err, results) {
      if (err) {
        callback(true);
      } else {
        callback(null, results[0].unfetched === 0);
      }
    });
  };

  fetchRelatedURLs = function (node, callback) {
    var query = 'START n=node({id}), n2=node(*) MATCH allShortestPaths(n-[:me|alias*..40]->n2), n2-[?:alias]->n3 WHERE n3 is null RETURN distinct n2.url AS url, count(n2.failed?) AS failed';

    neo4j.query(query, {id : node.id}, function (err, results) {
      if (err) {
        callback(true);
      } else {
        var urls = [], incomplete = false;
        u.each(results, function (row) {
          urls.push(row.url);
          if (row.failed) {
            incomplete = true;
          }
        });
        callback(null, urls, incomplete);
      }
    });
  };

  getRelated = function (page, webhook, callback) {
    var pageNode, newNode = false;

    step(
      function () {
        fetchNodeForPage(page, this);
      },
      function (err, node) {
        var options;
        if (err) {
          console.log('Error fetching existing node');
          callback(true);
        } else if (!node) {
          newNode = true;
          options = { url : page };
          if (webhook) {
            options.hasWebhooks = true;
          }
          addNewUnfetchedPage(options, this);
        } else {
          this(false, node);
        }
      },
      function (err, node, alreadyExists) {
        var that = this;

        if (err) {
          console.log('Error looking for node');
          callback(true);
        } else if (alreadyExists) {
          fetchNodeForPage(page, function (err, node) {
            if (err) {
              callback(true);
            } else {
              pageNode = node;
              isGraphComplete(pageNode, that);
            }
          });
        } else if (!node) {
          console.log('Error - no node received?');
          callback(true);
        } else if (newNode) {
          pageNode = node;
          this(false, false);
        } else {
          pageNode = node;
          isGraphComplete(pageNode, this);
        }
      },
      function (err, complete) {
        if (err) {
          console.log('Error when looking for completeness for ' + page);
          callback(true);
        } else if (complete) {
          fetchRelatedURLs(pageNode, this);
        } else if (webhook && !validURL(webhook)) {
          callback(true);
        } else if (webhook) {
          step(
            function () {
              pg.query("INSERT INTO webhooks (hook, url, added) VALUES ($1, $2, NOW())", [webhook, page], this);
            },
            function (err) {
              if (err) {
                return;
              }
              pageNode.data.hasWebhooks = true;
              pageNode.save(this);
            },
            function (err) {
              if (err) {
                return;
              }
              // Ensure that the graph wasn't completed during our adding of the webhook - if it was - fire the hooks
              isGraphComplete(pageNode, this);
            },
            function (err, complete) {
              if (!err && complete) {
                fireHooks(pageNode);
              }
            }
          );
          this(null, false);
        } else {
          this(null, false);
        }
      },
      function (err, results, incomplete) {
        if (err) {
          callback(true);
        } else {
          callback(null, results, incomplete);
        }
      }
    );
  };

  fireHooks = function (node) {
    console.log('Firing hooks for ' + node.data.url);

    pg.query("UPDATE webhooks SET fired = NOW() WHERE url = $1 AND (fired IS NULL OR fired < NOW() - interval '" + parseInt(options.minutesToLock, 10) + " minutes') RETURNING hook", [node.data.url], function (err, hooks) {
      if (err) {
        console.log('Failed to find hooks');
        return;
      }
      if (!hooks.rowCount) {
        console.log('No hooks found');
        delete node.data.hasWebhooks;
        node.save();
        return;
      }

      step(
        function () {
          fetchRelatedURLs(node, this);
        },
        function (err, urls, incomplete) {
          if (err) {
            console.log('Failed to find related URL:s for hook');
            return;
          }

          var callbacks = this.group();

          u.each(hooks.rows, function (row) {
            var callback = callbacks(), body;

            console.log('Firing hook ' + row.hook);

            body = {
              url : node.data.url,
              related : urls
            };

            if (incomplete) {
              body.incomplete = true;
            }

            request({
              method : 'POST',
              url : row.hook,
              json : body
            }, function (error, response) {
              if (!error && response.statusCode === 200) {
                console.log('Successfully fired hook ' + row.hook);
                pg.query("DELETE FROM webhooks WHERE hook = $1 AND url = $2", [row.hook, node.data.url]);
              }
              callback();
            });
          });
        },
        function () {
          delete node.data.hasWebhooks;
          node.save();
        }
      );
    });
  };

  setPageAsFailed = function (page, callback) {
    console.log('Marking page as failed: ' + page);

    step(
      function () {
        var nodeCallback, callbacks = this.group();

        pg.query("UPDATE urls SET failed = failed + 1 WHERE url = $1", [page], callbacks());

        nodeCallback = callbacks();

        fetchNodeForPage(page, function (err, node) {
          if (err || !node) {
            nodeCallback();
            return;
          }
          step(
            function () {
              node.data.failed = true;
              delete node.data.unfetched;
              node.save(this);
            },
            function () {
              if (node.data.hasWebhooks) {
                fireHooks(node);
              }
              nodeCallback();
            }
          );
        });
      },
      function () {
        callback();
      }
    );
  };

  addNewUnfetchedPage = function (options, callback) {
    var page, node;

    if (u.isString(options)) {
      options = { url : options };
    }

    options = u.defaults(options, {
      unfetched : true
    });

    page = options.url;

    if (!validURL(page)) {
      callback(true);
      return;
    }

    node = neo4j.createNode(options);

    step(
      function () {
        pg.query("INSERT INTO urls (url, added) VALUES ($1, NOW())", [page], this);
      },
      function (err) {
        //TODO: Avoid duplicate key errors - spams db logs
        if (err && parseInt(err.code, 10) !== 23505) {
          callback(true);
          return;
        }
        if (!err) {
          node.save(this);
        } else {
          callback(false, false, true);
        }
      },
      function (err) {
        if (err) {
          callback(true);
          return;
        }

        pg.query("UPDATE urls SET node = $1 WHERE url = $2", [node.id, page], this);
        node.index('pages', 'url', page);

        // console.log('Added', page);

        callback(false, node);
      }
    );
  };

  addAndConnectPage = function (foundPage, nodeFrom, relation, callback) {
    step(
      function () {
        addNewUnfetchedPage(foundPage, this);
      },
      function (err, node, alreadyExists) {
        if (err) {
          this(true);
        } else if (!alreadyExists) {
          this(false, node);
        } else {
          fetchNodeForPage(foundPage, this);
        }
      },
      function (err, node) {
        if (err) {
          callback(true);
          return;
        }
        if (nodeFrom && node) {
          node.createRelationshipFrom(nodeFrom, relation, {});
          // console.log('Connected', foundPage);
        }
        callback();
      }
    );
  };

  removeFromFetchQueue = function (page) {
    fetchQueue.splice(fetchQueue.indexOf(page), 1);
    if (fetchQueue.length + 1 === options.parallelFetches) {
      console.log('Freeing up fetches!');
      process.nextTick(toFetch);
    }
  };

  toFetch = function (retryCount) {
    // console.log('Searches for a page to fetch...');

    if (fetchQueue.length >= options.parallelFetches) {
      console.log('Reached max parallell fetches!');
      return;
    }

    pg.query("UPDATE urls SET fetched = NOW() WHERE url = (SELECT url FROM urls WHERE completed = false AND disallowed = false AND failed < 3 AND (fetched IS NULL OR fetched < NOW() - interval '" + parseInt(options.minutesToLock, 10) + " minutes') ORDER BY added ASC LIMIT 1) RETURNING url", [], function (err, result) {
      if (err || !result.rowCount) {
        retryCount = Math.min(options.maxPaus, retryCount ? retryCount + 1 : 1);

        // console.log('No page found - pausing for ' + Math.pow(2, retryCount - 1) + ' seconds. Time now: ' + (new Date()).toISOString());

        setTimeout(function () {
          toFetch(retryCount);
        }, 1000 * Math.pow(2, retryCount - 1));

        return;
      }

      var page = result.rows[0].url;

      fetchQueue.push(page);

      process.nextTick(toFetch);

      step(
        function () {
          checkThrottled(page, this);
        },
        function (err, throttled) {
          if (!err && !throttled) {
            checkRobotsTxt(page, this);
          } else {
            // Retry as soon as we can be sure that the lock is gone!
            pg.query("UPDATE urls SET fetched = NOW() - interval '" + parseInt(options.minutesToLock, 10) + " minutes' + interval '" + parseInt(options.secondsToThrottle, 10) + " seconds' WHERE url = $1 RETURNING url", [page]);
            removeFromFetchQueue(page);
          }
        },
        function (err, allowed) {
          var callbacks;

          if (allowed) {
            findRelations(page, function (err, result) {
              handleResponse(err, page, result);
            }, [
              function (window) {
                return parseRelations.call(this, 'canonical', window, true);
              },
              function (window) {
                return parseRelations.call(this, 'me', window);
              }
            ]);
          } else {
            callbacks = this.group();

            if (err) {
              pg.query("UPDATE urls SET disallowed = true WHERE url = $2", [page], callbacks());
            }

            setPageAsFailed(page, callbacks());
          }
        },
        function () {
          removeFromFetchQueue(page);
        }
      );
    });
  };

  handleResponse = function (err, page, result) {
    // console.log('Handling response for ' + page);

    var callback = removeFromFetchQueue;

    if (err || result === false) {
      setPageAsFailed(page, callback);
    }

    // Fetch the Neo4j node that we just parsed the data from and loop
    // through all pages that we found that page to be connected to
    fetchNodeForPage(page, function (err, nodeFrom) {
      if (err) {
        callback();
        return;
      }
      step(
        function () {
          if (!result || (u.isEmpty(result.canonical) && u.isEmpty(result.me))) {
            this();
          } else {
            var group = this.group();
            u.each(result.canonical, function (data, foundPage) {
              if (page !== foundPage) {
                addAndConnectPage(foundPage, nodeFrom, 'alias', group());
              }
            });
            u.each(result.me, function (data, foundPage) {
              addAndConnectPage(foundPage, nodeFrom, 'me', group());
            });
          }
        },
        function () {
          if (nodeFrom) {
            delete nodeFrom.data.failed;
            delete nodeFrom.data.unfetched;
            step(
              function () {
                nodeFrom.save(this);
              },
              function (err) {
                if (err) {
                  callback();
                  return;
                }

                pg.query('UPDATE urls SET completed = true WHERE url = $1', [page]);

                if (nodeFrom.data.hasWebhooks && (!result || u.isEmpty(result.me))) {
                  process.nextTick(function () {
                    fireHooks(nodeFrom);
                  });
                }

                // console.log('Checking for nodes with a callback that are related to ' + page);
                neo4j.query('START n=node({id}), n2=node(*), n3=node(*) MATCH allShortestPaths(n<-[:me*..40]-n2), allShortestPaths(n2-[:me*..40]->n3) WHERE n2.hasWebhooks! = true RETURN distinct n2 AS node, count(n3.unfetched?) AS unfetched', {id : nodeFrom.id}, this);
              },
              function (err, results) {
                if (!err) {
                  u.each(results, function (row) {
                    if (!row.unfetched) {
                      process.nextTick(function () {
                        fireHooks(row.node);
                      });
                    }
                  });
                }

                callback();
              }
            );
          } else {
            pg.query('UPDATE urls SET completed = true WHERE url = $1', [page]);
            callback();
          }
        }
      );
    });
  };

  parseRelations = function (rel, window, linksOnly) {
    var authors = window.document.querySelectorAll('head > link[rel~="' + rel + '"]' + (linksOnly ? '' : ', a[rel~="' + rel + '"]')),
      result = {},
      relations = {},
      i,
      length,
      anchor,
      tmp,
      text;

    console.log("...found", authors.length, '"' + rel + '"-relations on "' + this.target + '".');

    for (i = 0, length = authors.length; i < length; i += 1) {
      anchor = authors[i];
      tmp = url.resolve(this.target, anchor.href);
      text = anchor.textContent;
      if (relations[tmp]) {
        if (relations[tmp].text.indexOf(text) === -1) {
          relations[tmp].text.push(text);
        }
      } else {
        relations[tmp] = {
          text : [text]
        };
      }
    }

    result[rel] = relations;

    return result;
  };

  parseDomDocument = function (err, window) {
    var result = {},
      response = this;
    if (err || !window) {
      console.log('Error in response from "' + this.target + '":');
      if (!u.isArray(err)) {
        err = [err];
      }
      err.forEach(function (err) {
        console.log(err.message);
      });
      response.callback(true);
    } else {
      step(
        function initializeParsing() {
          var group = this.group();
          response.parsers.forEach(function (parser) {
            var callback = group();
            process.nextTick(function () {
              try {
                callback(false, parser.call(response, window));
              } catch (e) {
                callback(true);
              }
            });
          });
        },
        function returnResult(err, parsedResults) {
          window.close();
          if (err) {
            process.nextTick(function () {
              response.callback(true);
            });
          } else {
            parsedResults.forEach(function (parsedResult) {
              u.extend(result, parsedResult);
            });
            process.nextTick(function () {
              response.callback(null, result);
            });
          }
        }
      );
    }
  };

  findRelations = function (target, callback, parsers) {
    console.log('Fetching', target, '...');

    //TODO: better headers - like Accept
    request(target, function (error, response, body) {
      var redirectedTemporarily, fakeResponse;

      if (error) {
        process.nextTick(callback.bind(undefined, true));
      } else if (response.statusCode === 200 && response.headers['content-type'] && response.headers['content-type'].split(';')[0] === 'text/html') {
        if (this.response.request.redirects[0] !== undefined && target !== response.request.href) {
          this.response.request.redirects.forEach(function (redirect) {
            if (redirect.statusCode !== 301) {
              redirectedTemporarily = true;
            }
          });

          fakeResponse = {};
          fakeResponse[redirectedTemporarily ? 'me' : 'canonical'] = {};
          fakeResponse[redirectedTemporarily ? 'me' : 'canonical'][response.request.href] = '';

          process.nextTick(callback.bind(undefined, null, fakeResponse));
        } else {
          jsdom.env({
            html : body,
            url : response.request.href,
            features : {
              FetchExternalResources   : [],
              ProcessExternalResources : false,
              MutationEvents           : false,
              QuerySelector            : true
            },
            done : parseDomDocument.bind({
              target : target,
              callback : callback,
              parsers : parsers,
              response : response
            })
          });
        }
      } else {
        if (response.statusCode === 200 && (!response.headers['content-type'] || response.headers['content-type'].split(';')[0] !== 'text/html')) {
          console.log('Non-supported content-type: ' + (response.headers['content-type'] || 'No content type at all!'));
        }
        //TODO: if 410 - then do not do anymore lookups
        process.nextTick(callback.bind(undefined, null, false));
      }
    });
  };

  //TODO: Add an error listener to the database connection
  pg.connect(function (error) {
    if (error) {
      //TODO: Retry later on
      console.log('Error connection to Postgres');
    }
  });

  pg.on('error', function () {
    //TODO: Reconnect with increasingly bigger time between each retry
  });

  toFetch();

  return {
    addNewUnfetchedPage : addNewUnfetchedPage,
    getRelated : getRelated
  };
};
