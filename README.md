RelSpider
=============

A quick proof of concept NodeJS library for spidering web linking relations like the XFN and  HTML5 author relations.

Install
--------

Standalone installation:

    git clone http://github.com/flattr/osd-node-relspider.git
    cd osd-node-relspider
    npm install

As a library for use within another project:

    git clone http://github.com/flattr/osd-node-relspider.git
    cd osd-node-relspider
    npm link
    cd /path/to/your/project
    npm link relspider

Example
--------

Example script for fetching and counting all "author" and "me" relations from http://example.com. Every call to relspider() fetches each non-fetched entry in result. So modifying the example to call it once again would fetch all relations found on http://example.com and check those pages for relations as well.

    var relspider = require('relspider'),
      result = {'http://example.com' : {}};
    
    relspider(function () {
      console.log('Found', result.length - 1, 'new relations');
    }, {
      dictionary : result
    });

A full example can be found at example/youtube-and-cli.js. It by defaults fetches 5 levels deep of relations starting from my (Pelle's) only YouTube video. It also takes command line arguments - the first one being a value for how many levels deep to look for relations and the rest one being URL:s which replaces the YouTube video as the starting point of the search.

Known Issues
--------

The current version of JSDom doesn't work very well with Google Profiles like http://www.google.com/profiles/VoxPelli due to a bug in it's Request dependency as well as a bug in JSDom 0.20 regarding the handling of the html base-element. The latter bug has been fixed in the JSDom repo, but is not yet published on NPM. A pull request for the former issue has been made to the maintainer: https://github.com/mikeal/request/pull/35
