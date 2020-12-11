require("fake-indexeddb/auto");
const FDBFactory = require("fake-indexeddb/lib/FDBFactory");
const npmIdb = require('idb');
const GongoIDB = require('./idb').default;
const Database = require('./Database').default;

describe('GongoIDB', () => {

  describe('events', () => {

    it('off', () => {
      const idb = new GongoIDB();
      const callback = jest.fn();
      idb.on('something', callback);
      idb.off('something', callback);
      idb.exec('something');
      expect(callback).not.toHaveBeenCalled();
    });

    describe('exec', () => {

      it('catches errors', () => {
        const idb = new GongoIDB();
        const callback = () => { throw new Error('error') };
        idb.on('something', callback);
        idb.exec('something');
        expect(() => idb.exec('something')).not.toThrow();
      });

    });

  });

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

    it('creates stores for new collections on first version', async () => {
      indexedDB = new FDBFactory();
      const db = new Database();
      db.collection('collection');
      await db.idb.open();
      expect((await db.idb.idbPromise).objectStoreNames).toContain('collection');
    });

    it('creates stores for new collections on upgrades', async () => {
      let db;
      indexedDB = new FDBFactory();

      // original database without 'collection'
      db = new Database();
      await db.idb.open();
      (await db.idb.idbPromise).close();

      // database with 'collection' to be added
      db = new Database();
      db.collection('collection');
      await db.idb.open();

      expect((await db.idb.idbPromise).objectStoreNames).toContain('collection');
    });


    it('deletes stores for removed collections on upgrades', async () => {
      let db;
      indexedDB = new FDBFactory();

      db = new Database();
      db.collection('collection');
      await db.idb.open();
      await (await db.idb.idbPromise).close();

      db = new Database(); // new database without 'collection' collection
      await db.idb.open();
      expect((await db.idb.idbPromise).objectStoreNames).not.toContain('collection');
    });

    /*
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
