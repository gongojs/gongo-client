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
