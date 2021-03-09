const jsonpatch = require('fast-json-patch');
const ObjectID = require("bson-objectid");

const sync = {

  // See also stringifyObjectIDs in Database.js
  // TODO, move together
  objectifyStringIDs(entry) {
    if (entry.__ObjectIDs)
    for (let prop of entry.__ObjectIDs)
      entry[prop] = ObjectID(entry[prop]);
    delete entry.__ObjectIDs;
  },

  serialize(input) {
    // for now, throw on error
    const output = JSON.parse(JSON.stringify(input));
    sync.objectifyStringIDs(output);

    // note for idx we DO want these
    delete output.__pendingSince;
    delete output.__pendingInsert;
    delete output.__idbWaiting;

    return output;
  },

  getChangeSet(db) {
    const changeSet = {};

    db.collections.forEach(coll => {
      if (coll.isLocalCollection)
        return;

      const results = coll.find({ __pendingSince: { $exists: true }}, { includePendingDeletes: true })
        .toArraySync()

      if (results.length) {
        const out = changeSet[coll.name] = {};
        results.map(doc => {

          if (doc.__pendingDelete) {

            if (!out.delete) out.delete = [];
            out.delete.push(sync.serialize(doc)._id);

          } else if (doc.__pendingInsert) {

            if (!out.insert) out.insert = [];
            out.insert.push(sync.serialize(doc));

          } else if (doc.__pendingBase) {
            if (!out.update) out.update = [];
            
            const oldDoc = Object.assign({}, doc.__pendingBase);
            const id = sync.serialize(oldDoc)._id;
            delete oldDoc._id;

            const newDoc = Object.assign({}, doc);
            delete newDoc._id;
            delete newDoc.__pendingBase;
            delete newDoc.__pendingSince;
            delete newDoc.__idbWaiting;
            
            
            out.update.push({
              _id: id,
              patch: jsonpatch.compare(oldDoc, newDoc)
            });

          } else {

            throw new Error("not really sure what I got here: " + JSON.stringify(doc));

          }

        });
      }
    });

    return Object.keys(changeSet).length === 0 ? null : changeSet;
  }

}

module.exports = sync;
