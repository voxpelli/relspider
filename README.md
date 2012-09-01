RelSpider
=============

A web crawler that indexes relations between the different profiles of users online and ties them together into an _identity graph_ that's similar to a _social graph_ but instead of mapping relations between different identities it maps the relation between different representations of the same identity.

## Tech stuff

* Crawls link-tags and a-tags in HTML sites that have a "me"-relation. The "me"-relation is defined by the mother of all [Microformats](http://microformats.org/) – the [XFN](http://gmpg.org/xfn/and/#idconsolidation) – and is widely supported by big sites like Twitter, Google+, GitHub, Lanyrd etc.
* RelSpider uses a combination of [PostgreSQL](http://www.postgresql.org/) and [Neo4j](http://neo4j.org/) to save all relations it finds.
* Thanks to [Neo4j](http://neo4j.org/) RelSpider supports firing of WebHooks on completion of crawling the graph of a certain identity.
* Thanks to [Neo4j](http://neo4j.org/) all relations are indexes as one directional and thus profile A and B might be part of the same identity graph when a lookup is made on profile A, while they're not if you do the lookup on profile B.
* Only crawls sites scheduled for crawling through some of the methods in the API.
* RelSpider fully supports [robots.txt](http://en.wikipedia.org/wiki/Robots_exclusion_standard) to check whether it's allowed to index a page or not.
* Robots.txt files are cached for a day in either memory or [Memcached](http://memcached.org/).
* RelSpider throttles the number of requests made to each host so that a request isn't ever done more often than every 10 seconds - that way it ensures that it will stay away from being banned.
* Thanks [PostgreSQL](http://www.postgresql.org/) and [Memcached](http://memcached.org/) multiple workers of RelSpider can be spawned without them going nuts and fetching the same pages multiple times. Using PostgreSQL a worker is always reserving a page for itself for 10 minutes prior to fetching it and thanks to Memcache it doesn't have to refetch a robots.tx-file if another worker has already fetched it in the last day.
* Supports a configurable number of parallel fetches and whenever all fetches isn't being utilized it scales down accordingly to go easy on the database.
* Modular - the crawler can be used separate from the API and web, one can easily replace those with ones own creations.

### Not yet supported

* Refreshing the contents of the index

## Roadmap

Currently not sure what the next step will be here. Will perhaps join up with a few others to make this into a properly hosted service or will see it adopted, maintained and hosted by others in the community. I myself will now start studying at the university and thus in at least short term have no time to invest heavily in this all by myself.

## Run it

### Locally

RelSpider is built to work well with a Heroku-like setup and therefor uses `foreman` to start itself. First install [Foreman](https://github.com/ddollar/foreman) if you haven't got it installed before, then set the required RelSpider configuration as outlined below and lastly start RelSpider by typing:

    foreman start

### On Heroku

Running on Heroku is easy - you basically just push the code up there and you're of. You can read more about that in their [general quick start guide](https://devcenter.heroku.com/articles/quickstart) and then their [Node.js quick start guide](https://devcenter.heroku.com/articles/nodejs).

To avoid having to configure anything it is recommended to use the [PostgreSQL](https://addons.heroku.com/heroku-postgresql) and [Neo4j](https://addons.heroku.com/neo4j) add-ons. It's also recommended to use the [Memcache](https://addons.heroku.com/memcache) - at least if you ever want to run more than one process.

This script can be run on Heroku for free in small scale - even with all the recommended add-ons added.

## Configuration

To configure Foreman locally create a .env file in the top folder of RelSpider and add all required options below as well as any optional ones you would like to use.

When used with [Heroku](http://www.heroku.com/) it will work automatically if the recommended add-ons are used, but of course all configurations can be [specified there](https://devcenter.heroku.com/articles/config-vars) as well.

### Required

* `DATABASE_URL="postgres://foo@localhost/relspider"` - how to connect to your PostgreSQL database. Provided by [PostgreSQL Heroku Add-on](https://addons.heroku.com/heroku-postgresql).

### Optional

* `NEO4J_URL` - how to connect to your Neo4j database. Defaults to `http://localhost:7474`. Provided by [Neo4j Heroku Add-on](https://addons.heroku.com/neo4j).
* `RELSPIDER_API_USER="foo"` - used with `RELSPIDER_API_PASS` to lock down the API with HTTP Authentication. Default is to require no authentication.
* `RELSPIDER_API_PASS="bar"` - see `RELSPIDER_API_USER`
* `RELSPIDER_PARALLEL="30"` - the number of parallel fetches per process, never will more fetches than these be made. Defaults to `30` parallel fetches.
* `RELSPIDER_CACHE="memcached"` - if set to `memcached` then [MemJS](https://github.com/alevy/memjs) will be used for caching, see that module for additional configuration details. Defaults to memory cache unless `MEMCACHE_USERNAME`, which is provided by the [Memcache Heroku Add-on](https://addons.heroku.com/memcache) or `MEMCACHIER_USERNAME`, which is provided by the [Memcachier Heroku Add-on](https://addons.heroku.com/memcachier), is set - if any of them are set MemJS is instead auto-configured to use them.

## API methods

### /api/lookup

Used to fetch the identity graph of a URL. If a URL isn't yet crawled then it will be scheduled to be so.

#### Parameters

* `url` - *required* the URL to do the lookup on
* `callback` - a URL, a "WebHook", to which to POST the resulting identity graph when it has been fully crawled. Only used if the identity graph isn't yet fully crawled. The format of the POST:ed body is the same as the JSON that's in the response of this request.

#### Response

HTTP 202 response if identity graph isn't yet fully crawled, otherwise a HTTP 200 response with a JSON body like:

```json
{
  "url": "http://github.com/voxpelli",
  "related": [
    "http://twitter.com/voxpelli",
    "http://github.com/voxpelli",
    "http://voxpelli.com/",
    "http://kodfabrik.se/"
 ],
  "incomplete": true
}
```

The `url` key in the response shows the URL that the lookup was made on. The `related` key includes the full identity graph, including the URL used in the lookup. The `incomplete` key is sometimes included - it then shows that there has been pages found in the graph that RelSpider for some reason hasn't been able to crawl and that therefor the graph might show its true extent.

### /api/add

Used to schedule a site for crawling. Often you want /api/lookup instead.

#### Parameters

* `url` - *required* the URL to do schedule to crawl.

#### Response

HTTP 202 with a message of success!

## License

MIT [http://voxpelli.mit-license.org](http://voxpelli.mit-license.org)

## Demo

For the moment there is an open demo up and running on a free [Heroku](http://www.heroku.com/) instance with all the above recommended add-ons: http://relspider.herokuapp.com/