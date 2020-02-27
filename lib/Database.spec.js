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

    describe('subscribe', () => {

      it('creates, stores and returns a new/existing sub', () => {
        const db = new Database();
        const sub = db.subscribe('test');

        expect(db.subscribe('test')).toBe(sub);
      });

      it('stores sub opts', () => {
        const db = new Database();
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
        const db = new Database();
        const sub1 = db.subscribe('test1');
        const sub2 = db.subscribe('test2');
        const subs = db.getSubscriptions();
        expect(subs).toEqual([ sub1, sub2 ]);
      });

    });

    describe('populateSubscriptions', () => {

      it('should populate sub info from gongoStore', () => {
        const db = new Database();
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
        const db = new Database();
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
        const db = new Database();
        const sub = db.subscribe('testSub');
        db.processSubResults(subResults1);

        expect(sub.updatedAt).toBeTruthy();
        expect(sub.updatedAt.testCol).toBe(1582820783188);
      });

      it('inserts', () => {
        const db = new Database();
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
        const db = new Database();
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
