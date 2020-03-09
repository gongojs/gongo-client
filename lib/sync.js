const jsonpatch = require('fast-json-patch');

const sync = {

  serialize(input) {
    // for now, throw on error
    const output = JSON.parse(JSON.stringify(input));

    // note for idx we DO want these
    delete output.__pendingSince;
    delete output.__pendingInsert;

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
            out.delete.push(doc._id);

          } else if (doc.__pendingInsert) {

            if (!out.insert) out.insert = [];
            out.insert.push(sync.serialize(doc));

          } else if (doc.__pendingBase) {

            if (!out.update) out.update = [];
            const oldDoc = Object.assign({}, doc.__pendingBase);
            delete oldDoc._id;

            const newDoc = Object.assign({}, doc);
            delete newDoc._id;
            delete newDoc.__pendingBase;
            delete newDoc.__pendingSince;
            out.update.push({
              _id: doc._id,
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
