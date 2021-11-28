const sync = require('./sync');
const Database = require('./Database').default;

describe('sync', () => {

  describe('serialize', () => {

    it('should strip __tags', () => {
      const input = { a:1,
        __pendingSince: Date.now(),
        __pendingInsert: true,
        __idbWaiting: Date.now(),
      };

      const output = sync.serialize(input);
      expect(output.__pendingSince).toBe(undefined);
      expect(output.__pendingInsert).toBe(undefined);
      expect(output.__idbWaiting).toBe(undefined);
    });

  });

  describe('objectifyStringIDs', () => {

    it('does like it says', () => {

      const origDoc = {
        _id: '54495ad94c934721ede76d90',
        otherId: '54495ad94c934721ede76d91',
        other: 'moo',
        __ObjectIDs: [ '_id', 'otherId' ],
      };

      const doc = { ...origDoc };
      sync.objectifyStringIDs(doc);

      expect(doc.other).toBe('moo');
      expect(doc.__ObjectIDs).not.toBeDefined();
      expect(doc._id.toHexString()).toBe(origDoc._id);
      expect(doc.otherId.toHexString()).toBe(origDoc.otherId);
    });
    
  });

  describe('jsonCompare', () => {

    it('works as expected with basic json', () => {
      const documentA = {user: {firstName: "Albert", lastName: "Einstein"}};
      const documentB = {user: {firstName: "Albert", lastName: "Collins"}};
      const diff = sync.jsonPatchCompare(documentA, documentB);
      diff //?
      expect(diff.length).toBe(1);
      expect(diff[0]).toMatchObject({op: "replace", path: "/user/lastName", value: "Collins"});
    });

    describe('dates', () => {

      it('does not try change same date (same date object)', () => {
        const date = new Date();
        const docA = { date }, docB = { date };
        const diff = sync.jsonPatchCompare(docA, docB);
        expect(diff.length).toBe(0);
      });

      it('does not try change the "same" date (same time, diff object)', () => {
        const docA = { date: new Date() }, docB = { date: new Date() };
        const diff = sync.jsonPatchCompare(docA, docB);
        expect(diff.length).toBe(0);
      });

      it('can change a date to a different date', () => {
        const docA = { date: new Date("2020-01-01")};
        const docB = { date: new Date("2020-01-02")};
        const diff = sync.jsonPatchCompare(docA, docB);
        diff //?
        diff[0].value //?
      });

    });

  });

  describe('getChangeSet', () => {

    const FakeDb = { name: 'FakeDb' /* , getTime() { return Date.now(); } */ };

    describe('inserts', () => {

      it('works with one insert', () => {
        const db = new Database(FakeDb, 'test');
        const row = { _id: 'id1', a: 1 };
        db.collection('test').insert(row);

        const cs = db.getChangeSet();
        expect(cs).toEqual({ test: { insert: [ row ] } });
      });

      it('works with two inserts', () => {
        const db = new Database(FakeDb, 'test');
        const row1 = { _id: 'id1' };
        const row2 = { _id: 'id2' };
        const test = db.collection('test');
        test.insert(row1);
        test.insert(row2);

        const cs = db.getChangeSet();
        expect(cs).toEqual({ test: { insert: [ row1, row2 ] } });
      });

    });

    describe('updates', () => {

      it('works with one update', () => {
        const db = new Database(FakeDb, 'test');
        const row = { _id: 'id1', a: 1 };
        const test = db.collection('test');
        test._insert(row);  // use _insert as if previously synced
        test.update('id1', { $set: { a: 2 }});

        const cs = db.getChangeSet();
        expect(cs).toEqual({ test: { update: [ {
          _id: 'id1',
          patch: [
            { op: 'replace', path: '/a', value: 2 }
          ]
        } ] } });
      });

      it('works with two updates', () => {
        const db = new Database(FakeDb, 'test');
        const row1 = { _id: 'id1', a: 1 };
        const row2 = { _id: 'id2', a: 1 };
        const test = db.collection('test');
        test._insert(row1);  // use _insert as if previously synced
        test._insert(row2);  // use _insert as if previously synced
        test.update('id1', { $set: { a: 2 }});
        test.update('id2', { $set: { a: 2 }});

        const cs = db.getChangeSet();
        expect(cs).toEqual({ test: { update: [
          {
            _id: 'id1',
            patch: [
              { op: 'replace', path: '/a', value: 2 }
            ]
          },
          {
            _id: 'id2',
            patch: [
              { op: 'replace', path: '/a', value: 2 }
            ]
          },
        ] } });
      });

    });

    describe('deletes', () => {

      it('works with one delete', () => {
        const db = new Database(FakeDb, 'test');
        const row = { _id: 'id1', a: 1 };
        const test = db.collection('test');
        test._insert(row);  // use _insert as if previously synced
        test.removeId('id1');

        const cs = db.getChangeSet();
        expect(cs).toEqual({ test: { delete: [ 'id1' ] } });
      });

      it('works with two deletes', () => {
        const db = new Database(FakeDb, 'test');
        const test = db.collection('test');
        test._insert({ _id: 'id1' });  // use _insert as if previously synced
        test._insert({ _id: 'id2' });  // use _insert as if previously synced
        test.removeId('id1');
        test.removeId('id2');

        const cs = db.getChangeSet();
        expect(cs).toEqual({ test: { delete: [ 'id1', 'id2' ] } });
      });

    });

    it('throws on weird unknown doc thing', () => {
        const db = new Database(FakeDb, 'test');
        const test = db.collection('test');
        test._insert({
          _id: 'id1',
          __pendingSince: Date.now(),
        });

        expect(() => db.getChangeSet()).toThrow('not really sure');
    });

    it('returns null on no changes', () => {
        const db = new Database(FakeDb, 'test');
        db.collection('test');

        const cs = db.getChangeSet();
        expect(cs).toBe(null);

    });

  });

});
