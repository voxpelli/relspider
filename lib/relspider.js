'use strict';

/*jslint node: true, indent: 2 */

var neo4jModule = require('neo4j'),
  pgModule = require('pg'),
  metrics = require('metrics'),
  request = require('request'),
  robots = require('robots'),
  jsdom = require('jsdom'),
  step = require('step'),
  url = require('url'),
  u = require('underscore'),
  genericMemcachedCache = require('genericcache').genericMemcachedCache,
  genericMemoryCache = require('genericcache').genericMemoryCache,
  genericCache = require('genericcache').genericCache,
  noop = function () {};

// Other things to do
//TODO: Replace polling for new pages to fetch with message queue based pushing?
//TODO: At upstart - check for any errors - like non-fired callbacks
//TODO: Add Neo4j indexes on "hasWebhooks" and "unfetched"

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
    neo4j : process.env.NEO4J_URL || process.env.GRAPHENEDB_URL || 'http://localhost:7474',
    pg : process.env.DATABASE_URL,
    parallelFetches : process.env.RELSPIDER_PARALLEL || 60,
    secondsToThrottle : Math.max(5, process.env.RELSPIDER_SECONDS_TO_THROTTLE || 10),
    maxPaus : 4,
    maximumAgeWithoutRequest : 1000 * 60 * 60 * 24 * 7, // A week in milliseconds
    minutesMinBetweenRefresh : 1,
    minutesToLock : 10,
    minutesUntilRefresh : 60 * 24,
    cache : process.env.RELSPIDER_CACHE || ((process.env.MEMCACHE_USERNAME || process.env.MEMCACHIER_USERNAME) ? 'memcached' : 'memory'),
    cacheOptions : {}
  });

  var neo4j = new neo4jModule.GraphDatabase(options.neo4j),
    pg = new pgModule.Client(options.pg),
    cache = genericCache(options.cache === 'memcached' ? genericMemcachedCache : genericMemoryCache, options.cacheOptions),
    crawlMetric = new metrics.Counter(),
    closingDown = false,
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
    forceRefresh,
    addNewUnfetchedPage,
    addAndConnectPage,
    toFetch,
    handleResponse,
    parseRelations,
    parseDomDocument,
    findRelations,
    removeFromFetchQueue,
    cleanupOnClose,
    close,
    nodetime,
    delayedFetch = false,
    fetchQueue = [];

  if (process.env.NODETIME_ACCOUNT_KEY) {
    nodetime = require('nodetime');
    nodetime.profile({
      accountKey: process.env.NODETIME_ACCOUNT_KEY,
      appName: 'RelSpider'
    });
  }

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
        try {
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
        } catch (error) {
          callback(true);
        }
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
    var query = 'START n=node({id}), n2=node(*) MATCH allShortestPaths(n-[:me|alias*..40]->n2) WHERE has(n2.unfetched) RETURN COUNT(n2) AS unfetched';

    neo4j.query(query, {id : node.id}, function (err, results) {
      if (err) {
        console.log('Neo4j error when looking for completeness of node ', node.id, ':', err, results);
        callback(true);
      } else {
        callback(null, results[0].unfetched === 0);
      }
    });
  };

  fetchRelatedURLs = function (node, callback) {
    var query = 'START n=node({id}), n2=node(*) MATCH allShortestPaths(n-[:me|alias*..40]->n2) OPTIONAL MATCH  n2-[:alias]->n3 WHERE n3 is null RETURN distinct n2.url AS url, has(n2.failed) AS failed';

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
          options = {
            url : page,
            requested : true
          };
          if (webhook) {
            options.hasWebhooks = true;
          }
          addNewUnfetchedPage(options, this);
        } else {
          pg.query("UPDATE urls SET requested = NOW() WHERE url = $1", [page]);
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

  forceRefresh = function (page, callback) {
    pg.query("UPDATE urls SET refresh = true, requested = NOW() WHERE url = $1 RETURNING url", [page], function (err, result) {
      if (err || result.length) {
        callback(err);
      } else {
        addNewUnfetchedPage({
          url : page,
          requested : true
        }, function (err) {
          callback(err);
        });
      }
    });
  };

  addNewUnfetchedPage = function (options, callback) {
    var page, requested, node;

    if (u.isString(options)) {
      options = { url : options };
    }

    options = u.defaults(options, {
      unfetched : true,
      requested : false
    });

    requested = options.requested;
    page = options.url;

    delete options.requested;

    if (!validURL(page)) {
      callback(true);
      return;
    }

    node = neo4j.createNode(options);

    step(
      function () {
        var host = url.parse(page).host;
        pg.query("INSERT INTO urls (url, host, added, requested) VALUES ($1, $2, NOW(), " + (requested ? 'NOW()' : 'NULL') + ")", [page, host], this);
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
          if (requested) {
            pg.query("UPDATE urls SET requested = NOW() WHERE url = $1", [page]);
          }
          callback(false, false, true);
        }
      },
      function (err) {
        if (err) {
          callback(true);
          return;
        }

        pg.query("UPDATE urls SET node = $1 WHERE url = $2", [node.id, page]);
        node.index('pages', 'url', page, noop);

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
          node.createRelationshipFrom(nodeFrom, relation, {}, noop);
          console.log('Connected', foundPage);
        }
        callback();
      }
    );
  };

  removeFromFetchQueue = function (page) {
    fetchQueue.splice(fetchQueue.indexOf(page), 1);
    if (closingDown && !fetchQueue.length) {
      cleanupOnClose()
    } else if (fetchQueue.length + 1 === options.parallelFetches) {
      console.log('Freeing up fetches!');
      process.nextTick(toFetch);
    }
  };

  toFetch = function (retryCount) {
    var query;

    // console.log('Searches for a page to fetch...');

    if (closingDown) {
      console.log('Closing down - not going to queue anything new');
      return;
    } else if (fetchQueue.length >= options.parallelFetches) {
      console.log('Reached max parallell fetches!');
      return;
    }

    query = "SELECT url FROM urls u" +
      " LEFT JOIN hosts h ON u.host = h.host" +
      " WHERE u.disallowed = false AND u.failed < 3 AND u.node IS NOT NULL" +
      "   AND (h.fetched IS NULL OR h.fetched < NOW() - interval '" + parseInt(options.secondsToThrottle, 10) + " seconds')" +
      "   AND (u.completed = false OR u.refresh = true OR u.fetched < NOW() - interval '" + parseInt(options.minutesUntilRefresh, 10) + " minutes')" +
      "   AND (u.locked IS NULL OR u.locked < NOW() - interval '" + parseInt(options.minutesToLock, 10) + " minutes')" +
      " ORDER BY u.completed ASC, u.refresh DESC, u.fetched ASC, u.added ASC";

    pg.query("UPDATE urls SET locked = NOW() WHERE url = (" + query + " LIMIT 1) RETURNING url, completed, requested", [], function (err, result) {
      if (err || !result.rowCount) {
        retryCount = Math.min(options.maxPaus, retryCount ? retryCount + 1 : 1);

        // console.log('No page found - pausing for ' + Math.pow(2, retryCount - 1) + ' seconds. Time now: ' + (new Date()).toISOString());

        delayedFetch = setTimeout(function () {
          delayedFetch = false;
          toFetch(retryCount);
        }, 1000 * Math.pow(2, retryCount - 1));

        return;
      }

      var page = result.rows[0].url,
        completed = result.rows[0].completed,
        requested = result.rows[0].requested;

      fetchQueue.push(page);

      process.nextTick(toFetch);

      step(
        //TODO: The below won't work for circular relations :/ Need to have request times in Neo4j for that to work
        function () {
          var nodeFrom, that = this;

          if (!requested || (Date.now() - Date.parse(requested) > options.maximumAgeWithoutRequest)) {
            step(
              function () {
                fetchNodeForPage(page, this);
              },
              function (err, result) {
                //TODO: Add error handling
                nodeFrom = result;
                nodeFrom.incoming(['alias', 'me'], this);
              },
              function (err, relations) {
                //TODO: Add error handling
                if (relations.length) {
                  that();
                } else {
                  console.log('Removing unwanted page ', page);
                  var group = this.group();
                  pg.query("DELETE FROM urls WHERE url = $1", [page], group());
                  nodeFrom.del(group(), true);
                }
              },
              function () {
                removeFromFetchQueue(page);
              }
            );
          } else {
            this();
          }
        },
        function () {
          checkThrottled(page, this);
        },
        function (err, throttled) {
          if (!err && !throttled) {
            checkRobotsTxt(page, this);
          } else {
            // Retry as soon as possible - the fetching query will know when the throttling has cleared
            pg.query("UPDATE urls SET locked = NOW() - interval '" + parseInt(options.minutesToLock, 10) + " minutes' WHERE url = $1", [page]);
            removeFromFetchQueue(page);
          }
        },
        function (err, allowed) {
          var callbacks;

          if (allowed) {
            findRelations(page, function (err, result) {
              handleResponse(err, page, result, completed);
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
              pg.query("UPDATE urls SET disallowed = true WHERE url = $1", [page], callbacks());
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

  handleResponse = function (err, page, result, refresh) {
    // console.log('Handling response for ' + page);

    var updateFetchStatus, callback = removeFromFetchQueue;

    updateFetchStatus = function () {
      pg.query("UPDATE urls SET fetched = NOW(), failed = 0, refresh = false, completed = true, locked = NOW() + interval '" + parseInt(options.minutesMinBetweenRefresh, 10) + " minutes' - interval '" + parseInt(options.minutesToLock, 10) + " minutes' WHERE url = $1", [page]);
    };

    if (err || result === false) {
      //TODO: If refresh - what to do?
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
          if (refresh) {
            nodeFrom.outgoing(['alias', 'me'], this);
          } else {
            this(null, []);
          }
        },
        function (err, relations) {
          var that = this;

          if (err) {
            this();
          } else {
            result.canonical = u.omit(result ? result.canonical : {}, page);
            result.me = u.omit(result ? result.me : {}, page);

            step(
              function () {
                var group = this.group(), mapping = { 'alias' : 'canonical', 'me' : 'me' };

                // Remove and persists existing relations
                relations.forEach(function (relation) {
                  neo4j.getNodeById(relation.end.id, group());
                });
              },
              function (err, nodes) {
                var group, nodesById = {}, mapping = { 'alias' : 'canonical', 'me' : 'me' };

                if (err) {
                  this();
                  return;
                }

                group = this.group();

                nodes.forEach(function (node) {
                  nodesById[node.id] = node;
                });
                relations.forEach(function (relation) {
                  var node = nodesById[relation.end.id];
                  if (result[mapping[relation.type]][node.data.url] !== undefined) {
                    console.log('Persisting old relation from', page, 'to', node.data.url);
                    delete result[mapping[relation.type]][node.data.url];
                  } else {
                    console.log('Removing old relation from', page, 'to', node.data.url);
                    relation.del(group());
                  }
                });
              },
              function () {
                var group = this.group();

                // Add new relations
                u.each(result.canonical, function (data, foundPage) {
                  console.log('Adding new relation from', page, 'to', foundPage);
                  addAndConnectPage(foundPage, nodeFrom, 'alias', group());
                });
                u.each(result.me, function (data, foundPage) {
                  console.log('Adding new relation from', page, 'to', foundPage);
                  addAndConnectPage(foundPage, nodeFrom, 'me', group());
                });
              },
              function (err) {
                if (err) {
                  console.log('There was an error in the adding of relations - we should retry later on');
                }
                that();
              }
            )
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

                updateFetchStatus();

                if (nodeFrom.data.hasWebhooks && (!result || u.isEmpty(result.me))) {
                  process.nextTick(function () {
                    fireHooks(nodeFrom);
                  });
                }

                // console.log('Checking for nodes with a callback that are related to ' + page);
                neo4j.query('START n=node({id}), n2=node(*), n3=node(*) MATCH allShortestPaths(n<-[:me|alias*..40]-n2), allShortestPaths(n2-[:me|alias*..40]->n3) WHERE n2.hasWebhooks! = true RETURN distinct n2 AS node, count(n3.unfetched?) AS unfetched', {id : nodeFrom.id}, this);
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
            updateFetchStatus();
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

    crawlMetric.inc();

    //TODO: better headers - like Accept
    request({
      uri : target,
      followRedirect : false
    }, function (error, response, body) {
      var fakeResponse, location;

      if (error) {
        process.nextTick(callback.bind(undefined, true));
      } else if (response.statusCode >= 300 && response.statusCode < 400) {
        location = url.resolve(target, response.headers.location);
        fakeResponse = {};
        fakeResponse[response.statusCode === 301 ? 'canonical' : 'me'] = {};
        fakeResponse[response.statusCode === 301 ? 'canonical' : 'me'][location] = '';
        process.nextTick(callback.bind(undefined, null, fakeResponse));
        console.log('Redirect', response.statusCode, 'from', target, 'to', location);
      } else if (response.statusCode === 200 && response.headers['content-type'] && response.headers['content-type'].split(';')[0] === 'text/html' && body && body.trim()) {
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
      } else {
        if (response.statusCode === 200 && (!response.headers['content-type'] || response.headers['content-type'].split(';')[0] !== 'text/html')) {
          console.log('Non-supported content-type: ' + (response.headers['content-type'] || 'No content type at all!'));
        }
        //TODO: if 410 - then do not do anymore lookups
        process.nextTick(callback.bind(undefined, null, false));
      }
    });
  };

  cleanupOnClose = function () {
    pg.end();
    cache.close();

    if (process.env.NODETIME_ACCOUNT_KEY) {
      nodetime.destroy();
    }
  };

  close = function () {
    closingDown = true;
    if (delayedFetch) {
      clearTimeout(delayedFetch);
      delayedFetch = false;
    }
    if (!fetchQueue.length) {
      cleanupOnClose();
    }
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
    forceRefresh : forceRefresh,
    getRelated : getRelated,
    close : close
  };
};
