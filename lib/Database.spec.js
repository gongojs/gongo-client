require("fake-indexeddb/auto");

process.on('unhandledRejection', (error, p) => {
  console.log('=== UNHANDLED REJECTION ===');
  console.dir(error.stack);
});

const Database = require('./Database').default;

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

      it('creates new events', () => {
        const db = new Database();
        const cb = {};

        expect(() => db.on('new', cb)).not.toThrow();
        expect(db.callbacks['new']).toEqual([ cb ]);
      });

      it('appends to existing events', () => {
        const db = new Database();
        const cb1 = {};
        const cb2 = {};

        db.on('something', cb1);
        db.on('something', cb2);
        expect(db.callbacks['something']).toEqual([ cb1, cb2 ]);
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
        db.on('something', callback);
        db.exec('something');
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

    });

    describe('subHash', () => {

      it('hashes name and opts', () => {
        const db = new Database();
        expect(db.subHash('test')).toBe('["test"]');
        expect(db.subHash('test', {a:1})).toBe('["test",{"a":1}]');
      });

    });

    describe('getSubscriptions', () => {

      it('should return subs', () => {
        const db = new Database(dbOpts);
        const sub1 = db.subscribe('test1');
        const sub2 = db.subscribe('test2');
        const subs = db.getSubscriptions();
        expect(subs).toEqual([ sub1, sub2 ]);
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
          subscriptions: {
            '["test"]': {
              name: 'test',
              updatedAt: { test: now }
            }
          }
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
          subscriptions: {
            '["test"]': {
              name: 'test',
              updatedAt: { test: now }
            }
          }
        });

        db.populateSubscriptions();
        const sub = db.subscriptions.get('["test"]');
        expect(sub).toBeTruthy();
        expect(sub.active).toBe(false);

      });

    });

    describe('processSubResults', () => {

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

  describe('other', () => {

    it('getTime()', () => {
      const db = new Database();
      expect(db.getTime() - Date.now()).toBeLessThan(5);
    });

  });

})
