# gongo-client

WIP: DX focused in-browser database with offline and realtime.

Copyright (c) 2020 by Gadi Cohen.  Released under the MIT License.

![npm](https://img.shields.io/npm/v/gongo-client) [![CircleCI](https://img.shields.io/circleci/build/github/gongojs/gongo-client)](https://circleci.com/gh/gongojs/gongo-client) [![coverage](https://img.shields.io/codecov/c/github/gongojs/gongo-client)](https://codecov.io/gh/gongojs/gongo-client) ![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

* Client-side database.  Offline first.
* Subscribes to datasets, realtime support.
* Optimistic updates for free.

## QuickStart

```js
import db from 'gongo-client';
import HTTPTransport from 'gongo-client/lib/transports/http';

// Should match your gongo-server setup; this is the serverless poll transport.
new HTTPTransport(db, 'http://localhost:3001/api/gongoPoll');

const test = db.collection('test');
db.subscribe('test');     // subscribe to "test" publication (see gongo-server)
test.persist();           // persist this collection through browser restart

window.db = db;           // so you can play in the browser console
window.test = test;       // ditto
```

## TODO

[ ] idb must store JSON compliant data (e.g. no Dates)
[X] pending stuff shuold be stored in idb too
[ ] persist should be subscription-level and not collection-level
