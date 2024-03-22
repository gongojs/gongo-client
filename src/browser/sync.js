const jsonpatch = require("fast-json-patch");
const ObjectID = require("bson-objectid");
const EJSON = require("ejson");

const sync = {
  // See also stringifyObjectIDs in Database.js
  // TODO, move together
  objectifyStringIDs(entry) {
    if (entry.__ObjectIDs)
      for (let prop of entry.__ObjectIDs) {
        if (prop.endsWith("[]")) {
          prop = prop.substr(0, prop.length - 2);
          entry[prop] = entry[prop].map((id) => ObjectID(id));
        } else {
          entry[prop] = ObjectID(entry[prop]);
        }
      }
    delete entry.__ObjectIDs;
  },

  serialize(input) {
    // for now, throw on error
    //const output = JSON.parse(JSON.stringify(input));
    const output = EJSON.clone(input);

    sync.objectifyStringIDs(output);

    // note for idx we DO want these
    delete output.__pendingSince;
    delete output.__pendingInsert;
    delete output.__pendingBase;
    delete output.__idbWaiting;

    return output;
  },

  cloneAndSubDates(obj) {
    return JSON.parse(
      JSON.stringify(obj, function replacer(key, toJsonValue) {
        const value = this[key];
        if (value instanceof Date) return "$DATE:" + toJsonValue;
        return toJsonValue;
      })
    );
  },

  jsonPatchCompare(_oldDoc, _newDoc) {
    const oldDoc = sync.cloneAndSubDates(_oldDoc);
    const newDoc = sync.cloneAndSubDates(_newDoc);
    const diff = jsonpatch.compare(oldDoc, newDoc);

    // Untested.
    diff.forEach((row) => {
      if (typeof row.value === "string" && row.value.substr(0, 6) === "$DATE:")
        row.value = new Date(row.value.substr(6));
    });

    return diff;
  },

  getChangeSet(db) {
    const changeSet = {};

    // TODO, lock entries until return?

    db.collections.forEach((coll) => {
      if (coll.isLocalCollection) return;

      const results = coll
        .find(
          { __pendingSince: { $exists: true }, __error: { $exists: false } },
          { includePendingDeletes: true }
        )
        .toArraySync();

      if (results.length) {
        const out = (changeSet[coll.name] = {});
        results.map((doc) => {
          if (doc.__pendingDelete) {
            if (!out.delete) out.delete = [];
            out.delete.push(sync.serialize(doc)._id);
          } else if (doc.__pendingInsert) {
            if (!out.insert) out.insert = [];
            out.insert.push(sync.serialize(doc));
          } else if (doc.__pendingBase) {
            if (!out.update) out.update = [];

            const oldDoc = sync.serialize(doc.__pendingBase);
            const newDoc = sync.serialize(doc);

            out.update.push({
              _id: oldDoc._id,
              patch: sync.jsonPatchCompare(oldDoc, newDoc),
            });
          } else {
            throw new Error(
              "not really sure what I got here: " + JSON.stringify(doc)
            );
          }
        });
      }
    });

    return Object.keys(changeSet).length === 0 ? null : changeSet;
  },

  async runChangeSet(db) {
    const changeSet = sync.getChangeSet(db);
    if (!changeSet) return;

    for (const [collName, ops] of Object.entries(changeSet)) {
      const collection = db.collection(collName);
      for (const [op, data] of Object.entries(ops)) {
        if (op === "insert" || op === "update") {
          const result =
            op === "insert"
              ? await db.call(op, { coll: collName, docs: data })
              : await db.call(op, {
                  coll: collName,
                  updates: data,
                });
          const errorIds = [];
          if (result.$errors) {
            console.error(`Marked op errors for ${collName}.${op}():`);
            for (const [id, error] of result.$errors) {
              console.error({ id: id.toString(), error });
              errorIds.push(id.toString());
              collection._update(id.toString(), {
                ...collection.findOne(id.toString()),
                __error: error,
              });
            }
          }
          for (const sentDoc of data) {
            const id = sentDoc._id.toString();
            if (errorIds.includes(id)) continue;
            const doc = collection.findOne(id);
            delete doc.__pendingSince;
            delete doc.__pendingInsert;
            delete doc.__pendingBase;
            collection._update(doc._id, doc);
          }
        } else if (op === "delete") {
          const result = await db.call("remove", { coll: collName, ids: data });
          const errorIds = [];
          if (result.$errors) {
            console.error(`Marked op errors for ${collName}.${op}():`);
            for (const [id, error] of result.$errors) {
              console.error({ id: id.toString(), error });
              errorIds.push(id.toString());
              collection._update(id.toString(), {
                ...collection.findOne(id.toString()),
                __error: error,
              });
            }
          }
          for (const _id of data) {
            const id = _id.toString();
            if (!errorIds.includes(id)) collection._remove(id);
          }
        } else console.error(`Skipping unknown op "${op}"`);
      }
    }
  },
};

module.exports = sync;
