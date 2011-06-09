var Step = require('step'),
  HTML5 = require('html5'),
  jsdom = require('jsdom'),
  url = require('url'),
  _ = require('underscore'),
  // Core fetching functions
  parseRelations, findRelations,
  // Pluggable functions for saving relations
  toFetch, handleResponse, addRelation, addReverseRelation, checkBidirectionalRelation;

parseRelations = function (rel, window) {
  var $authors = window.$('a[rel~="' + rel + '"], head > link[rel~="' + rel + '"]'),
    result = {},
    relations = {},
    i, length, $anchor, tmp, text;

  console.log("...found", $authors.length, '"' + rel + '"-relations on "' + this.target + '".');

  for (i = 0, length = $authors.length; i < length; i++) {
    $anchor = window.$($authors[i]);
    tmp = url.resolve(this.target, $anchor.attr('href'));
    text = $anchor.text();
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

findRelations = (function () {
  var responseHandler;

  responseHandler = function (err, window) {
    var result = {},
      response = this;
    if (err || !window) {
      console.log('Error in response from "' + this.target + '":');
      err.forEach(function (err) {
        console.log(err.message);
      });
      response.callback(result);
    }
    else {
      Step(
        function initializeParsing() {
          var group = this.group();
          response.parsers.forEach(function (parser) {
            var callback = group();
            process.nextTick(function () {
              callback(false, parser.call(response, window));
            });
          });
        },
        function returnResult(err, parsedResults) {
          parsedResults.forEach(function (parsedResult) {
            _.extend(result, parsedResult);
          });
          response.callback(result);
        }
      );
    }
  };

  return function (target, callback, parsers) {
    console.log('Fetching', target, '...');
    jsdom.env(
      target,
      ['file://' + __dirname + '/jquery.js'],
      {parser: HTML5},
      responseHandler.bind({
        target : target,
        callback : callback,
        parsers : parsers
      })
    );
  };
}());

toFetch = function (callback) {
  var dictionary = this.dictionary,
    result = [];

  Object.keys(dictionary).forEach(function (page) {
    if (!dictionary[page].fetched) {
      result.push(page);
    }
  });

  callback(result);
};
handleResponse = function (page, result, callback) {
  var dictionary = this.dictionary,
    options = this;

  dictionary[page].fetched = Date.now();

  Object.keys(result).forEach(function (rel) {
    Object.keys(result[rel]).forEach(function (relation) {
      if (page === relation) {
        return;
      }

      options.addRelation(page, rel, relation, result[rel][relation]);
      options.addReverseRelation(page, rel, relation);
      options.checkBidirectionalRelation(page, rel, relation);
    });
  });

  callback();
};
addRelation = function (page, rel, relation, data) {
  var dictionary = this.dictionary;

  dictionary[page].relations = dictionary[page].relations || {};
  dictionary[page].relations[rel] = dictionary[page].relations[rel] || {};
  dictionary[page].relations[rel][relation] = data;
};
addReverseRelation = function (page, rel, relation) {
  var dictionary = this.dictionary;

  dictionary[relation] = dictionary[relation] || {};
  dictionary[relation].relationsReverse = dictionary[relation].relationsReverse || {};
  dictionary[relation].relationsReverse[rel] = dictionary[relation].relationsReverse[rel] || [];

  if (dictionary[relation].relationsReverse[rel].indexOf(page) === -1) {
    dictionary[relation].relationsReverse[rel].push(page);
  }
};
checkBidirectionalRelation = function (page, rel, relation) {
  var dictionary = this.dictionary;

  if (dictionary[page].relationsReverse && dictionary[page].relationsReverse[rel] && dictionary[page].relationsReverse[rel].indexOf(relation) !== -1) {
    dictionary[page].relationsBidirectional = dictionary[page].relationsBidirectional || {};
    dictionary[page].relationsBidirectional[rel] = dictionary[page].relationsBidirectional[rel] || [];

    dictionary[relation].relationsBidirectional = dictionary[relation].relationsBidirectional || {};
    dictionary[relation].relationsBidirectional[rel] = dictionary[relation].relationsBidirectional[rel] || [];

    if (dictionary[page].relationsBidirectional[rel].indexOf(relation) === -1) {
      dictionary[page].relationsBidirectional[rel].push(relation);
      dictionary[relation].relationsBidirectional[rel].push(page);
    }
  }
};

module.exports = function (callback, options) {
  options = options || {};

  _.defaults(options, {
    dictionary : {},
    toFetch : toFetch,
    handleResponse : handleResponse,
    addRelation : addRelation,
    addReverseRelation : addReverseRelation,
    checkBidirectionalRelation : checkBidirectionalRelation
  });

  options.toFetch(function (result) {
    console.log(result);
    if (result[0] === undefined) {
      callback(true);
      return;
    }

    Step(
      function lookup() {
        var group = this.group();

        result.forEach(function (page) {
          var callback = group();

          findRelations(page, function (result) {
              options.handleResponse(page, result, callback);
            }, [
              function (window) {
                return parseRelations.call(this, 'author', window);
              },
              function (window) {
                return parseRelations.call(this, 'me', window);
              }
            ]);
        });
      },
      function (err, results) {
        if (err) {
          console.log(err.message);
          console.log(err.stack);
        }
        callback(err == true);
      }
    );
  });
};
