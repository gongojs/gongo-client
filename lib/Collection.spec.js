const Collection = require('./Collection').default;
const Cursor = require('./Cursor').default;
const ChangeStream = require('./ChangeStream').default;
const randomId = require('./Collection').randomId;

describe('Other in Collection.js', () => {

  describe('randomId', () => {

    beforeAll(() => {
      if (!window.crypto)
        window.crypto = {
          getRandomValues(arr) {
            for (let i=0; i < arr.length; i++)
              arr[i] = Math.floor(Math.random() * 100000);
          },
          isFake: true
        }
    });

    afterAll(() => {
      if (window.crypto.isFake)
        delete window.crypto;
    });

    it('returns the right length', () => {
      expect(randomId(5).length).toBe(5);
    });

    it('returns seemingly random results', () => {
      expect(randomId(5)).not.toBe(randomId(5));
    });

  });

});

describe('Collection', () => {
  const FakeDb = { name: 'FakeDb' };

  it('can be created', () => {
    const col = new Collection(FakeDb, 'test');

    expect(col.db).toBe(FakeDb);
    expect(col).toBeInstanceOf(Collection);
  });

  describe('_didUpdate / _updateFinsihed', () => {

    it('_didUpdate sets a timeout to run updatesFinished', () => {
      const col = new Collection(FakeDb);
      jest.useFakeTimers();

      col._updatesFinished = jest.fn();
      col._didUpdate();
      expect(col._updatesFinished).not.toBeCalled();
      jest.runAllTimers();
      expect(col._updatesFinished).toBeCalled();
      expect(col._updatesFinished).toHaveBeenCalledTimes(1);
    });

    it('didUpdate clears an existing timeout', () => {
      const col = new Collection(FakeDb);
      jest.useFakeTimers();

      const existingCallbackToBeCleared = jest.fn();
      col._didUpdateTimeout = existingCallbackToBeCleared;
      col._updatesFinished = jest.fn();
      col._didUpdate();
      jest.runAllTimers();
      expect(existingCallbackToBeCleared).not.toBeCalled();
    });

    it('_updatesFinished calls db didUpdate', () => {
      const db = { _didUpdate: jest.fn() };
      const col = new Collection(db, 'test');
      col._updatesFinished();
      expect(db._didUpdate).toHaveBeenCalled();
    });

  });

  describe('persistance', () => {

    it('persist()', () => {
      const db = { idb: { checkInit: jest.fn() }};
      const col = new Collection(db, 'test');

      col.persist();
      expect(col.db.persistedQueriesExist).toBe(true);
      expect(col.persists.length).toBe(1);
      const p1 = col.persists[0];
      expect(p1({ type: 'apple' })).toBe(true);
      expect(col.db.idb.checkInit).toHaveBeenCalled();
    });

    it('persist(query)', () => {
      const db = { idb: { checkInit: jest.fn() }};
      const col = new Collection(db, 'test');
      const query = { type: 'apple' };

      col.persist(query);
      expect(col.db.persistedQueriesExist).toBe(true);
      expect(col.persists.length).toBe(1);
      const p1 = col.persists[0];
      expect(p1({ type: 'apple' })).toBe(true);
      expect(p1({ type: 'banana' })).toBe(false);
      expect(col.db.idb.checkInit).toHaveBeenCalled();
    });

    it('shouldPersist(doc) matches', () => {
      const db = { idb: { checkInit() {} }};
      const col = new Collection(db, 'test');
      col.persist({ type: 'apple' });
      expect(col.shouldPersist({ type: 'apple' })).toBe(true);
      expect(col.shouldPersist({ type: 'banana' })).toBe(false);
    });

  });

  describe('changestreams', () => {

    describe('watch', () => {

      it('returns a ChangeStream, adds to cs array', () => {
        const col = new Collection(FakeDb, 'test');
        const cs = col.watch();
        expect(cs).toBeInstanceOf(ChangeStream);
        expect(col.changeStreams).toContain(cs);
      });

    });

    describe('sendChanges', () => {

      it('runs callbacks', () => {
        const col = new Collection(FakeDb, 'test');
        const cs = col.watch();
        const callback = jest.fn();
        cs.on('change', callback);

        col.sendChanges('insert', 'a', { _id: 'a', a: 1 });
        expect(callback).toHaveBeenCalledWith({
          operationType: 'insert',
          _id: 'a',
          a: 1,
          ns: { db: 'FakeDb', coll: 'test' },
          documentKey: { _id: 'a' }
        });
      });

    });

  });

  describe('CRUD', () => {

    // check modify on pendingInsert

    describe('_insert', () => {

      it('inserts a single record', () => {
        const col = new Collection(FakeDb, 'test');
        const doc = { _id: 'a' };
        col._insert(doc);

        const result = col.findOne({});
        expect(result).toBe(doc);
      });

    });

    describe('find', () => {

      it('returns a Cursor', () => {
        const col = new Collection(FakeDb, 'test');
        const cursor = col.find({});
        expect(cursor).toBeInstanceOf(Cursor);
      });

    });

    describe('findOne', () => {

      it('returns first match on find(query)', () => {
        const col = new Collection(FakeDb, 'test');
        const apple = { _id: 'apple' };
        const banana = { _id: 'banana' };
        col._insert(apple);
        col._insert(banana);
        expect(col.findOne({ _id: 'banana' })).toEqual(banana);
      });

      it('returns null on no match for find(query)', () => {
        const col = new Collection(FakeDb, 'test');
        const apple = { _id: 'apple' };
        col._insert(apple);
        expect(col.findOne({ _id: 'banana' })).toBe(null);
      });

      it('returns an exact record on find(strId)', () => {
        const col = new Collection(FakeDb, 'test');
        const apple = { _id: 'apple' };
        const banana = { _id: 'banana' };
        col._insert(apple);
        col._insert(banana);
        expect(col.findOne('apple')).toEqual(apple);
      });

      it('returns null on no record for find(strId)', () => {
        const col = new Collection(FakeDb, 'test');
        const apple = { _id: 'apple' };
        col._insert(apple);
        expect(col.findOne('banana')).toBe(null);
      });

    });

  });

})
