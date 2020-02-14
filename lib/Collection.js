const modify = require('modifyjs');
const sift = require('sift').default;

const Cursor = require('./Cursor').default;
const ChangeStream = require('./ChangeStream').default;

// Thanks Meteor, https://github.com/meteor/meteor/blob/devel/packages/random/random.js
const UNMISTAKABLE_CHARS = "23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz";

function randomId(charsCount = 17) {
  let id = '';
  const values = new Uint32Array(charsCount);
  window.crypto.getRandomValues(values);
  for (let i=0; i < charsCount; i++)
    id += UNMISTAKABLE_CHARS[values[i] % UNMISTAKABLE_CHARS.length];
  return id;
}

class Collection {

  constructor(db, name, opts = {}) {
    this.db = db;
    this.name = name;
    this.documents = new Map();
    this.persists = [];
    this.changeStreams = [];
    this.isLocalCollection = opts.isLocalCollection || false;
  }

  // Will be called by a collection if an update occured
  _didUpdate() {
    if (this._didUpdateTimeout)
      clearTimeout(this._didUpdateTimeout);

    this._didUpdateTimeout = setTimeout(() => this._updatesFinished(), 50);
  }

  _updatesFinished() {
    console.log('collection updated');
    this.db._didUpdate();
  }

  // --- Persistance ---

  persist(query) {
    this.db.persistedQueriesExist = true;
    this.persists.push(sift(query || {}));
    this.db.idb.checkInit();
  }

  shouldPersist(doc) {
    for (let query of this.persists) {
      if (query(doc))
        return true;
    }
    return false;
  }

  // --- ChangeStreams

  watch() {
    const cs = new ChangeStream(this);
    this.changeStreams.push(cs);
    return cs;
  }

  sendChanges(operationType, _id, data) {
    this.changeStreams.forEach(cs => {
      cs.exec({
        operationType,
        ...data,
        ns: { db: this.db.name, coll: this.name },
        documentKey: { _id }
      })
    });
  }

  // --- CRUD operations

  /*
   * _funcs should
   *   - write to in-memory store (with objects), and
   *   - save to idb (in json)
   *   - notify (or not)
   *
   * non-(_)-funcs should
   *   - add _pending markups
   *   - call _funcs
   */

  _insert(document) {
    if (!document._id)
      throw new Error('no doc._id ' + JSON.stringify(document));

    if (this.documents.has(document._id)) {
      // TODO, throw error.  add upsert support
    }

    this.documents.set(document._id, document);

    if (this.shouldPersist(document))
      this.db.idb.put(this.name, document);

    this.sendChanges('insert', document._id, { fullDocument: document });
  }

  insert(document) {
    const docToInsert = this.isLocalCollection ? {

      _id: document._id || randomId(),
        ...document,

    } : {

      _id: document._id || randomId(),
        ...document,
      __pendingInsert: true,
      __pendingSince: this.db.getTime(),

    };

    this._insert(docToInsert);
    this._didUpdate();
  }

  find(query, options) {
    return new Cursor(this, query, options);
  }

  findOne(query) {
    if (typeof query === 'string')
      return this.documents.get(query) || null;

    const matches = sift(query);
    for (let [id, doc] of this.documents) {
      if (matches(doc))
        return doc;
    }
    return null;
  }

  _update(strId, newDoc) {
    if (typeof strId !== 'string')
      throw new Error("_update(id, ...) expects string id, not " + JSON.stringify(strId));

    this.documents.set(strId, newDoc);

    if (this.shouldPersist(newDoc))
      this.db.idb.put(this.name, newDoc);

    this.sendChanges('update', newDoc._id, {
      // does mongo do this?
      fullDocument: newDoc,
      /*
      updateDescription: {
        updatedFields: newDocOrChanges.$set,
        removedFields: []
      }
      */
    });

    return newDoc;
  }

  updateId(strId, newDocOrChanges) {
    const oldDoc = this.documents.get(strId);

    if (!oldDoc)
      throw new Error("_updateId(strId, ...) called with id with no match: " + strId);

    const newDoc = modify(oldDoc, newDocOrChanges);

    // If the same documents are the same, don't mark as changed, don't sync
    // TODO, serialization
    if (JSON.stringify(oldDoc) === JSON.stringify(newDoc))
      return false;

    // allow multiple updates
    if (!this.isLocalCollection || !newDoc.__pendingSince) {
      newDoc.__pendingSince = this.db.getTime();
      newDoc.__pendingBase = oldDoc;
      delete oldDoc.__pendingSince;
      delete oldDoc.__pendingInsert;
      delete oldDoc.__pendingDelete;
    }

    const result = this._update(strId, newDoc);
    this._didUpdate();
    return result;
  }

  update(idOrSelector, newDocOrChanges) {
    if (typeof idOrSelector === 'string') {

      return this.updateId(idOrSelector, newDocOrChanges);

    } else if (typeof idOrSelector === 'object') {

      const query = sift(idOrSelector);

      const updatedDocIds = [];
      let matchedCount = 0;
      let modifiedCount = 0;

      for (let [id, doc] of this.documents)
        if (query(doc)) {
          matchedCount++;
          if (this.updateId(id, newDocOrChanges)) {
            modifiedCount++;
            updatedDocIds.push(id);
          };
        }
      return {
        matchedCount,
        modifiedCount,
        __updatedDocsIds: updatedDocIds,
      };

    } else {
      throw new Error();
    }
  }

  upsert(query, doc) {
    // TODO use count() when avaialble
    const existing = this.find(query).toArraySync();
    if (existing) {
      this.update(query, { $set: doc });
    } else {
      this.insert(doc);
    }
  }

  _remove(strId) {
    const existingDoc = this.documents.get(strId);
    if (!existingDoc)
      return;

    this.documents.delete(strId);

    if (this.shouldPersist(existingDoc))
      this.db.idb.delete(this.name, strId);

    this.sendChanges('delete', existingDoc._id);
  }

  removeId(strId) {
    const doc = this.documents.get(strId);
    if (!doc)
      return;

    if (this.isLocalCollection) {

      this._remove(strId);

    } else {

      doc.__pendingDelete = true;
      doc.__pendingSince = this.db.getTime();
      this._update(doc._id, doc);

    }

    this._didUpdate();
  }

  remove(idOrSelector) {
    if (typeof idOrSelector === 'string') {

      return this.removeId(idOrSelector);

    } else if (typeof idOrSelector === 'object') {

      const query = sift(idOrSelector);
      for (let [id, doc] of this.documents) {
        if (query(doc))
          this.removeId(id);
      }

    } else {

      throw new Error('remove() called with invalid argument: '
        + JSON.stringify(idOrSelector));

    }
  }

}

module.exports = { __esModule: true, randomId, default: Collection };
