'use strict';

exports.up = function(knex, Promise) {
  return Promise.all([
    knex.schema.table('urls', function (table) {
      table.string('ip').notNullable();
    }),
    knex.schema.table('hosts', function (table) {
      table.string('ip').notNullable().unique();
    }),
  ]);
};

exports.down = function(knex, Promise) {
  return Promise.all([
    knex.schema.table('urls', function (table) {
      table.dropColumn('ip');
    }),
    knex.schema.table('hosts', function (table) {
      table.dropColumn('ip');
    }),
  ]);
};
