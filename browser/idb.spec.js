require("fake-indexeddb/auto");
const FDBFactory = require("fake-indexeddb/lib/FDBFactory");
const { openDB, deleteDB } = require('idb');
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
        
        const error = console.error;
        console.error = () => {};
        idb.exec('something');
        expect(() => idb.exec('something')).not.toThrow();
        console.error = error;
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
      indexedDB = new FDBFactory();
      indexedDB.open = () => new Promise((resolve,reject) => reject('error'));
      // seems like idb.openDB doesn't rethrow errors

      const db = new Database();
      return expect(() => db.idb.open()).rejects.toMatch('error');
    });
    */

    describe('population', () => {

      it('populates collections and execs collectionsPopulated', async () => {
        indexedDB = new FDBFactory();
        const idb = await openDB('gongo', 1, {
          upgrade(db) { db.createObjectStore('collection') }
        });
        const origData = [ { _id: 'a' }, { _id: 'b' } ];

        for (let row of origData)
          await idb.put('collection', row, row._id);

        (await idb).close();

        const db = new Database();
        const col = db.collection('collection');
        col.persist();

        await new Promise(resolve => {
          db.idb.on('collectionsPopulated', resolve);
          clearTimeout(db.idb.openTimeout);
          db.idb.open();
        });

        const data = col.find().toArraySync();
        expect(data).toEqual(origData);
      });

      /*
      it('calls populateStart before population', () => {

      });
      it('calls populateEnd after population', () => {

      });
       */

    });

  });

  describe('syncing', () => {

    describe('put', () => {

      /*
      it('debounces, calls', async () => {
        indexedDB = new FDBFactory();
        jest.useFakeTimers();

        const db = new Database();
        const coll = db.collection('collection');
        coll.persist();

        jest.runOnlyPendingTimers();
        await db.idb.idbPromise;

        const putAllSpy = jest.spyOn(db.idb, "putAll");

        const doc = { _id: 'id' };
        await coll._insert(doc);
        expect(putAllSpy).not.toHaveBeenCalled();
        expect(db.idb._putAllPromise).not.toBeDefined();
        expect(doc.__idbWaiting).toBeDefined();

        jest.runOnlyPendingTimers();
        expect(db.idb._putAllPromise).toBeDefined();
        expect(putAllSpy).toHaveBeenCalled();

        await db.idb._putAllPromise;
        expect(doc.__idbWaiting).not.toBeDefined();
      })
      */

      it('debounces, calls (alt non-timer test)', async () => {
        indexedDB = new FDBFactory();

        const db = new Database();
        const coll = db.collection('collection');
        coll.persist();

        await db.idb.open();

        const putAllSpy = jest.spyOn(db.idb, "putAll");

        const doc = { _id: 'id' };
        await coll._insert(doc);
        expect(putAllSpy).not.toHaveBeenCalled();
        expect(db.idb._putAllPromise).not.toBeDefined();
        expect(doc.__idbWaiting).toBeDefined();

        await db.idb.putAll();
        expect(putAllSpy).toHaveBeenCalled();
        expect(doc.__idbWaiting).not.toBeDefined();
      })

    });

  });

  describe('convenience funcs', () => {

    /*
    it('put calls put correctly', async () => {
      const idb = new GongoIDB();
      const put = jest.fn();
      const doc = { _id: 'id' };
      idb.idbPromise = Promise.resolve({ put });
      await idb.put('collection', doc);
      expect(put).toHaveBeenCalledWith('collection', doc, doc._id);
    });
    */

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
