const ARSON = require('arson');
const ObjectID = require("bson-objectid");
require("fake-indexeddb/auto");

process.on('unhandledRejection', (error, p) => {
  console.log('=== UNHANDLED REJECTION ===');
  console.dir(error.stack);
});

const Database = require('./Database').default;
const stringifyObjectIDs = require('./Database').stringifyObjectIDs;
const objectifyStringIDs = require('./Database').objectifyStringIDs;
const utils = require('./utils');

describe('stringifyObjectIDs', () => {

  it('does like it says', () => {

    const origDoc = {
      _id: new ObjectID(),
      otherId: new ObjectID(),
      other: 'moo'
    };

    const doc = { ...origDoc };
    stringifyObjectIDs(doc);

    expect(doc).toEqual({
      _id: origDoc._id.toHexString(),
      otherId: origDoc.otherId.toHexString(),
      other: 'moo',
      __ObjectIDs: [ '_id', 'otherId' ],
    });

  });

  /*
  it('does like it says - old way (semi reconstructed arson)', () => {

    const doc = {
      _id: { _bsontype: 'ObjectID', id: new Buffer([ 97 ]) },
      otherId: { _bsontype: 'ObjectID', id: new Buffer([ 98 ]) },
      other: 'moo'
    };

    stringifyObjectIDs(doc);

    expect(doc).toEqual({
      _id: '61',
      otherId: '62',
      other: 'moo',
      __ObjectIDs: [ '_id', 'otherId' ],
    });

  });
  */

});

describe('Database', () => {

  describe('constructor', () => {

    it('instantiates', () => {
      const db = new Database();
      expect(db).toBeInstanceOf(Database);
    });

    it('defines getChangeSet', () => {
      const sync = require('./sync');
      const db = new Database();

      const origGetChangeSet = sync.getChangeSet;
      sync.getChangeSet = jest.fn();

      db.getChangeSet();
      expect(sync.getChangeSet).toHaveBeenCalled();

      sync.getChangeSet = origGetChangeSet;
    });

  });

  describe('events', () => {

    describe('on', () => {

      it('throws on non-existent events', () => {
        const db = new Database();
        const cb = {};

        expect(() => db.on('doesNotExist', cb)).toThrow(/non-existent/);
      });

      it('appends to existing events', () => {
        const db = new Database();
        db.callbacks.test = [];

        const cb1 = {};
        const cb2 = {};

        db.on('test', cb1);
        db.on('test', cb2);
        expect(db.callbacks['test']).toEqual([ cb1, cb2 ]);
      });

    });

    describe('off', () => {

      it('throws on non-existent event', () => {
        expect(() => (new Database()).off('non-exist')).toThrow(/non-existent/);
      });

      it('removes the given callback from callback array', () => {
        const db = new Database();
        const cb1 = jest.fn(), cb2 = jest.fn();
        db.on('updatesFinished', cb1);
        db.on('updatesFinished', cb2);
        db.off('updatesFinished', cb1);
        db.exec('updatesFinished');
        expect(cb2).toHaveBeenCalled();
        expect(cb1).not.toHaveBeenCalled();
      });

    });

    describe('exec', () => {

      it('throws non-existing events', () => {
        const db = new Database();
        expect(() => db.exec('non-exist')).toThrow('non-existent event');
      });

      it('execs callbacks with Database', () => {
        const db = new Database();
        const callback = jest.fn();
        db.callbacks.test = [];
        db.on('test', callback);
        db.exec('test');
        expect(callback).toHaveBeenCalled();
      });

    });

  });

  describe('updates', () => {

    it('_didUpdate sets a timeout to run updatesFinished', () => {
      const db = new Database();
      const callback = jest.fn();
      db.on('updatesFinished', callback);
      jest.useFakeTimers();

      db._didUpdate();
      expect(callback).not.toBeCalled();
      jest.runAllTimers();
      expect(callback).toBeCalled();
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('_didUpdate clears an existing timeout', () => {
      const db = new Database();
      const callback = jest.fn();
      db.on('updatesFinished', callback);
      jest.useFakeTimers();

      const existingCallbackToBeCleared = jest.fn();
      db._didUpdateTimeout = existingCallbackToBeCleared;
      db._updatesFinished = jest.fn();
      db._didUpdate();
      jest.runAllTimers();
      expect(existingCallbackToBeCleared).not.toBeCalled();
    });

  });

  describe('collection', () => {

    it('returns an existing collection', () => {
      const db = new Database();
      const col = db.collection('test');
      expect(db.collection('test')).toBe(col);
    });

  });

  describe('subscriptions', () => {
    const dbOpts = { gongoStoreNoPersist: true };

    it('new Database() sets up populateSubs callback', () => {
      const db = new Database(dbOpts);
      db.populateSubscriptions = jest.fn();
      db.idb.exec('collectionsPopulated');
      expect(db.populateSubscriptions).toHaveBeenCalled();
    });

    describe('subscribe', () => {

      it('creates, stores and returns a new/existing sub', () => {
        const db = new Database(dbOpts);
        const sub = db.subscribe('test');

        expect(db.subscribe('test')).toBe(sub);
      });

      it('stores sub opts', () => {
        const db = new Database(dbOpts);
        const opts = { a: 1 };
        const sub = db.subscribe('test', opts);

        expect(sub.opts).toEqual(opts);
      });

      it('marks an matching existing inactive sub as active', () => {
        const db = new Database();
        const sub = db.subscribe('test', { a: 1 });
        sub.stop();
        expect(sub.active).toBe(false);
        db.subscribe('test', { a: 1 });
        expect(sub.active).toBe(true);
      });

    });

    describe('getSubscriptions', () => {

      it('should return subs', () => {
        const db = new Database(dbOpts);
        const sub1 = db.subscribe('test1');
        const sub2 = db.subscribe('test2');
        const subs = db.getSubscriptions();
        expect(subs).toEqual([ sub1.toObject(), sub2.toObject() ]);
      });

    });

    describe('populateSubscriptions', () => {

      it('survive and do nothing if no substore', () => {
        const db = new Database();
        expect(() => db.populateSubscriptions()).not.toThrow();
      });

      it('should populate sub info from gongoStore', () => {
        const db = new Database(dbOpts);
        const now = Date.now();

        db.subscribe('test');

        db.gongoStore.insert({
          _id: "subscriptions",
          subscriptions: [
            {
              name: 'test',
              updatedAt: { test: now }
            }
          ]
        });

        db.populateSubscriptions();
        const sub = db.subscriptions.get('["test"]');
        expect(sub).toBeTruthy();
        expect(sub.updatedAt).toEqual({ test: now });
      });

      it('should create inactive subs if they don\'t exist', () => {
        const db = new Database(dbOpts);
        const now = Date.now();

        // don't create sub first.
        // db.subscribe('test');

        db.gongoStore.insert({
          _id: "subscriptions",
          subscriptions: [
            {
              name: 'test',
              updatedAt: { test: now }
            }
          ]
        });

        db.populateSubscriptions();
        const sub = db.subscriptions.get('["test"]');
        expect(sub).toBeTruthy();
        expect(sub.active).toBe(false);

      });

    });

    describe('processSubResults', () => {

      it('ignores errors from server', () => {
        const db = new Database();
        const subResults = [ { name: 'test', error: new Error() }];

        // stub for { _id: "subscriptions" } update
        db.gongoStore = {
          _insertOrReplaceOne: jest.fn()
        };

        // i.e. won't try iterate on non-existent { results: [] }
        const warn = console.warn;
        console.warn = () => {};
        expect(() => db.processSubResults(subResults)).not.toThrow();
        console.warn = warn;
      });

      const subResults1 = [
        {
          "name": "testSub",
          "results": [
            {
              "coll": "testCol",
              "entries": [
                {
                  "_id": "id1",
                  "__updatedAt": 1582820783188
                }
              ]
            }
          ]
        }
      ];

      it('updates updatedAt', () => {
        const db = new Database(dbOpts);
        const sub = db.subscribe('testSub');

        // sub.updatedAt does not exist yet
        expect(sub.updatedAt).toBeFalsy();
        db.processSubResults(subResults1);

        expect(sub.updatedAt).toBeTruthy();
        expect(sub.updatedAt.testCol).toBe(1582820783188);

        // sub.udpatedAt does exist, but update is behind time
        db.processSubResults([{
          name: "testSub",
          results: [ {
            "coll": "testCol",
            entries: [ { _id: "id2", __updatedAt: 1111111111111 }]
          }]
        }]);
        expect(sub.updatedAt.testCol).toBe(1582820783188);

        // sub.udpatedAt does exist, update later, update it
        db.processSubResults([{
          name: "testSub",
          results: [ {
            "coll": "testCol",
            entries: [ { _id: "id2", __updatedAt: 9999999999999 }]
          }]
        }]);
        expect(sub.updatedAt.testCol).toBe(9999999999999);
      });

      it('inserts', () => {
        const db = new Database(dbOpts);
        db.subscribe('testSub');
        const testCol = db.collection('testCol');
        testCol._insert = jest.fn();

        db.processSubResults(subResults1);

        expect(testCol._insert).toHaveBeenCalledWith({
          "_id": "id1",
          "__updatedAt": 1582820783188
        });
      });

      it('removes', () => {
        const db = new Database(dbOpts);
        db.subscribe('testSub');
        const testCol = db.collection('testCol');
        testCol._insert = jest.fn();
        testCol._remove = jest.fn();

        db.processSubResults([
          {
            "name": "testSub",
            "results": [
              {
                "coll": "testCol",
                "entries": [
                  {
                    "_id": "id1",
                    "__updatedAt": 1582820783188,
                    "__deleted": true,
                  }
                ]
              }
            ]
          }
        ]);

        expect(testCol._insert).not.toHaveBeenCalled();
        expect(testCol._remove).toHaveBeenCalledWith("id1");
      });

    });

  });

  describe('methods', () => {

    describe('call', () => {

      it('queues the call with resolve,reject and returns promise', () => {
        const db = new Database();
        utils._randomId = utils.randomId;
        utils.randomId = () => 'id';
        const result = db.call('someMethod', { a: 1 });
        utils._randomId = utils.randomId;

        expect(db.queuedMethods[0].name).toBe('someMethod');
        expect(db.queuedMethods[0].opts).toEqual({ a: 1 });
        expect(db.queuedMethods[0].id).toBe('id');
        expect(db.queuedMethods[0].resolve).toBeInstanceOf(Function);
        expect(db.queuedMethods[0].reject).toBeInstanceOf(Function);

        expect(result).toBeInstanceOf(Promise);
      });

      it('calls _didUpdate', () => {
        const db = new Database();
        db._didUpdate = jest.fn();
        utils._randomId = utils.randomId;
        utils.randomId = () => 'id';
        db.call('someMethod', { a: 1 });
        utils._randomId = utils.randomId;

        expect(db._didUpdate).toHaveBeenCalled();
      });

    });

    describe('getQueuedMethods', () => {

      let db;
      beforeEach(() => {
        db = new Database();
        db._didUpdate = jest.fn();
        utils._randomId = utils.randomId;
        utils.randomId = () => 'id';
      });

      afterEach(() => {
        utils._randomId = utils.randomId;
      });

      it('clears the queue', () => {
        db.call('someMethod');
        expect(db.queuedMethods.length).toBe(1);
        db.getQueuedMethods();
        expect(db.queuedMethods.length).toBe(0);
      });

      it('sets waitMethodsById and returns array of query data', () => {
        db.call('someMethod', { a: 1 });
        const methodData = db.queuedMethods[0];
        const results = db.getQueuedMethods();

        expect(db.waitingMethods.get('id')).toBe(methodData);
        expect(results).toEqual([
          { id: 'id', name: 'someMethod', opts: { a: 1 } }
        ]);
      });

    }); /* getQueuedMethods */

    describe('processMethodResults', () => {

      let db;
      beforeEach(() => {
        db = new Database();
        db._didUpdate = jest.fn();
        utils._randomId = utils.randomId;
        utils.randomId = () => 'id';
      });

      afterEach(() => {
        utils._randomId = utils.randomId;
      });

      it('resolves', () => {
        const promise = db.call('method');
        db.getQueuedMethods();
        db.processMethodsResults([{
          id: 'id', result: 'OK'
        }]);

        return expect(promise).resolves.toBe('OK');
      });

      it('rejects', () => {
        const promise = db.call('method');
        db.getQueuedMethods();
        db.processMethodsResults([{
          id: 'id', error: "d'oh"
        }]);

        return expect(promise).rejects.toBe("d'oh");
      });

    });

  }); /* methods */

  describe('other', () => {

    it('getTime()', () => {
      const db = new Database();
      expect(db.getTime() - Date.now()).toBeLessThan(5);
    });

    it('extend()', () => {
      const db = new Database();
      class AuthExtension {}
      db.extend('auth', AuthExtension, { a: 1 });

      expect(db.auth).toBeInstanceOf(AuthExtension);
    });

  });

})
