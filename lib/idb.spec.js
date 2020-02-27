require("fake-indexeddb/auto");
const GongoIDB = require('./idb').default;
const Database = require('./Database').default;

describe('GongoIDB', () => {

  describe('checkInit', () => {

    it('throws if already open', () => {
      const idb = new GongoIDB();
      idb.isOpen = true;
      expect(() => idb.checkInit()).toThrow();
    });

    it('sets a timeout for open', () => {
      const idb = new GongoIDB();
      idb.open = jest.fn();

      jest.useFakeTimers();
      idb.checkInit();
      jest.runAllTimers();

      expect(idb.open).toHaveBeenCalled();
    });

    it('clears an existing timeout and sets new one', () => {
      const idb = new GongoIDB();
      const open1 = jest.fn();
      const open2 = jest.fn();

      jest.useFakeTimers();
      idb.open = open1;
      idb.checkInit();
      idb.open = open2;
      idb.checkInit();
      jest.runAllTimers();

      expect(open1).not.toHaveBeenCalled();
      expect(open2).toHaveBeenCalled();
    });

  });

  if (0)
  it('deleteDB calls deleteDB("gongo")', async () => {
    const db = new Database();
    db.idb.open();
    await db.idb.idbPromise;

    let gongo = Array.from(await indexedDB.databases()).filter(x => x.name === 'gongo')[0];
    expect(gongo).toBeTruthy();
    await db.idb.deleteDB();
    gongo = Array.from(await indexedDB.databases()).filter(x => x.name === 'gongo')[0];
    expect(gongo).toBeFalsy();
  });

  describe('open', () => {

    it('sets idbPromise that resolves to idb database', async () => {
      const db = new Database();
      db.idb.open();  // don't await
      const promise = db.idb.idbPromise;
      expect(promise).toBeInstanceOf(Promise);
      const result = await promise;
      expect(result.objectStoreNames).toBeTruthy();
      expect(result.name).toBe('gongo');
    });

    /*
    it('creates and deletes stores on upgrade', () => {

    });

    it('rethrows an idbPromise error', () => {

    });

    it('upgrades database when collections change', () => {

    });

    it('populates collections and ')

    */



  });

  describe('convenience funcs', () => {

    it('put calls put correctly', async () => {
      const idb = new GongoIDB();
      const put = jest.fn();
      const doc = { _id: 'id' };
      idb.idbPromise = Promise.resolve({ put });
      await idb.put('collection', doc);
      expect(put).toHaveBeenCalledWith('collection', doc, doc._id);
    });

    it('delete calls delete correctly', async () => {
      const idb = new GongoIDB();
      const del = jest.fn();
      const doc = { _id: 'id' };
      idb.idbPromise = Promise.resolve({ delete: del });
      await idb.delete('collection', doc._id);
      expect(del).toHaveBeenCalledWith('collection', doc._id);
    });

  });

});
