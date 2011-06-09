var Step = require('step'),
  HTML5 = require('html5'),
  jsdom = require('jsdom'),
  url = require('url'),
  _ = require('underscore'),
  parseRels2, findRels2;

parseRels2 = function (rel, window) {
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


findRels2 = (function () {
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

module.exports = function (callback, directory) {
  Step(
    function lookup() {
      var group = this.group(),
        lookup = false;

      Object.keys(directory).forEach(function (page) {
        var callback;

        if (!directory[page].fetched && !directory[page].fetching) {
          callback = group();
          directory[page].fetching = true;
          lookup = true;

          findRels2(page, function (result) {
              directory[page].fetched = Date.now();
              delete directory[page].fetching;
              directory[page].relations = directory[page].relations || {};

              Object.keys(result).forEach(function (rel) {
                directory[page].relations[rel] = directory[page].relations[rel] || {};

                Object.keys(result[rel]).forEach(function (relation) {
                  if (page === relation) {
                    return;
                  }

                  directory[page].relations[rel][relation] = result[rel][relation];

                  directory[relation] = directory[relation] || {};

                  directory[relation].relationsReverse = directory[relation].relationsReverse || {};
                  directory[relation].relationsReverse[rel] = directory[relation].relationsReverse[rel] || [];

                  if (directory[relation].relationsReverse[rel].indexOf(page) === -1) {
                    directory[relation].relationsReverse[rel].push(page);
                  }

                  if (directory[page].relationsReverse && directory[page].relationsReverse[rel] && directory[page].relationsReverse[rel].indexOf(relation) !== -1) {
                    directory[page].relationsBidirectional = directory[page].relationsBidirectional || {};
                    directory[page].relationsBidirectional[rel] = directory[page].relationsBidirectional[rel] || [];

                    directory[relation].relationsBidirectional = directory[relation].relationsBidirectional || {};
                    directory[relation].relationsBidirectional[rel] = directory[relation].relationsBidirectional[rel] || [];

                    if (directory[page].relationsBidirectional[rel].indexOf(relation) === -1) {
                      directory[page].relationsBidirectional[rel].push(relation);
                      directory[relation].relationsBidirectional[rel].push(page);
                    }
                  }
                });
              });

              callback();
            }, [
              function (window) {
                return parseRels2.call(this, 'author', window);
              },
              function (window) {
                return parseRels2.call(this, 'me', window);
              }
            ]);
        }
      });
      if (!lookup) {
        group()(false, false);
      }
    },
    function (err, results) {
      callback(results[0] === false);
    }
  );
};
