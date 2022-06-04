const jsonpatch = require("fast-json-patch");
const ObjectID = require("bson-objectid");
const EJSON = require("ejson");

const sync = {
  // See also stringifyObjectIDs in Database.js
  // TODO, move together
  objectifyStringIDs(entry) {
    if (entry.__ObjectIDs)
      for (let prop of entry.__ObjectIDs) entry[prop] = ObjectID(entry[prop]);
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

    db.collections.forEach((coll) => {
      if (coll.isLocalCollection) return;

      const results = coll
        .find(
          { __pendingSince: { $exists: true } },
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
};

module.exports = sync;
