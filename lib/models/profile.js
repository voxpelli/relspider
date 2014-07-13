"use strict";

var _ = require('underscore')
  , bookshelf = require('../utils/bookshelf')
  , knex = bookshelf.knex
  , options = require('../config')
  , Host = require('./host')
  , neo4j = require('../utils/neo4j')
  , NotFoundError = require('../utils/errors').NotFoundError
  , Promise = require('promise')
  , robots = require('robots')
  , VError = require('verror')
  , dns = require('dns')
  , url = require('url')
  , request = require('../utils/request')
  , urlTools = require('../utils/url-tools')
  , Profile
  , ensureCrawlable
  , createNode
  , destroyNode
  , updateNode
  , getNode
  , getIncomingRelations
  , fireWebHooks
  , checkReadyWebHooks
  , flagAsFetched
  , flagAsFailed
  , reserveHost
  , isGraphComplete
  , getRelated
  , getFriendsFeeds
  , getRelations
  , setRelations
  , addRelation
  , unwanted
  , createProfile
  , reserveProfile
  , forceRefresh
  , getByNode
  , getRelatedByUrl
  , getFriendsFeedsByUrl
  , knexTrue = knex.raw('true')
  , knexFalse = knex.raw('false')
  , knexNow = knex.raw('NOW()')
  , relationMapping = {
    'alias' : 'canonical',
    'me' : 'me',
  };

if (options.crawlXFN) {
  relationMapping.friend = 'contact';
}
if (options.crawlFeeds) {
  relationMapping.feed = 'alternate';
}

ensureCrawlable = function () {
  var profileUrl = this.get('url');

  return urlTools.cacheURL(url.resolve(profileUrl, '/robots.txt'), 60 * 60 * 24).then(function (result) {
    if (result === false) {
      // We don't know whether we're allowed to crawl it yet
      return null;
    }

    return new Promise(function (resolve) {
      var parser = new robots.RobotsParser();
      parser.parse(result);
      parser.canFetch('RelSpider', profileUrl, function (access) {
        resolve(access);
      });
    }).then(function (access) {
      return access ? true : this.save({ disallowed: true }, { patch: true }).then(function () {
        return false;
      });
    });
  }).then(undefined, function (err) {
    throw new VError(err, 'failed to check crawlability of "%s"', profileUrl);
  });
};

createNode = function (options) {
  options = _.defaults({}, options, {
    url: this.get('url')
  });

  if (!this.has('fetched')) {
    options.unfetched = true;
  }

  var node = neo4j.createNode(options);

  return new Promise(function (resolve, reject) {
    node.save(function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(node);
      }
    });
  }).then(function (node) {
    this.fullNode = node;

    return Promise.all([
      this.save({ node: node.id }, { patch: true }),
      new Promise(function (resolve, reject) {
        node.index('pages', 'url', options.url, function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
    ]).then(function () {
      return node;
    });
  }.bind(this));
};

destroyNode = function () {
  //TODO: Throw some proper errors?
  console.log('Destroying node');
  this.getNode().then(function (node) {
    if (node) {
      node.del(function (err) {
        if (err) {
          console.error('Couldn\'t destroy node, got error:', err);
        }
      }, true);
    }
  }, function (err) {
    console.error('Couldn\'t find node to destroy, got error:', err);
  });
};

updateNode = function (attr) {
  var profileUrl = this.get('url');

  return this.getNode().then(function (node) {
    if (!node) {
      throw new NotFoundError('No node to update for profile "%s"', profileUrl);
    }

    var changed = false;

    _.each(attr, function (value, key) {
      if (value === null) {
        if (node.data[key] !== undefined) {
          delete node.data[key];
          changed = true;
        }
      } else if (node.data[key] !== value) {
        node.data[key] = value;
        changed = true;
      }
    });

    if (!changed) {
      return node;
    }

    return new Promise(function (resolve, reject) {
      node.save(function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(node);
        }
      });
    });
  }).then(undefined, function (err) {
    throw new VError(err, 'failed to update node for "%s"', profileUrl);
  });
};

getNode = function () {
  if (this.fullNode) {
    return Promise.resolve(this.fullNode);
  } else if (this.has('node')) {
    return new Promise(function (resolve, reject) {
      neo4j.getNodeById(this.get('node'), function (err, node) {
        if (err) {
          reject(new VError(err, 'failed to get node "%d"', this.get('node')));
        } else {
          if (node) {
            this.fullNode = node;
          }

          resolve(node);
        }

      }.bind(this));
    }.bind(this));
  } else {
    return Promise.resolve(false);
  }
};

isGraphComplete = function () {
  //TODO: Do we need to check if this.get('node') contains a value?
  var nodeId = this.get('node');

  return new Promise(function (resolve, reject) {
    //TODO: Maybe replace first relation with 'n-[:me|alias*..' + options.maxJumpsAway + ']'
    var query = 'START n=node({id}), n2=node(*) MATCH shortestPath(n-[:me|alias*]->n2) WHERE has(n2.unfetched) RETURN COUNT(n2) AS unfetched';

    neo4j.query(query, { id : nodeId }, function (err, results) {
      if (err) {
        console.log('Neo4j error when looking for completeness of node ', nodeId, ':', err, results);
        reject(err);
      } else {
        resolve(results[0].unfetched === 0);
      }
    });
  }.bind(this));
};

getRelated = function () {
  var nodeId = this.get('node');

  return new Promise(function (resolve, reject) {
    //TODO: Maybe replace first relation with 'n-[:me|alias*..' + options.maxJumpsAway + ']'
    var query = 'START n=node({id}), n2=node(*) MATCH shortestPath(n-[:me|alias*]->n2) OPTIONAL MATCH  n2-[:alias]->n3 WITH n2, n3 WHERE n3 is null RETURN distinct n2.url AS url, has(n2.failed) AS failed';

    //TODO: Do we need to check if this.get('node') contains a value?
    neo4j.query(query, { id : nodeId }, function (err, results) {
      if (err) {
        reject(err);
      } else {
        var result = { incomplete : false };
        result.urls = _.map(results, function (row) {
          if (row.failed) {
            result.incomplete = true;
          }
          return row.url;
        });
        resolve(result);
      }
    });
  });
};

getFriendsFeeds = function () {
  var nodeId = this.get('node');

  return new Promise(function (resolve, reject) {
    //TODO: Maybe replace first relation with 'n-[:me|alias*..' + options.maxJumpsAway + ']'
    var query = 'START n=node({id}), n2=node(*) MATCH shortestPath(n-[:me|alias*..]->n2) MATCH p = n2-[:friend]->()-[:alias*0..]->()-[:me*0..2]->()-[:alias*0..]->(friend)-[:feed]->feed WITH friend, feed ORDER BY feed.url ASC WITH distinct friend, HEAD(collect(feed.url)) as feedUrl RETURN friend.url AS friendUrl, feedUrl';

    //TODO: Do we need to check if this.get('node') contains a value?
    neo4j.query(query, { id : nodeId }, function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(_.map(results, function (row) {
          return {
            url : row.friendUrl,
            feed : row.feedUrl,
          };
        }));
      }
    });
  });
};

getIncomingRelations = function () {
  return this.getRelations(true);
};

getRelations = function (incoming) {
  return this.getNode().then(function (node) {
    if (!node) {
      throw new NotFoundError('couldn\'t find node "%d"', this.get('node'));
    }
    return new Promise(function (resolve, reject) {
      node[incoming ? 'incoming' : 'outgoing'](_.keys(relationMapping), function (err, relations) {
        if (err) {
          reject(new VError(err, 'failed to get relations for "%d"', this.get('node')));
        } else {
          resolve(relations);
        }
      });
    });
  });
};

setRelations = function (newRelations) {
  var profileUrl = this.get('url');

  _.each(newRelations, function (targets, rel) {
    newRelations[rel] = _.omit(targets, profileUrl);
  });

  return this.getRelations().then(function (currentRelations) {
    return Promise.all(_.map(currentRelations, function (relation) {
      return new Promise(function (resolve, reject) {
        neo4j.getNodeById(relation.end.id, function (err, node) {
          if (err) {
            reject(err);
          } else {
            resolve(node);
          }
        });
      });
    })).then(function (currentNodes) {
      var nodesById = {};

      _.each(currentNodes, function (node) {
        nodesById[node.id] = node;
      });

      return Promise.all(_.map(currentRelations, function (relation) {
        var node = nodesById[relation.end.id];

        if (newRelations[relationMapping[relation.type]][node.data.url] !== undefined) {
          console.log('Persisting old relation from', profileUrl, 'to', node.data.url);

          delete newRelations[relationMapping[relation.type]][node.data.url];
        } else {
          console.log('Removing old relation from', profileUrl, 'to', node.data.url);

          return new Promise(function (resolve, reject) {
            relation.del(function (err) {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          });
        }
      }));
    });
  })
  .then(function () {
    //TODO: Do we ensure that we only add each relation once even if it appears multiple time in the same source?

    // Add new relations
    var addingRelations = [];

    // Add new relations
    _.each(relationMapping, function (htmlRel, nodeRel) {
      addingRelations = addingRelations.concat(_.map(newRelations[htmlRel], function (data, targetPageUrl) {
        console.log('Adding', nodeRel, 'relation from', profileUrl, 'to', targetPageUrl);
        return this.addRelation(nodeRel, targetPageUrl);
      }.bind(this)));
    }.bind(this));

    return Promise.all(addingRelations);
  }.bind(this));
};

addRelation = function (type, targetUrl) {
  return Profile.create(targetUrl)
    .then(function (newProfile) {
      return Promise.all([
        this.getNode(),
        newProfile.getNode(),
      ]);
    }.bind(this))
    .then(function (nodes) {
      var nodeFrom = nodes[0], nodeTo = nodes[1];
      if (!nodeFrom || !nodeTo) {
        return;
      }
      return new Promise(function (resolve, reject) {
        nodeTo.createRelationshipFrom(nodeFrom, type, {}, function (err) {
          if (err) {
            reject(err);
          } else {
            console.log('Connected', targetUrl);
            resolve();
          }
        });
      });
    });
};

fireWebHooks = function () {
  var profileUrl = this.get('url');

  console.log('Firing hooks for ', profileUrl);

  return knex('webhooks')
    .where('url', profileUrl)
    .andWhere(function () {
      this.where('fired', '<', knex.raw("NOW() - interval '" + options.timings.minutesToLock + " minutes'"))
        .orWhereNull('fired');
    })
    .update('fired', knex.raw('NOW()'))
    .returning('hook')
    .then(function (hooks) {
      if (!hooks.length) {
        return;
      }

      return this.getRelated().then(function (related) {
        return Promise.all(_.map(hooks, function (hook) {
          console.log('Firing hook', hook);

          var body = {
            url : profileUrl,
            related : related.urls,
          };

          if (related.incomplete) {
            body.incomplete = true;
          }

          return request.promise(hook, {
            method : 'POST',
            json : body
          }).then(function (response) {
            if (response.statusCode === 200) {
              console.log('Successfully fired hook', hook);
            } else {
              console.err('Failed to fire hook', hook, '– got response code: ', response.statusCode);
            }

            return knex('webhooks').where({
              hook: hook,
              url: profileUrl,
            }).del();
          });
        }));
      });

    }.bind(this))
    .then(this.updateNode.bind(this, { hasWebhooks : null }))
    .then(undefined, function (err) {
      console.error('Encountered an error while firing WebHook for', profileUrl, ':', err.message);
      console.log(err.stack);
    });
};

checkReadyWebHooks = function () {
  var profileInstance = this;

  return this.getNode()
    .then(function (node) {
      if (node.data.hasWebhooks) {
        return profileInstance.getRelations().then(function (relations) {
          return [node, relations];
        });
      }
      return [node];
    })
    .then(function (result) {
      var node = result[0], relations = result[1] || false;

      if (_.isArray(relations) && !relations.length) {
        profileInstance.fireWebHooks();
      }

      return new Promise(function (resolve, reject) {
        //TODO: Can we optimize the following query? it seems to be pretty slow!
        //TODO: Maybe replace first relation with 'n-[:me|alias*..' + options.maxJumpsAway + ']'
        neo4j.query('START n=node({id}), n2=node(*), n3=node(*) MATCH allShortestPaths(n<-[:me|alias*]-n2), allShortestPaths(n2-[:me|alias*]->n3) WHERE has(n2.hasWebhooks) RETURN distinct n2 AS node, max(n3.unfetched) AS unfetched', {id : node.id}, function (err, result) {
          if (err) {
            reject(err);
          } else {
            _.chain(result)
              .filter(function (row) {
                return !row.unfetched;
              })
              .map(function (row) {
                return row.node;
              })
              .tap(resolve);
          }
        });
      });
    })
    .then(function (rows) {
      return rows;
    })
    .then(Profile.getByNode.bind(Profile))
    .then(function (profileInstances) {
      _.invoke(profileInstances, 'fireWebHooks');
    });
};

flagAsFetched = function () {
  var profileUrl = this.get('url');

  return this.updateNode({
    failed: null,
    unfetched: null,
  })
  .then(function () {
    //TODO: Enable to actually save this through .save();
    //TODO: That probably means making Bookshelf first save the actual raw NOW() and then sync back the actual data to the model
    return knex('urls')
      .where('url', profileUrl)
      .update({
        fetched: knexNow,
        failed: 0,
        refresh: knexFalse,
        completed: knexTrue,
        locked: knex.raw(
          'NOW()' +
          " + interval '" + options.timings.minMinutesBetweenRefresh + " minutes'" +
          " - interval '" + options.timings.minutesToLock + " minutes'"
        ),
      });
  })
  .then(this.checkReadyWebHooks.bind(this));
  //TODO: Handle a rejected promise?
};

flagAsFailed = function () {
  console.log('Marking page as failed: ' + this.get('url'));

  return Promise.all([
    knex('urls').where('url', this.get('url')).update('failed', knex.raw('failed + 1')),
    this.getNode().then(function (node) {
      if (!node) {
        return;
      }
      return new Promise(function (resolve, reject) {
        node.data.failed = true;
        delete node.data.unfetched;
        node.save(function (err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }).then(function () {
        if (node.data.hasWebhooks) {
          console.log('Failed, so firing webhooks!');
          this.fireWebHooks();
        }
      }.bind(this));
    }.bind(this))
  ]);
};

reserveHost = function () {
  var profileUrl = this.get('url');

  return Host.reserve(this.get('host'), this.get('ip')).then(function (reserved) {
    if (reserved) {
      return true;
    }

    // Release this profile to retry as soon as possible. The fetching query will know when the throttling has cleared
    knex('urls')
      .where('url', profileUrl)
      .update('locked', knex.raw("NOW() - interval '" + options.timings.minutesToLock + " minutes'"))
      .then(function () {
        return false;
      });
  });
};

unwanted = function () {
  if (!this.has('requested') || (Date.now() - Date.parse(this.get('requested')) > options.timings.maxAgeWithoutRequest)) {
    return this.getIncomingRelations().then(function (relations) {
      return relations.length ? false : true;
    }).then(undefined, function (err) {
      if (err.name === 'NotFoundError') {
        return true;
      }
      throw err;
    });
  } else {
    return Promise.resolve(false);
  }
};

createProfile = function (options) {
  var pageUrl, requested, host;

  if (_.isString(options)) {
    options = { url : options };
  }

  options = _.defaults(options, {
    unfetched : true,
    requested : false
  });

  requested = options.requested;
  pageUrl = options.url;

  delete options.requested;

  if (!urlTools.validURL(pageUrl)) {
    return Promise.reject(new TypeError('failed to create profile, invalid URL'));
  }

  host = url.parse(pageUrl).hostname;

  return Promise.denodeify(dns.lookup)(host).then(function (ip) {
    return knex('urls')
      .insert({
        url: pageUrl,
        host: host,
        ip: ip,
        added: knexNow,
        requested: requested ? knexNow : null,
      })
      .returning('*')
      .map(function (row) {
        return this.forge(row);
      }.bind(this));
  }.bind(this))
    .then(function (rows) {
      return rows[0].createNode(options).then(function () {
        return rows[0];
      });
    })
    .then(undefined, function (err) {
      // If there's already such a profile URL, then we will receive this error
      if (parseInt(err.code, 10) === 23505) {
        var result;

        if (requested) {
          result = knex('urls')
            .where('url', pageUrl)
            .update('requested', knexNow);
        } else {
          result = Promise.resolve();
        }

        return result.then(function () {
          return new Profile({ url: pageUrl}).fetch();
        });
      } else {
        throw err;
      }
    });
};

reserveProfile = function () {
  var availableUrl = knex('urls')
    .first('url')
    .groupBy('url')
    .leftJoin('hosts', function() {
      this.on('urls.host', '=', 'hosts.host').orOn('urls.ip', '=', 'hosts.ip');
    })
    .havingRaw("max(hosts.fetched) IS NULL OR max(hosts.fetched) < NOW() - interval '" + options.timings.secondsToThrottle + " seconds'")
    .where('urls.disallowed', knexFalse)
    .where('urls.failed', '<', 3)
    .whereNotNull('urls.node')
    .where(function() {
      this
        .where('urls.completed', knexFalse)
        .orWhere('urls.refresh', knexTrue)
        .orWhere('urls.fetched', '<', knex.raw("NOW() - interval '" + options.timings.minutesUntilRefresh + " minutes'"));
    })
    .where(function() {
      this
        .whereNull('urls.locked')
        .orWhere('urls.locked', '<', knex.raw("NOW() - interval '" + options.timings.minutesToLock + " minutes'"));
    })
    .orderBy('urls.completed', 'ASC')
    .orderBy('urls.refresh', 'DESC')
    .orderBy('urls.fetched', 'ASC')
    .orderBy('urls.added', 'ASC');

  return knex('urls')
    .where('url', 'in', availableUrl)
    .update('locked', knexNow)
    .returning('*')
    .map(function (row) {
      return this.forge(row);
    }.bind(this))
    .then(function (rows) {
      return rows[0] || false;
    });
};

forceRefresh = function (profileUrl) {
  return knex('urls')
    .where('url', profileUrl)
    .update({
      refresh: knexTrue,
      requested: knexNow,
    })
    .returning('*')
    .map(function (row) {
      return this.forge(row);
    }.bind(this))
    .then(function (rows) {
      if (rows.length) {
        return rows[0];
      }
      return this.create({
        url : profileUrl,
        requested : true,
      });
    }.bind(this));
};

getByNode = function (nodes) {
  nodes = _.isArray(nodes) ? nodes : [nodes];

  return Promise.all(_.map(nodes, function (node) {
    return new Profile({ node : node.id }).fetch();
  }));
};

getRelatedByUrl = function (pageUrl, webhook) {
  var options = {
    url : pageUrl,
    requested : true,
  };

  return this.create(options).then(function (profileInstance) {
    return profileInstance.isGraphComplete().then(function (complete) {
      if (complete) {
        return profileInstance.getRelated();
      } else if (webhook && !urlTools.validURL(webhook)) {
        throw new TypeError('failed to add webhook, invalid URL');
      } else if (webhook) {
        return knex('webhooks').insert({
          hook: webhook,
          url: profileInstance.get('url'),
          added: knex.raw('NOW()'),
        })
        .then(function () {
          console.log('Setting webhooks property!');
          return profileInstance.updateNode({ hasWebhooks: true });
        })
        .then(profileInstance.isGraphComplete.bind(profileInstance))
        .then(function (complete) {
          if (complete) {
            console.log('Completed while creating, triggering!');
            profileInstance.fireWebHooks();
          }
          return false;
        });
      }

      return false;
    });
  });
};

getFriendsFeedsByUrl = function (pageUrl) {
  return this.create({
    url : pageUrl,
    requested : true,
  }).then(function (profileInstance) {
    return profileInstance.getFriendsFeeds();
  });
};

Profile = bookshelf.Model.extend({
  tableName: 'urls',
  idAttribute: 'url',

  initialize: function() {
    this.on('destroyed', this.destroyNode);
  },

  ensureCrawlable: ensureCrawlable,
  createNode: createNode,
  destroyNode: destroyNode,
  updateNode: updateNode,
  getNode: getNode,
  getIncomingRelations: getIncomingRelations,
  fireWebHooks: fireWebHooks,
  checkReadyWebHooks: checkReadyWebHooks,
  flagAsFetched: flagAsFetched,
  flagAsFailed: flagAsFailed,
  reserveHost: reserveHost,
  isGraphComplete: isGraphComplete,
  getRelated: getRelated,
  getFriendsFeeds: getFriendsFeeds,
  getRelations: getRelations,
  setRelations: setRelations,
  addRelation: addRelation,
  unwanted: unwanted,
}, {
  create: createProfile,
  reserve: reserveProfile,
  forceRefresh: forceRefresh,
  getByNode: getByNode,
  getRelated: getRelatedByUrl,
  getFriendsFeeds: getFriendsFeedsByUrl,
});

module.exports = Profile;
