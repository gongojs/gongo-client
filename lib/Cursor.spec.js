const Collection = require('./Collection').default;
const Cursor = require('./Cursor').default;

describe('Cursor', () => {
  const FakeDb = { name: 'FakeDb', getTime() { return Date.now(); } };
  const col = new Collection(FakeDb, 'test');
  col._insert({ _id: '1', type: 'apple' });
  col._insert({ _id: '2', type: 'banana' });

  describe('constructor', () => {

    it('instantiates', () => {
      const collection = {};
      const query = { a: 1 };
      const options = { blah: 1 };
      const cursor = new Cursor(collection, query, options);

      expect(cursor.collection).toBe(collection);
      expect(cursor.query).toBeInstanceOf(Function);
    });

    it('modifies query on options.includePendingDeletes', () => {
      let cursor;

      cursor = new Cursor({}, { type: 'banana' });
      expect(cursor._query).toEqual({
        type: 'banana',
        __pendingDelete: { $exists: false }
      });

      cursor = new Cursor({}, { type: 'banana' }, { includePendingDeletes: true });
      expect(cursor._query).toEqual({
        type: 'banana'
      });
    });

  });

  describe('slug', () => {

    it('returns name#queryJSON', () => {

      const coll = { name: 'test' };
      const query = { a: 1 };
      const cursor = new Cursor(coll, query);
      expect(cursor.slug()).toBe(`${coll.name}#${JSON.stringify(query)}`);

    });

  });

  describe('_resultsSync()', () => {

    it('should return cache', () => {
      const cache = {};
      const cursor = new Cursor();
      cursor._queryResults = cache;
      expect(cursor._resultsSync()).toBe(cache);
    });

    it('can limit if no sort and no needsCount', () => {
      const coll = { documents: [ [1, 1], [2, 2], [3, 3] ] };
      const cursor = new Cursor(coll).limit(2);
      const results = cursor._resultsSync();
      expect(results.length).toBe(2);
    });

  });

  describe('count', () => {

    const coll = { documents: [ [1, 1], [2, 2], [3, 3] ] };

    it('returns count of matching documents', () => {
      const cursor = new Cursor(coll);
      expect(cursor.count()).toBe(3);
    });

    it('marks as need-count and clears cache', () => {
      const cursor = new Cursor(coll);
      cursor._queryResults = []; // set cache to 0 results
      expect(cursor.count()).toBe(3);
    });

    it('re-uses cache if valid', () => {
      const cursor = new Cursor(coll);
      cursor.count(); // set cache and needsCount
      cursor._queryResults = []; // new cache to check against
      expect(cursor.count()).toBe(0);
    });

  });

  describe('toArray, toArraySync', () => {

    it('toArray returns a promise to toArraySync result', async () => {
      const toArraySyncResult = col.find().toArraySync();
      const toArrayResult = await col.find().toArray();
      expect(toArrayResult).toEqual(toArraySyncResult);
    });

    it('returns an array of matching results', () => {
      const result = col.find({ type: 'apple' }).toArraySync();
      expect(result).toEqual([{_id: '1', type: 'apple'}]);
    });

    it('applies _sortFunc', () => {
      const cursor = col.find();
      cursor._sortFunc = (a,b) => b.type.localeCompare(a.type);
      expect(cursor.toArraySync()).toEqual([
        { _id: '2', type: 'banana' },
        { _id: '1', type: 'apple' },
      ]);
    });

    it('applies _limit', () => {
      const cursor = col.find().limit(1);
      expect(cursor.toArraySync()).toEqual([
        { _id: '1', type: 'apple' },
      ]);
    });

    it('applies _limit', () => {
      const cursor = col.find().skip(1);
      expect(cursor.toArraySync()).toEqual([
        { _id: '2', type: 'banana' },
      ]);
    });


    it('returns cache if skip & limit are the same', () => {
      const cursor = col.find().limit(1).skip(1);

      const results = cursor.toArraySync();
      expect(cursor.toArraySync()).toBe(results);
    });



  });

  describe('sort', () => {

    it('works for strKey asc', () => {
      const cursor = new Cursor();

      cursor.sort('a', 'asc');
      expect(cursor._sortFunc({ a: 1 }, { a: 2 })).toBe(-1);
      expect(cursor._sortFunc({ a: 1 }, { a: 1 })).toBe(0);
      expect(cursor._sortFunc({ a: 2 }, { a: 1 })).toBe(1);

      expect(cursor._sortFunc({ a: "a" }, { a: "b" })).toBe(-1);
      expect(cursor._sortFunc({ a: "b" }, { a: "b" })).toBe(0);
      expect(cursor._sortFunc({ a: "b" }, { a: "a" })).toBe(1);

      cursor.sort('a', 'ascending');
      expect(cursor._sortFunc({ a: 1 }, { a: 2 })).toBe(-1);
      cursor.sort('a', 1);
      expect(cursor._sortFunc({ a: 1 }, { a: 2 })).toBe(-1);
    });

    it('works for strKey desc', () => {
      const cursor = new Cursor();

      cursor.sort('a', 'desc');
      expect(cursor._sortFunc({ a: 1 }, { a: 2 })).toBe(1);
      expect(cursor._sortFunc({ a: 1 }, { a: 1 })).toBe(0);
      expect(cursor._sortFunc({ a: 2 }, { a: 1 })).toBe(-1);

      expect(cursor._sortFunc({ a: "a" }, { a: "b" })).toBe(1);
      expect(cursor._sortFunc({ a: "b" }, { a: "b" })).toBe(0);
      expect(cursor._sortFunc({ a: "b" }, { a: "a" })).toBe(-1);

      cursor.sort('a', 'descending');
      expect(cursor._sortFunc({ a: 1 }, { a: 2 })).toBe(1);
      cursor.sort('a', -1);
      expect(cursor._sortFunc({ a: 1 }, { a: 2 })).toBe(1);
    });

    it('throws on invalid direction given', () => {
      const cursor = new Cursor();

      expect(() => cursor.sort('a', 'weird')).toThrow();
      expect(() => cursor.sort('a', {})).toThrow();
      expect(() => cursor.sort('a', [])).toThrow();
    });

    it('throws on non-strKey (for now)', () => {
      const cursor = new Cursor();

      expect(() => cursor.sort({})).toThrow();
      expect(() => cursor.sort()).toThrow();
    });

  });

  // real checking is in resultsSync(), toArraySync(), etc.
  describe('limit and skip', () => {

    it('limit sets _limit', () => {
      const cursor = col.find().limit(1);
      expect(cursor._limit).toBe(1);
    });

    it('skip sets _skip', () => {
      const cursor = col.find().skip(1);
      expect(cursor._skip).toBe(1);
    });

  });

  describe('watching', () => {

    describe('watch()', () => {

      // TODO, first half of watch() code is all covered by other tests,
      // but we could maybe do some specific tests for update func, etc.

      it('allows a non-debounced update func', () => {
        const col = new Collection(FakeDb, 'test');
        col._insert({ _id: '1', type: 'apple' });
        col._insert({ _id: '2', type: 'banana' });

        const cursor = col.find();
        const onUpdate = jest.fn();
        cursor.watch(onUpdate, { debounce: false });

        // since no-debounce, this becomes synchronous - easy to check
        col.update('1', { $set: { type: 'pear'} });
        expect(onUpdate).toHaveBeenCalled();
      });

      describe('runs update on relevant docs', () => {

        it('doc matches query', () => {
          const col = new Collection(FakeDb, 'test');
          col._insert({ _id: '1', type: 'apple' });
          col._insert({ _id: '2', type: 'banana' });

          const cursor = col.find({ type: 'apple' });
          const onUpdate = jest.fn();
          cursor.watch(onUpdate, { debounce: false });

          // we're listening for apples, should not update
          col.insert({ _id: '3', type: 'pear'});
          expect(onUpdate).not.toHaveBeenCalled();

          // we're listening for apples, should update
          col.insert({ _id: '4', type: 'apple'});
          expect(onUpdate).toHaveBeenCalled();
        });

        it('doc has matching id', () => {
          const col = new Collection(FakeDb, 'test');
          col._insert({ _id: '1', type: 'apple' });

          const cursor = col.find({ type: 'apple' });
          const onUpdate = jest.fn();
          cursor.watch(onUpdate, { debounce: false });

          // here we're changing to a fruit that doesn't match our query
          // but because we're updating an id from our previous resuts,
          // we want to know about it.
          col.update('1', { $set: { type: 'pear'} });
          expect(onUpdate).toHaveBeenCalled();
        });

      });

    });

    describe('findAndWatch', () => {
      const callback = jest.fn();
      const cursor = col.find();
      cursor.findAndWatch(callback);
      expect(callback).toHaveBeenCalledWith([
        { _id: '1', type: 'apple' },
        { _id: '2', type: 'banana' },
      ]);
    });

    describe('unwatch', () => {

      it('closes all cursor\'s changeStreams', () => {
        const cursor = new Cursor({ name: 'test'});
        const cs1 = { close: jest.fn() };
        const cs2 = { close: jest.fn() };
        cursor.changeStreams.push(cs1);
        cursor.changeStreams.push(cs2);
        cursor.unwatch();
        expect(cs1.close).toHaveBeenCalled();
        expect(cs2.close).toHaveBeenCalled();
      });

    });

  });


})
