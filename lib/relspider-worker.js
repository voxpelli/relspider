"use strict";

console.log('Welcome!');

var relspider = require('../'),
  spider = relspider();

process.on('SIGTERM', function () {
  console.log('Shutting down the worker gracefully...');
  spider.close();
});

process.on('SIGINT', function () {
  // Ignoring
});
