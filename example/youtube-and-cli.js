var url = require('url'),
  spider = require('../'),
  articles = ['http://www.youtube.com/watch?v=UvXUkXvunlw'],
  levels = 5,
  dictionary = {};

if (process.argv[2]) {
  levels = parseInt(process.argv[2], 10);
}
if (process.argv.length > 3) {
  articles = process.argv.slice(3).map(function (article) {
    return url.format(url.parse(article));
  });
}

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
    spider(lookupDeepRelations2.bind({}, iterations - 1, callback), {
      dictionary : dictionary
    });
  }
}

articles.forEach(function (article) {
  dictionary[article] = {};
});

lookupDeepRelations2(levels, function () {
  console.log("\nDone!\n");
  console.log("JSON:\n\n" + JSON.stringify(dictionary) + "\n");
  console.log('Summary:' + "\n\n" + Object.keys(dictionary).join("\n") + "\n\n");
});
