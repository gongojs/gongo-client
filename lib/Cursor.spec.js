const Collection = require('./Collection').default;
const Cursor = require('./Cursor').default;

describe('Cursor', () => {

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

})
