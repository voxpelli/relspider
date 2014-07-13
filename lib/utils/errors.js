"use strict";

var VError = require('verror')
  , NotFoundError;

NotFoundError = function () {
  VError.apply(this, arguments);
};
NotFoundError.protoype = VError;
NotFoundError.prototype.name = 'NotFoundError';

module.exports = {
  NotFoundError : NotFoundError
};
