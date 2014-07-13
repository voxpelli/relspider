/*jslint node: true, white: true, indent: 2 */

"use strict";

var knex = require('./utils/bookshelf').knex,
  Promise = require('promise'),
  options = require('./config'),
  install;

install = function() {
  console.log('Creating tables...');

  return Promise.all([

    // *** Schema definition ***

    knex.schema.createTable('urls', function (table) {
      table.string('url', 1024).primary();
      table.integer('node');
      table.string('host').notNullable();
      table.string('ip').notNullable();
      table.timestamp('added', true).notNullable();
      table.timestamp('requested', true);
      table.timestamp('fetched', true);
      table.timestamp('locked', true);
      table.boolean('refresh')
        .notNullable()
        .defaultTo(knex.raw('false'));
      table.boolean('completed')
        .notNullable()
        .defaultTo(knex.raw('false'));
      table.boolean('disallowed')
        .notNullable()
        .defaultTo(knex.raw('false'));
      table.integer('failed')
        .notNullable()
        .defaultTo(0);
    }),

    knex.schema.createTable('hosts', function (table) {
      table.string('host').primary();
      table.string('ip').notNullable().unique();
      table.timestamp('added', true).notNullable();
      table.timestamp('fetched', true).notNullable();
      table.integer('count').notNullable();
    }),

    knex.schema.createTable('webhooks', function (table) {
      table.string('hook', 1024);
      table.string('url', 1024);
      table.primary(['hook', 'url']);

      table.timestamp('added', true).notNullable();
      table.timestamp('fired', true);
    }),

    // *** End of schema definition ***

  ]).then(function () {
    // Ensure that migrations not needed due to new install becomes flagged as already installed

    console.log('...initializes migrations table...');

    var setInitialMigrationState;

    // This initializes the migrator – taken from Knex main file
    if (!knex.client.Migrator) {
      knex.client.initMigrator();
    }
    var migrator = new knex.client.Migrator(knex);

    // Own code to tell that the new schema already is up to date
    setInitialMigrationState = function (config) {
      this.config = this.setConfig(config);
      return this._migrationData()
        .bind(this)
        .then(function(result) {
          var migrations = [],
            migration_time = new Date();

          result[0].forEach(function (migration) {
            migrations.push({
              name: migration,
              batch: 0,
              migration_time: migration_time
            });
          });

          return knex(this.config.tableName).insert(migrations);
        });
    };

    return setInitialMigrationState.call(migrator);
  }).then(function () {
    if (options.env !== 'production') {
      // Set up dummy data
    }
  }).then(function () {
    console.log('...success!');
  });
};

if (require.main !== module) {
  module.exports = install;
} else {
  install().then(function () {
    knex.destroy();
  }, function (err) {
    knex.destroy();

    console.error('...failed with error:', err);
  });
}
