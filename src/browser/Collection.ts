const modify = require("modifyjs"); // no types
import sift from "sift";

import Cursor from "./Cursor";
import ChangeStream from "./ChangeStream";
import type { ChangeStreamEvent } from "./ChangeStream";
import type Database from "./Database";

import { debug, randomId } from "./utils";
import ObjectID from "bson-objectid";

// https://github.com/mongodb/node-mongodb-native/blob/b67af3cd/src/mongo_types.ts#L46 thanks Mongo team
/** TypeScript Omit (Exclude to be specific) does not work for objects with an "any" indexed type, and breaks discriminated unions @public */
/*
export type EnhancedOmit<TRecordOrUnion, KeyUnion> =
  string extends keyof TRecordOrUnion
    ? TRecordOrUnion // TRecordOrUnion has indexed type e.g. { _id: string; [k: string]: any; } or it is "any"
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TRecordOrUnion extends any
    ? Pick<TRecordOrUnion, Exclude<keyof TRecordOrUnion, KeyUnion>> // discriminated unions
    : never;
*/

// Since TS 4.1, we can use the built-in Exclude
export type EnhancedOmit<T, K extends PropertyKey> = {
  [P in keyof T as Exclude<P, K>]: T[P];
};

export interface CollectionOptions {
  idType?: string;
  isLocalCollection?: boolean;
}

// TODO, get ideas from mongodb interface?
export interface GongoClientDocument {
  [key: string]: unknown;
  _id?: string;
  __ObjectIDs?: Array<string>;
  __updatedAt?: number;
  __pendingDelete?: boolean;
  __pendingSince?: number;
  __pendingBase?: GongoClientDocument; // TODO, Omit<GongoClientDocument, "__updatedAt" | "__" etc
  __pendingInsert?: boolean;
}

export type WithId<DocType extends GongoClientDocument> = EnhancedOmit<
  DocType,
  "_id"
> & {
  _id: string;
};
export type OptionalId<DocType extends GongoClientDocument> = EnhancedOmit<
  DocType,
  "_id"
> & {
  _id?: string;
};
export type ServerDoc<DocType extends GongoClientDocument> = EnhancedOmit<
  DocType,
  "_id" | "__updatedAt"
> & {
  _id: string;
  __updatedAt: number;
};

/*
export type OptId<TSchema> = EnhancedOmit<TSchema, "_id"> & { _id?: string };
export type OptUpdated<TSchema> = Omit<TSchema, "__updatedAt"> & {
  __updatedAt?: number;
};

export type NewDoc<TSchema> = EnhancedOmit<TSchema, "_id" | "__updatedAt"> & {
  _id?: string;
  __updatedAt?: number;
};
*/

// TODO, copy from mongodb "Filter" interface?
export interface Query {
  [key: string]: unknown;
}

export interface FindOptions {
  [key: string]: unknown;
}

export interface UpdateFilter {
  $set?: Record<string, unknown>;
  $inc?: Record<string, unknown>;
}

export default class Collection<DocType extends GongoClientDocument> {
  db: Database;
  name: string;
  documents: Map<string, WithId<DocType>>;
  persists: Array<ReturnType<typeof sift>>;
  changeStreams: Array<ChangeStream<DocType>>;
  isLocalCollection: boolean;
  idType: string;
  _didUpdateTimeout?: ReturnType<typeof setTimeout>;
  populated: boolean; // set to true by idb
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
    this.populated = false;
  }

  insertMissingId(doc: OptionalId<DocType>) {
    if (doc._id) return;
    else if (this.idType === "random") doc._id = Collection.randomId();
    else if (this.idType === "ObjectID") {
      doc._id = ObjectID().toHexString();
      if (!doc.__ObjectIDs) doc.__ObjectIDs = ["_id"];
      else doc.__ObjectIDs.push("_id");
    }
  }

  // Will be called by a collection if an update occured
  _didUpdate() {
    if (this._didUpdateTimeout) clearTimeout(this._didUpdateTimeout);

    this._didUpdateTimeout = setTimeout(() => this._updatesFinished(), 50);
  }

  _updatesFinished() {
    debug(`collection "${this.name}" updated`);
    this.db._didUpdate("Collection._updatesFinished");
  }

  // --- Persistance ---

  persist(query?: Query) {
    this.db.persistedQueriesExist = true;
    this.persists.push(sift(query || {}));
    this.db.idb.checkInit();
  }

  shouldPersist(doc: WithId<DocType>) {
    for (const query of this.persists) {
      if (query(doc)) return true;
    }
    return false;
  }

  // --- ChangeStreams

  watch() {
    const cs = new ChangeStream<DocType>(this);
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
  _insert(document: WithId<DocType>) {
    if (typeof document._id !== "string")
      throw new Error("no doc._id " + JSON.stringify(document));

    if (this.documents.has(document._id)) {
      // TODO, throw error.  add upsert support
    }

    // if (!document.__updatedAt) document.__updatedAt = this.db.getTime();

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
  insert(document: OptionalId<DocType>) {
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

    this._insert(docToInsert as WithId<DocType>);
    this._didUpdate();

    return docToInsert;
  }

  find(query: Query = {}, options?: FindOptions) {
    return new Cursor(this, query, options);
  }

  findOne(id: string): WithId<DocType> | null;
  findOne(query: Query): WithId<DocType> | null;
  findOne(query: string | Query): WithId<DocType> | null {
    if (typeof query === "string") return this.documents.get(query) || null;

    const matches = sift(query);
    for (const [, doc] of this.documents) {
      if (matches(doc)) return doc;
    }
    return null;
  }

  _update(strId: string, newDoc: DocType | WithId<DocType>) {
    if (typeof strId !== "string")
      throw new Error(
        "_update(id, ...) expects string id, not " + JSON.stringify(strId)
      );

    newDoc._id = strId;
    newDoc = newDoc as WithId<DocType>;
    this.documents.set(strId, newDoc);

    if (this.shouldPersist(newDoc)) this.db.idb.put(this.name, newDoc);

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

  updateId(strId: string, newDocOrChanges: DocType | UpdateFilter) {
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
    newDocOrChanges: DocType | UpdateFilter
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
  upsert(query: Query, doc: DocType) {
    const existing = this.findOne(query);
    if (existing) {
      this.update(query, { $set: doc });
    } else {
      this.insert(doc);
    }
  }

  _insertOrReplaceOne(doc: WithId<DocType>) {
    if (typeof doc._id !== "string")
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
