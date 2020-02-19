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

    })

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
      expect(cursor.toArraySync().length).toBe(1);
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

  it('limit sets _limitBy', () => {
    const cursor = col.find().limit(1);
    expect(cursor._limitBy).toBe(1);
  });

})
