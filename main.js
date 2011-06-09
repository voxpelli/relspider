var Step = require('step'),
  HTML5 = require('html5'),
  jsdom = require('jsdom'),
  url = require('url'),
  _ = require('underscore'),
  article = 'http://www.youtube.com/watch?v=UvXUkXvunlw',
  levels = 5,
  directory = {},
  lookupRelations2, parseRels2, findRels2;

if (process.argv[2]) {
  article = process.argv[2];
}
if (process.argv[3]) {
  levels = parseInt(process.argv[3], 10);
}

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
      ['http://ajax.googleapis.com/ajax/libs/jquery/1.6/jquery.min.js'],
      {parser: HTML5},
      responseHandler.bind({
        target : target,
        callback : callback,
        parsers : parsers
      })
    );
  };
}());

directory[article] = false;

lookupRelations2 = function (callback) {
  Step(
    function lookup() {
      var group = this.group(),
        lookup = false;

      Object.keys(directory).forEach(function (page) {
        var callback;

        if (directory[page] === false) {
          callback = group();
          directory[page] = true;
          lookup = true;

          findRels2(page, function (result) {
              if (_.isBoolean(directory[page])) {
                directory[page] = {};
              }
              _.extend(directory[page], result);
              Object.keys(result).forEach(function (key) {
                Object.keys(result[key]).forEach(function (newPage) {
                  directory[newPage] = directory[newPage] || false;
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

function lookupDeepRelations2(iterations, callback, stop) {
  if (!iterations) {
    console.log('No further iterations!');
    callback();
  }
  else if (stop) {
    console.log('No more links found!');
    callback();
  }
  else {
    console.log('Looking up level', iterations);
    lookupRelations2(lookupDeepRelations2.bind({}, iterations - 1, callback));
  }
}

lookupDeepRelations2(levels, function () {
  console.log("\nDone!\n");
  console.log("JSON:\n\n" + JSON.stringify(directory) + "\n");
  console.log('Summary:' + "\n\n" + Object.keys(directory).join("\n") + "\n\n");
});
