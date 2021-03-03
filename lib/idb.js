const { openDB, deleteDB } = require('idb');
const { debug: gongoDebug, debounce } = require('./utils');
const debug = gongoDebug.extend('idb');

class GongoIDB {

  constructor(db) {
    this.db = db;
    this.callbacks = {};

    // this.name = 'gongo';  TODO

    this.toSync = {};
    this.queuePutAll = debounce(() => this.putAll(), 50);
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
      this.callbacks[event].forEach(callback => {
        try {
          callback.call(this)
        } catch (e) {
          console.error(e);
        }
      });
  }

  async deleteDB() {
    (await this.idbPromise).close();
    return await deleteDB('gongo', {
      blocked() {
        console.warn('deleteDB still blocked');
      }
    });
  }

  putAll() {
    if (this._putAllPromise) {
      // TODO, we could also just queue to end of promise
      //throw new Error("putAll called during putAll");
      return this._putAllPromise.then(() => {
        this._putAll().then(() => {
          delete this._putAllPromise;
        });
      });
    }
    return this._putAllPromise = this._putAll().then(() => {
      delete this._putAllPromise;
    });
  }

  async _putAll() {
    const localToSync = this.toSync;
    this.toSync = {};

    let size = 0, i = 0;
    for (let set of Object.values(localToSync))
      size += set.size + 1; // +1 for tx.done

    debug("Begin IDB syncs for " + (size - Object.keys(localToSync).length) + " docs");

    const promises = new Array(size);
    const db = await this.idbPromise;

    for (let collName of Object.keys(localToSync)) {
      debug("Start IDB sync transaction: " + collName);
      const tx = db.transaction(collName, 'readwrite');
      for (let doc of localToSync[collName]) {
        promises[i++] = tx.store.put(doc, doc._id);
      }
      promises[i++] = tx.done;
      tx.done.then(() => {
        debug("Finish IDB sync transaction: " + collName);
        localToSync[collName].forEach(doc => delete doc.__idbWaiting);
        localToSync[collName] = [];
      });
    }

    await Promise.all(promises);
    debug("Finished IDB sync (all)");
  }

  put(collectionName, document) {
    this.toSync[collectionName] = this.toSync[collectionName] || new Set();
    this.toSync[collectionName].add(document);
    document.__idbWaiting = Date.now();
    this.queuePutAll();

    //const db = await this.idbPromise;
    //return db.put(collectionName, document, document._id);
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
    const idbPromise = this.idbPromise = openDB('gongo', this.idbDbVersion, {
      upgrade: (idb, oldVersion, newVersion, transaction) => {
        debug('Upgrading IDB "gongo" database v' + this.idbDbVersion);
        //console.log(idb, oldVersion, newVersion, transaction);

        for (let name of idb.objectStoreNames)
          if (!db.collections.has(name))
            idb.deleteObjectStore(name);

        for (let [name] of db.collections)
          if (!idb.objectStoreNames.contains(name))
            idb.createObjectStore(name);
      },
      blocked() {
        throw new Error("Older version of the databse is blocking us from opening");
      },
      async blocking() {
        console.log("We're blocking a future version of the database from opening, closing...");
        (await idbPromise).close();
        console.log("Closed");
      },
    });

    let idb;
    try {
      idb = await this.idbPromise;
    } catch (e) {
      console.log(e);
      throw e;
      //return;
    }

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
      await idb.close();
      await this.open();
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

    db.populated = true;
    this.exec('collectionsPopulated');

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
