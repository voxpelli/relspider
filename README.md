RelSpider
=============

A combined Neo4j and Postgres storage backend for.

Remember to add the "pages" index to Neo4j!

Example:

START page=node:pages(url = 'http://kodfabrik.se/') RETURN page

START page1=node:pages(url = 'http://kodfabrik.se/'), page2=node:pages(url = 'http://klout.com/voxpelli') RETURN page1,page2

START page1=node:pages(url = 'http://kodfabrik.se/'), page2=node:pages(url = 'http://klout.com/voxpelli')
MATCH p = shortestPath( page1-[*..15]->page2 )
RETURN p

This returns true;

START page1=node:pages(url = 'http://kodfabrik.se/'), page2=node:pages(url = 'http://pinboard.in/u:voxpelli')
MATCH p = shortestPath( page1-[*..15]->page2 )
RETURN p

this doesn't return true:

START page1=node:pages(url = 'http://pinboard.in/u:voxpelli'), page2=node:pages(url = 'http://kodfabrik.se/')
MATCH p = shortestPath( page1-[*..15]->page2 )
RETURN p

This returns true;

START page1=node:pages(url = 'http://twitter.com/voxpelli'), page2=node:pages(url = 'http://pinboard.in/u:voxpelli')
MATCH p = shortestPath( page1-[*..15]->page2 )
RETURN p

this doesn't return true:

START page1=node:pages(url = 'http://pinboard.in/u:voxpelli'), page2=node:pages(url = 'http://twitter.com/voxpelli')
MATCH p = shortestPath( page1-[*..15]->page2 )
RETURN p

Awesome:

START n=node(745), n2=node(*)
MATCH (n)<-[:me*..]-(n2)
WHERE n2.hasCallback! = true
RETURN distinct n2
