"use strict";

var neo4j = require('neo4j')
, options = require('../config');

module.exports = new neo4j.GraphDatabase(options.neo4j);
