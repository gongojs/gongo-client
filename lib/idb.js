const { openDB, deleteDB } = require('idb');
const { debug: gongoDebug } = require('./utils');
const debug = gongoDebug.extend('idb');

class GongoIDB {

  constructor(db) {
    this.db = db;
    this.callbacks = {};
    // this.name = 'gongo';  TODO
  }

  on(event, callback) {
    if (!this.callbacks[event])
      this.callbacks[event] = [];

    this.callbacks[event].push(callback);
  }

  off(event, callback) {
    this.callbacks[event] = this.callbacks[event].filter(cb => cb !== callback);
  }

  exec(event) {
    if (this.callbacks[event])
      this.callbacks[event].forEach(callback => callback.call(this));
  }

  async deleteDB() {
    return await deleteDB('gongo', {
      blocked() { console.log('blocked'); }
    });
  }

  async put(collectionName, document) {
    const db = await this.idbPromise;
    return db.put(collectionName, document, document._id);
    /*
    this.db.idb.idbPromise.then(db => {
      const tx = db.transaction(this.name, 'readwrite');
      tx.objectStore(this.name)
        .put(this.idb.prepareDoc(document), this.toStrId(document._id));
      return tx.complete;
    });
    */
  }

  async delete(collectionName, id) {
    const db = await this.idbPromise;
    return db.delete(collectionName, id);
  }

  checkInit() {
    if (this.isOpen)
      throw new Error("idb already open; TODO explain better when to call persist()");
    else if (this.openTimeout) {
      clearTimeout(this.openTimeout);
      this.openTimeout = setTimeout( () => this.open(), 0 );
    } else
      this.openTimeout = setTimeout( () => this.open(), 0 );
  }

  async open() {
    const db = this.db;
    debug('Opening IDB "gongo" database');
    this.isOpen = true;

    // idbDbVersion is (purposefully) undefined for initial open
    this.idbPromise = openDB('gongo', this.idbDbVersion, {
      upgrade: (idb, oldVersion, newVersion, transaction) => {
        debug('Upgrading IDB "gongo" database v' + this.idbDbVersion);
        //console.log(idb, oldVersion, newVersion, transaction);

        for (let name of idb.objectStoreNames)
          if (!db.collections.has(name))
            idb.deleteObjectStore(name);

        for (let [name] of db.collections)
          if (!idb.objectStoreNames.contains(name))
            idb.createObjectStore(name);
      }
    });

    this.idbPromise.catch(e => {
      console.log(e.message);
      throw e;
    })

    const idb = await this.idbPromise;

    let upgradeNeeded = false;
    for (let name of idb.objectStoreNames)
      if (!db.collections.has(name)) {
        upgradeNeeded = true;
        break;
      }

    if (!upgradeNeeded)
      for (let [name] of db.collections)
        if (!idb.objectStoreNames.contains(name)) {
          upgradeNeeded = true;
          break;
        }

    if (upgradeNeeded) {
      this.idbDbVersion = idb.version + 1;
      idb.close();
      this.open();
      return;
    }

    db.populated = false;
    for (let col of db.collections.values()) {
      col.populated = false;
      debug('Begin populating from IndexedDB of ' + col.name);
      col.csExec('populateStart');

      const docs = await idb.getAll(col.name);
      docs.forEach(doc => {
        col.documents.set(doc._id, doc);
      });

      col.populated = true;
      debug('Finished populating from IndexedDB of ' + col.name);
      col.csExec('populateEnd');
    }

    this.exec('collectionsPopulated');
    db.populated = true;

    /*

    let i = 0;
    this.collections.forEach( async (col, name) => {
      log.debug('Begin populating from IndexedDB of ' + name);
      const docs = await db.transaction(name).objectStore(name).getAll();
      docs.forEach(document => {
        fixObjIds(document);
        const strId = typeof document._id === 'string' ? document._id : document._id.toString();
        col.documents.set(strId, document);
      });
      log.debug('Finished populating from IndexedDB of ' + name);

      col.sendChanges('ready');

      if (++i === this.collections.size) {
        this.idbIsLoaded = true;
        log.debug('Finished populating from IndexedDB of all collections');

        const existing = this.gongoStore.find({ type: 'updatedAt' })
          .toArraySync().map(row => row.name);

        for (let [name, coll] of this.collections) {
          if (!coll.isLocalCollection && !existing.includes(name)) {
            this.gongoStore.insert({
              type: 'updatedAt',
              name: name,
              updatedAt: new Date(0)
            });
          }
        }

        this.sendPendingChanges();
        this.sendSubscriptions();
      }
    });

    */
  }

  /*
  prepareDoc(doc) {
    return doc;
  }
  */

}

module.exports = { __esModule: true, default: GongoIDB };
