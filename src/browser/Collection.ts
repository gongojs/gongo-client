const modify = require("modifyjs"); // no types
import sift from "sift";

import Cursor from "./Cursor";
import ChangeStream from "./ChangeStream";
import type { ChangeStreamEvent } from "./ChangeStream";
import type Database from "./Database";

import { debug, randomId } from "./utils";
import ObjectID from "bson-objectid";

export interface CollectionOptions {
  idType?: string;
  isLocalCollection?: boolean;
}

// TODO, get ideas from mongodb interface?
export interface Document {
  [key: string]: unknown;
  _id: string;
  __ObjectIDs?: Array<string>;
}

//export type WithId<TSchema> = Omit<TSchema, "_id"> & { _id: string };
export type OptId<TSchema> = Omit<TSchema, "_id"> & { _id?: string };

// TODO, copy from mongodb "Filter" interface?
export interface Query {
  [key: string]: unknown;
}

export interface FindOptions {
  [key: string]: unknown;
}

export interface UpdateFilter {
  $set?: Record<string, unknown>;
}

export default class Collection {
  db: Database;
  name: string;
  documents: Map<string, Document>;
  persists: Array<ReturnType<typeof sift>>;
  changeStreams: Array<ChangeStream>;
  isLocalCollection: boolean;
  idType: string;
  _didUpdateTimeout?: ReturnType<typeof setTimeout>;
  static randomId = randomId;
  static Cursor = Cursor;

  constructor(db: Database, name: string, opts: CollectionOptions = {}) {
    this.db = db;
    this.name = name;
    this.documents = new Map();
    this.persists = [];
    this.changeStreams = [];
    this.isLocalCollection = opts.isLocalCollection || false;
    this.idType = opts.idType || "ObjectID";
  }

  insertMissingId(doc: OptId<Document>) {
    if (doc._id) return;
    else if (this.idType === "random") doc._id = Collection.randomId();
    else if (this.idType === "ObjectID") {
      doc._id = ObjectID().toHexString();
      if (!doc.__ObjectIDs) doc.__ObjectIDs = ["_id"];
      else (doc.__ObjectIDs as Array<string>).push("_id");
    }
  }

  // Will be called by a collection if an update occured
  _didUpdate() {
    if (this._didUpdateTimeout) clearTimeout(this._didUpdateTimeout);

    this._didUpdateTimeout = setTimeout(() => this._updatesFinished(), 50);
  }

  _updatesFinished() {
    debug(`collection "${this.name}" updated`);
    this.db._didUpdate();
  }

  // --- Persistance ---

  persist(query?: Query) {
    this.db.persistedQueriesExist = true;
    this.persists.push(sift(query || {}));
    this.db.idb.checkInit();
  }

  shouldPersist(doc: Document) {
    for (const query of this.persists) {
      if (query(doc)) return true;
    }
    return false;
  }

  // --- ChangeStreams

  watch() {
    const cs = new ChangeStream(this);
    this.changeStreams.push(cs);
    cs.on(
      "close",
      () => (this.changeStreams = this.changeStreams.filter((x) => x !== cs))
    );
    return cs;
  }

  csExec(type: string, data?: ChangeStreamEvent) {
    // Note, cs.exec catches errors, so no need to catch here.
    this.changeStreams.forEach((cs) => cs.exec(type, data));
  }

  sendChanges(
    operationType: string,
    _id: string,
    data?: Record<string, unknown>
  ) {
    this.csExec("change", {
      operationType,
      ...data,
      ns: { db: this.db.name, coll: this.name },
      documentKey: { _id },
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

  /**
   * [_insert Insert "raw" document to local database, persist on match,
   *     notify changeStreams ]
   * @param  {object} document - document to insert that includes ._id
   * @return {null]}          TODO
   */
  _insert(document: Document) {
    if (typeof document._id !== "string")
      throw new Error("no doc._id " + JSON.stringify(document));

    if (this.documents.has(document._id)) {
      // TODO, throw error.  add upsert support
    }

    this.documents.set(document._id, document);

    if (this.shouldPersist(document)) this.db.idb.put(this.name, document);

    this.sendChanges("insert", document._id, { fullDocument: document });
  }

  /**
   * [insert Wrapper around _insert that generate _id if missing,
   *    add __pendingInsert and __pendingSince and mark collection
   *    as updated.]
   * @param  {object} document - document to insert
   * @return {object} document - the inserted document (with _id)
   */
  insert(document: OptId<Document>) {
    const docToInsert = this.isLocalCollection
      ? {
          ...document,
        }
      : {
          ...document,
          __pendingInsert: true,
          __pendingSince: this.db.getTime(),
        };

    this.insertMissingId(docToInsert);

    this._insert(docToInsert as Document);
    this._didUpdate();

    return docToInsert;
  }

  find(query: Query = {}, options?: FindOptions) {
    return new Cursor(this, query, options);
  }

  findOne(id: string): Document | null;
  findOne(query: Query): Document | null;
  findOne(query: string | Query): Document | null {
    if (typeof query === "string") return this.documents.get(query) || null;

    const matches = sift(query);
    for (const [, doc] of this.documents) {
      if (matches(doc)) return doc;
    }
    return null;
  }

  _update(strId: string, newDoc: OptId<Document>) {
    if (typeof strId !== "string")
      throw new Error(
        "_update(id, ...) expects string id, not " + JSON.stringify(strId)
      );

    newDoc._id = strId;
    this.documents.set(strId, newDoc as Document);

    if (this.shouldPersist(newDoc as Document))
      this.db.idb.put(this.name, newDoc);

    // TODO should we assert strId = newDoc._id?

    this.sendChanges("update", strId, {
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

  updateId(strId: string, newDocOrChanges: Document | UpdateFilter) {
    const oldDoc = this.documents.get(strId);

    if (!oldDoc || oldDoc.__pendingDelete)
      throw new Error(
        "_updateId(strId, ...) called with id with no match: " + strId
      );

    const newDoc = modify(oldDoc, newDocOrChanges);

    // If the same documents are the same, don't mark as changed, don't sync
    // TODO, serialization
    if (JSON.stringify(oldDoc) === JSON.stringify(newDoc)) return false;

    // allow multiple updates
    if (!this.isLocalCollection && !newDoc.__pendingSince) {
      newDoc.__pendingSince = this.db.getTime();
      newDoc.__pendingBase = oldDoc;
      delete oldDoc.__pendingSince;
      delete oldDoc.__pendingInsert;
    }

    const result = this._update(strId, newDoc);
    this._didUpdate();
    return result;
  }

  update(
    idOrSelector: string | Query,
    newDocOrChanges: Document | UpdateFilter
  ) {
    if (typeof idOrSelector === "string") {
      return this.updateId(idOrSelector, newDocOrChanges);
    } else if (idOrSelector && typeof idOrSelector === "object") {
      const query = sift(idOrSelector);

      const updatedDocIds = [];
      let matchedCount = 0;
      let modifiedCount = 0;

      for (const [id, doc] of this.documents)
        if (query(doc)) {
          matchedCount++;
          if (this.updateId(id, newDocOrChanges)) {
            modifiedCount++;
            updatedDocIds.push(id);
          }
        }
      return {
        matchedCount,
        modifiedCount,
        __updatedDocsIds: updatedDocIds,
      };
    } else {
      throw new Error(
        "update(id,...) expects id to be str/obj, not " +
          JSON.stringify(idOrSelector)
      );
    }
  }

  // TODO, needs more work... what to insert, what to update (just replace doc?)
  upsert(query: Query, doc: OptId<Document>) {
    const existing = this.findOne(query);
    if (existing) {
      this.update(query, { $set: doc });
    } else {
      this.insert(doc);
    }
  }

  _insertOrReplaceOne(doc: Document) {
    if (!doc._id)
      throw new Error(
        "_insertOrReplaceOne, no `_id` field in " + JSON.stringify(doc)
      );

    const existing = this.documents.has(doc._id);

    if (existing) {
      this._update(doc._id, doc);
    } else {
      this._insert(doc);
    }
  }

  _remove(strId: string) {
    if (typeof strId !== "string")
      throw new Error("_remove(strId) expects a string id");

    const existingDoc = this.documents.get(strId);
    if (!existingDoc) return;

    this.documents.delete(strId);

    if (this.shouldPersist(existingDoc)) this.db.idb.delete(this.name, strId);

    this.sendChanges("delete", existingDoc._id);
  }

  removeId(strId: string) {
    const doc = this.documents.get(strId);
    if (!doc) return;

    if (this.isLocalCollection || doc.__pendingInsert) {
      this._remove(strId);
    } else {
      doc.__pendingDelete = true;
      doc.__pendingSince = this.db.getTime();
      this._update(doc._id, doc);
    }

    this._didUpdate();
  }

  remove(idOrSelector: string | Query) {
    if (typeof idOrSelector === "string") {
      return this.removeId(idOrSelector);
    } else if (idOrSelector && typeof idOrSelector === "object") {
      const query = sift(idOrSelector);
      for (const [id, doc] of this.documents) {
        if (query(doc)) this.removeId(id);
      }
    } else {
      throw new Error(
        "remove() called with invalid argument: " + JSON.stringify(idOrSelector)
      );
    }
  }
}
