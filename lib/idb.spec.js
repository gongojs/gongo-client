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

    it('opens', async () => {
      const db = new Database();
      await db.idb.open();

    });

  });

  if (0)
  describe('put', () => {

    it('puts', async () => {
      const db = new Database();
      const idb = new GongoIDB();
      await idb.open();
    });

  });

});
