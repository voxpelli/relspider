var Step = require('step'),
  HTML5 = require('html5'),
  jsdom = require('jsdom'),
  url = require('url'),
  article = 'http://www.youtube.com/watch?v=UvXUkXvunlw',
  rel = 'author',
  foundRelations = [],
  findRels, alreadyFound, lookupProfileRelations;

if (process.argv[2]) {
  article = process.argv[2];
}
if (process.argv[3]) {
  rel = process.argv[3];
}

findRels = (function () {
  var fetchSite, parseRels, unifyList;

  fetchSite = function (target, callback, rel) {
    jsdom.env(
      target,
      ['http://ajax.googleapis.com/ajax/libs/jquery/1.6/jquery.min.js'],
      {parser: HTML5},
      parseRels.bind({
        target : target,
        callback : callback,
        rel : rel
      })
    );
  };

  parseRels = function (err, window) {
    if (err) throw err;

    var $authors = window.$('a[rel="' + this.rel + '"]'),
      relations = {},
      that = this,
      i, length, $anchor, tmp;

    console.log("...found", $authors.length, '"' + this.rel + '"-relations on "' + this.target + '":');

    for (i = 0, length = $authors.length; i < length; i++) {
      $anchor = window.$($authors[i]);
      tmp = url.resolve(this.target, $anchor.attr('href'));
      if (!relations[tmp]) {
        relations[tmp] = $anchor.text();
      }
    }

    process.nextTick(function () {
      that.callback(false, relations);
    });
  };

  unifyList = function (list) {
    var newList = {},
      i, length, key;

    for (i = 0, length = list.length; i < length; i++) {
      for (key in list[i]) {
        if (list[i].hasOwnProperty(key)) {
          if (!newList[key]) {
            newList[key] = list[i][key];
          }
        }
      }
    }

    return newList;
  };

  return function (targets, callback, rel) {
    rel = rel || 'author';

    if (!Array.isArray(targets)) {
      targets = [targets];
    }

    Step(
      function initFetchin() {
        var group = this.group(),
          i, length;
        for (i = 0, length = targets.length; i < length; i++) {
          console.log('Fetching', targets[i], '...');
          fetchSite(targets[i], group(), rel);
        }
      },
      function finishParsing(err, relations) {
        relations = unifyList(relations);
        process.nextTick(function () {
          callback(false, relations);
        });
      }
    );
  };
}());

alreadyFound = function (relation) {
  return foundRelations.indexOf(relation) === -1;
};

lookupProfileRelations = function (iterations, callback, err, relations) {
  relations = Object.keys(relations).filter(alreadyFound);

  foundRelations = foundRelations.concat(relations);

  console.log("\nFound these new relations on level " + iterations +  ":\n\n" + relations.join("\n") + "\n\n");

  if (!iterations || !relations.length) {
    callback(foundRelations);
  }
  else {
    findRels(relations, lookupProfileRelations.bind({}, iterations - 1, callback), 'me');
  }
};

findRels(article, lookupProfileRelations.bind({}, 5, function (relations) {
  console.log('Summary:' + "\n\n" + relations.join("\n") + "\n\n");
}), rel);
