"use strict";

module.exports = function (grunt) {
  var jsFiles = [
      'Gruntfile.js',
      'lib/**/*.js',
      'migrations/**/*.js',
      'test/**/*.js',
    ];

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    jshint: {
      options: { jshintrc: '.jshintrc' },
      all: { src: jsFiles }
    },
    lintspaces: {
      options: { editorconfig: '.editorconfig' },
      all: { src: jsFiles }
    },
    watch: {
      jshint : {
        files: jsFiles,
        tasks: [
          'silenceWarnings',
          'newer:lintspaces:all',
          'newer:jshint:all',
          'setTestEnv',
          // 'mocha_istanbul:unit',
        ]
      }
    },
    mocha_istanbul: {
      options: {
        root: './lib',
        mask: '**/*.spec.js'
      },
      // unit: {
      //   src: 'test/unit'
      // },
      basic: {
        src: 'test'
      },
      coveralls: {
        src: 'test',
        options: {
          coverage: true,
          reportFormats: ['lcovonly']
        }
      }
    }
  });

  grunt.registerTask('silenceWarnings', 'Ensure that grunt-newer can update checked files even when there are warnings', function () {
    grunt.option('force', true);
  });
  grunt.registerTask('setTestEnv', 'Ensure that environment (database etc) is set up for testing', function () {
    process.env.NODE_ENV = 'test';
  });


  grunt.loadNpmTasks('grunt-notify');
  grunt.loadNpmTasks('grunt-lintspaces');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-newer');
  grunt.loadNpmTasks('grunt-mocha-istanbul');

  grunt.registerTask('travis', ['lintspaces', 'jshint', 'setTestEnv', 'mocha_istanbul:coveralls']);
  grunt.registerTask('test',   ['lintspaces', 'jshint', 'setTestEnv', 'mocha_istanbul:basic']);
  grunt.registerTask('default', 'test');


  grunt.event.on('coverage', function(lcov, done){
    require('coveralls').handleInput(lcov, function(err){
      if (err) {
        return done(err);
      }
      done();
    });
  });
};
