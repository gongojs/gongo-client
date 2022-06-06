import Collection from "./Collection";
import Cursor from "./Cursor";
import ChangeStream from "./ChangeStream";
import { jest } from "@jest/globals";
import type Database from "./Database";

describe("Collection", () => {
  const FakeDb = {
    name: "FakeDb",
    getTime() {
      return Date.now();
    },
  } as unknown as Database;

  it("can be created", () => {
    const col = new Collection(FakeDb, "test");

    expect(col.db).toBe(FakeDb);
    expect(col).toBeInstanceOf(Collection);
  });

  describe("_didUpdate / _updateFinsihed", () => {
    it("_didUpdate sets a timeout to run updatesFinished", () => {
      const col = new Collection(FakeDb, "test");
      jest.useFakeTimers();

      col._updatesFinished = jest.fn();
      col._didUpdate();
      expect(col._updatesFinished).not.toBeCalled();
      jest.runAllTimers();
      expect(col._updatesFinished).toBeCalled();
      expect(col._updatesFinished).toHaveBeenCalledTimes(1);
    });

    it("didUpdate clears an existing timeout", () => {
      const col = new Collection(FakeDb, "test");
      jest.useFakeTimers();

      const existingCallbackToBeCleared = jest.fn();
      // @ts-expect-error: it's ok bruh
      col._didUpdateTimeout = existingCallbackToBeCleared;
      col._updatesFinished = jest.fn();
      col._didUpdate();
      jest.runAllTimers();
      expect(existingCallbackToBeCleared).not.toBeCalled();
    });

    it("_updatesFinished calls db didUpdate", () => {
      const db = { _didUpdate: jest.fn() } as unknown as Database;
      const col = new Collection(db, "test");
      col._updatesFinished();
      expect(db._didUpdate).toHaveBeenCalled();
    });
  });

  describe("persistance", () => {
    it("persist()", () => {
      const db = { idb: { checkInit: jest.fn() } } as unknown as Database;
      const col = new Collection(db, "test");

      col.persist();
      expect(col.db.persistedQueriesExist).toBe(true);
      expect(col.persists.length).toBe(1);
      const p1 = col.persists[0];
      expect(p1({ type: "apple" })).toBe(true);
      expect(col.db.idb.checkInit).toHaveBeenCalled();
    });

    it("persist(query)", () => {
      const db = { idb: { checkInit: jest.fn() } } as unknown as Database;
      const col = new Collection(db, "test");
      const query = { type: "apple" };

      col.persist(query);
      expect(col.db.persistedQueriesExist).toBe(true);
      expect(col.persists.length).toBe(1);
      const p1 = col.persists[0];
      expect(p1({ type: "apple" })).toBe(true);
      expect(p1({ type: "banana" })).toBe(false);
      expect(col.db.idb.checkInit).toHaveBeenCalled();
    });

    it("shouldPersist(doc) matches", () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const db = { idb: { checkInit() {} } } as unknown as Database;
      const col = new Collection(db, "test");
      col.persist({ type: "apple" });
      expect(col.shouldPersist({ type: "apple" })).toBe(true);
      expect(col.shouldPersist({ type: "banana" })).toBe(false);
    });
  });

  describe("changestreams", () => {
    describe("watch", () => {
      it("returns a ChangeStream, adds to cs array", () => {
        const col = new Collection(FakeDb, "test");
        const cs = col.watch();
        expect(cs).toBeInstanceOf(ChangeStream);
        expect(col.changeStreams).toContain(cs);
      });

      it("adds a callback to remove cs from cs array on close", () => {
        const col = new Collection(FakeDb, "test");
        const cs1 = col.watch();
        const cs2 = col.watch();
        cs1.close();
        expect(col.changeStreams).not.toContain(cs1);
        expect(col.changeStreams).toContain(cs2);
      });
    });

    describe("csExec", () => {
      it("catches errors in callbacks", () => {
        const col = new Collection(FakeDb, "test");
        const cs = col.watch();
        cs.on("change", () => {
          throw new Error();
        });

        const error = console.error;
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        console.error = () => {};
        expect(() => col.csExec("change")).not.toThrow();
        console.error = error;
      });
    });

    describe("sendChanges", () => {
      it("runs callbacks", () => {
        const col = new Collection(FakeDb, "test");
        const cs = col.watch();
        const callback = jest.fn();
        cs.on("change", callback);

        col.sendChanges("insert", "a", { _id: "a", a: 1 });
        expect(callback).toHaveBeenCalledWith({
          operationType: "insert",
          _id: "a",
          a: 1,
          ns: { db: "FakeDb", coll: "test" },
          documentKey: { _id: "a" },
        });
      });
    });
  });

  describe("CRUD", () => {
    // check modify on pendingInsert

    describe("_insert", () => {
      it("inserts a single record", () => {
        const col = new Collection(FakeDb, "test");
        const doc = { _id: "a", __updatedAt: 1 };
        col._insert(doc);

        const result = col.findOne({});
        expect(result).toBe(doc);
      });

      it("throws on no _id", () => {
        const col = new Collection(FakeDb, "test");
        const docWithoutId = {};

        expect(() => {
          // @ts-expect-error: testing it throws on bad input
          col._insert(docWithoutId);
        }).toThrow();
      });

      it("persists on match (only)", () => {
        const db = { idb: { put: jest.fn() } } as unknown as Database;
        const col = new Collection(db, "test");
        const doc = { _id: "id" };

        col.shouldPersist = () => false;
        col._insert(doc);
        expect(db.idb.put).not.toBeCalled();
        col.shouldPersist = () => true;
        col._insert(doc);
        expect(db.idb.put).toBeCalledWith("test", doc);
      });

      it("calls sendChanges() with insert, strId and fulldoc", () => {
        const col = new Collection(FakeDb, "test");
        const doc = { _id: "1", type: "cat" };

        col.sendChanges = jest.fn<typeof col.sendChanges>();
        col._insert(doc);

        expect(col.sendChanges).toHaveBeenCalledWith("insert", "1", {
          fullDocument: doc,
        });
      });
    });

    describe("insert", () => {
      const realRandomId = Collection.randomId;

      beforeAll(() => {
        Collection.randomId = () => "randomId";
      });

      afterAll(() => {
        Collection.randomId = realRandomId;
      });

      it("calls _insert and _didUpdate", () => {
        const col = new Collection(FakeDb, "test");
        col._insert = jest.fn();
        col._didUpdate = jest.fn();
        col.insert({ _id: "1" });
        expect(col._insert).toHaveBeenCalled();
        expect(col._didUpdate).toHaveBeenCalled();
      });

      it("adds an id if none given (non-local collection)", () => {
        const col = new Collection(FakeDb, "test", { idType: "random" });
        col._insert = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        col._didUpdate = () => {};

        col.insert({});
        expect(
          (col._insert as unknown as jest.Mock).mock.calls[0][0]
        ).toHaveProperty("_id", "randomId");
      });

      it("adds an id if none given (local collection)", () => {
        const col = new Collection(FakeDb, "test", {
          isLocalCollection: true,
          idType: "random",
        });
        col._insert = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        col._didUpdate = () => {};

        col.insert({});
        expect(
          (col._insert as unknown as jest.Mock).mock.calls[0][0]
        ).toHaveProperty("_id", "randomId");
      });

      // mongo objectid... should be moved out Collection.js
      it("adds objectid", () => {
        const col = new Collection(FakeDb, "test");
        col._insert = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        col._didUpdate = () => {};

        col.insert({});
        const doc = (col._insert as unknown as jest.Mock).mock.calls[0][0];
        expect(doc._id).toHaveLength(24);
        expect(doc.__ObjectIDs).toMatchObject(["_id"]);
      });

      it("test insertmissing after other oid", () => {
        const col = new Collection(FakeDb, "test");
        col._insert = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        col._didUpdate = () => {};

        col.insert({
          otherId: "604628c8d2b3488f1a2fad7e",
          __ObjectIDs: ["otherId"],
        });
        const doc = (col._insert as unknown as jest.Mock).mock.calls[0][0];
        expect(doc._id).toHaveLength(24);
        expect(doc.__ObjectIDs).toContain("otherId");
        expect(doc.__ObjectIDs).toContain("_id");
      });
    });

    describe("find", () => {
      it("returns a Cursor", () => {
        const col = new Collection(FakeDb, "test");
        const cursor = col.find({});
        expect(cursor).toBeInstanceOf(Cursor);
      });
    });

    describe("findOne", () => {
      it("returns first match on find(query)", () => {
        const col = new Collection(FakeDb, "test");
        const apple = { _id: "apple" };
        const banana = { _id: "banana" };
        col._insert(apple);
        col._insert(banana);
        expect(col.findOne({ _id: "banana" })).toEqual(banana);
      });

      it("returns null on no match for find(query)", () => {
        const col = new Collection(FakeDb, "test");
        const apple = { _id: "apple" };
        col._insert(apple);
        expect(col.findOne({ _id: "banana" })).toBe(null);
      });

      it("returns an exact record on find(strId)", () => {
        const col = new Collection(FakeDb, "test");
        const apple = { _id: "apple" };
        const banana = { _id: "banana" };
        col._insert(apple);
        col._insert(banana);
        expect(col.findOne("apple")).toEqual(apple);
      });

      it("returns null on no record for find(strId)", () => {
        const col = new Collection(FakeDb, "test");
        const apple = { _id: "apple" };
        col._insert(apple);
        expect(col.findOne("banana")).toBe(null);
      });
    });

    describe("_update", () => {
      it("throws on non strId", () => {
        const col = new Collection(FakeDb, "test");
        expect(() => col._update("strId", {})).not.toThrow();
        // @ts-expect-error: testing bad input
        expect(() => col._update({ id: "strId" })).toThrow();
      });

      it("replaces in-memory doc", () => {
        const col = new Collection(FakeDb, "test");
        const oldDoc = { _id: "1", type: "cat" };
        const newDoc = { _id: "1", type: "dog" };

        col._insert(oldDoc);
        col._update(oldDoc._id, newDoc);
        expect(col.findOne(oldDoc._id)).toEqual(newDoc);
      });

      it("persists on match (only)", () => {
        const db = { idb: { put: jest.fn() } } as unknown as Database;
        const col = new Collection(db, "test");
        const doc = { _id: "1" };

        col.shouldPersist = () => false;
        col._update(doc._id, doc);
        expect(db.idb.put).not.toBeCalled();
        col.shouldPersist = () => true;
        col._update(doc._id, doc);
        expect(db.idb.put).toBeCalledWith("test", doc);
      });

      it("calls sendChanges() with update, strId and ??", () => {
        const col = new Collection(FakeDb, "test");
        const oldDoc = { _id: "1", type: "cat" };
        const newDoc = { _id: "1", type: "dog" };

        // eslint-disable-next-line @typescript-eslint/no-empty-function
        col.sendChanges = () => {};
        col._insert(oldDoc);

        col.sendChanges = jest.fn();
        col._update(oldDoc._id, newDoc);
        expect(col.sendChanges).toHaveBeenCalledWith("update", "1", {
          fullDocument: newDoc,
        });
      });
    });

    describe("updateId", () => {
      it("throws on non-existing doc._id", () => {
        const col = new Collection(FakeDb, "test");
        expect(() => col.updateId("nonExistant", {})).toThrow(
          "called with id with no match"
        );
      });

      it("throws on given id of a pendingDelete", () => {
        const col = new Collection(FakeDb, "test");

        // use _insert as insert will add __pendingInsert
        // we assume a *synced* already inserted record here
        col._insert({ _id: "a" });

        // now we delete it and leave that as unsynced
        col.removeId("a");

        // now let's try update it, an unsynced deleted record
        expect(() => col.updateId("a", {})).toThrow(
          "called with id with no match"
        );
      });

      it("returns false if no actual change is made", () => {
        const col = new Collection(FakeDb, "test");
        const doc = { _id: "1", type: "cat" };
        col._insert(doc);

        const result = col.update(doc._id, { $set: { type: "cat" } });
        expect(result).toBe(false);
      });

      it("does not set __pendings on local collection", () => {
        const col = new Collection(FakeDb, "test", { isLocalCollection: true });
        const origDoc = { _id: "1", type: "cat" };
        col._insert(origDoc);
        col.update(origDoc._id, { $set: { type: "dog" } });

        const newDoc = col.findOne(origDoc._id);
        if (!newDoc) throw new Error("no document found");
        expect(newDoc.__pendingSince).toBe(undefined);
        expect(newDoc.__pendingBase).toBe(undefined);
      });

      it("sets __pendingSince and __pendingBase on synced collection", () => {
        const col = new Collection(FakeDb, "test");
        const origDoc = { _id: "1", type: "cat" };
        col._insert(origDoc);
        col.update(origDoc._id, { $set: { type: "dog" } });

        const newDoc = col.findOne(origDoc._id);
        if (!newDoc) throw new Error("no document found");
        expect(newDoc.__pendingSince).toBeTruthy();
        expect(newDoc.__pendingBase).toEqual(origDoc);
      });

      it("ensures no __pendingBase.__pending on unsynced insert", () => {
        const col = new Collection(FakeDb, "test");
        const origDoc = { _id: "1", type: "cat" };
        col.insert(origDoc);
        col.update(origDoc._id, { $set: { type: "dog" } });

        const newDoc = col.findOne(origDoc._id);
        if (!newDoc) throw new Error("no document found");
        expect(newDoc.__pendingInsert).toBe(true);
        expect(newDoc.__pendingBase).toBe(undefined);
      });

      it("correctly adjusts __pending on multiple updates before sync", () => {
        const col = new Collection(FakeDb, "test");
        const origDoc = { _id: "1", type: "cat" };
        col._insert(origDoc);
        col.update(origDoc._id, { $set: { type: "dog" } });

        let newDoc;
        newDoc = col.findOne(origDoc._id);
        if (!newDoc) throw new Error("no document found");

        expect(newDoc.__pendingSince).toBeTruthy();
        // toEqual ensures no extra props, e.g. __pending*
        expect(newDoc.__pendingBase).toEqual(origDoc);

        col.update(origDoc._id, { $set: { type: "frog" } });
        newDoc = col.findOne(origDoc._id);
        if (!newDoc) throw new Error("no document found");
        expect(newDoc.__pendingSince).toBeTruthy();
        // toEqual ensures no extra props, e.g. __pending*
        expect(newDoc.__pendingBase).toEqual(origDoc);
      });
    });

    describe("update", () => {
      it("calls updateId on str id", () => {
        const col = new Collection(FakeDb, "test");

        col.updateId = jest.fn<typeof col.updateId>();
        col.update("strId", {});
        expect(col.updateId).toHaveBeenCalledWith("strId", {});
      });

      it("calls updateId on matchin docs, return match/mod info", () => {
        const col = new Collection(FakeDb, "test");
        col._insert({ _id: "1", type: "apple" });
        col._insert({ _id: "2", type: "apple" });
        col._insert({ _id: "3", type: "banana" });

        const update = { $set: { type: "banana " } };
        col.updateId = jest
          .fn<typeof col.updateId>()
          .mockReturnValueOnce({})
          .mockReturnValueOnce(false);

        const result = col.update({ type: "apple" }, update);
        expect(col.updateId).toHaveBeenCalledWith("1", update); // apple
        expect(col.updateId).toHaveBeenCalledWith("2", update); // apple
        expect(col.updateId).not.toHaveBeenCalledWith("3", update); // banana

        expect(result).toEqual({
          matchedCount: 2,
          modifiedCount: 1,
          __updatedDocsIds: ["1"],
        });
      });

      it("throws on anything else", () => {
        const col = new Collection(FakeDb, "test");
        // @ts-expect-error: we're testing bad input
        expect(() => col.update(1)).toThrow("expects id to be str/obj");
        // @ts-expect-error: we're testing bad input
        expect(() => col.update(null)).toThrow("expects id to be str/obj");
      });
    });

    describe("upsert", () => {
      it("inserts on non-existing", () => {
        const col = new Collection(FakeDb, "test");
        col.update = jest.fn<typeof col.update>();
        col.insert = jest.fn<typeof col.insert>();
        col.upsert({ _id: 1 }, { type: "apple" });
        expect(col.insert).toHaveBeenCalled();
        expect(col.update).not.toHaveBeenCalled();
      });

      it("updates on existing", () => {
        const col = new Collection(FakeDb, "test");
        col._insert({ _id: "1", type: "apple" });

        col.update = jest.fn<typeof col.update>();
        col.insert = jest.fn<typeof col.insert>();
        col.upsert({ _id: "1" }, { _id: "1", type: "apple" });
        expect(col.insert).not.toHaveBeenCalled();
        expect(col.update).toHaveBeenCalled();
      });
    });

    describe("_insertOrReplaceOne", () => {
      it("throws on doc without _id", () => {
        const col = new Collection(FakeDb, "test");
        // @ts-expect-error: specifically testing for bad input
        expect(() => col._insertOrReplaceOne({ a: 1 })).toThrow("_id");
      });

      it("inserts on non-existing", () => {
        const col = new Collection(FakeDb, "test");
        col._update = jest.fn<typeof col._update>();
        col._insert = jest.fn<typeof col._insert>();
        col._insertOrReplaceOne({ _id: "id1", type: "apple" });
        expect(col._insert).toHaveBeenCalled();
        expect(col._update).not.toHaveBeenCalled();
      });

      it("updates on existing", () => {
        const col = new Collection(FakeDb, "test");
        col._insert({ _id: "id1", type: "apple" });

        col._update = jest.fn<typeof col._update>();
        col._insert = jest.fn<typeof col._insert>();
        col._insertOrReplaceOne({ _id: "id1", type: "banana" });
        expect(col._insert).not.toHaveBeenCalled();
        expect(col._update).toHaveBeenCalled();
      });
    });

    describe("_remove", () => {
      it("throws on non strId", () => {
        const col = new Collection(FakeDb, "test");
        // @ts-expect-error: we're testing bad input
        expect(() => col._remove({})).toThrow();
        // @ts-expect-error: we're testing bad input
        expect(() => col._remove(1)).toThrow();
        // @ts-expect-error: we're testing bad input
        expect(() => col._remove(null)).toThrow();
      });

      it("returns on no-match", () => {
        const col = new Collection(FakeDb, "test");
        const result = col._remove("1");
        expect(result).toBe(undefined);
      });

      it("deletes document from in-memory if found", () => {
        const col = new Collection(FakeDb, "test");
        col._insert({ _id: "1" });
        expect(col.findOne("1")).toBeTruthy();
        col._remove("1");
        expect(col.findOne("1")).toBe(null);
      });

      it("persists on matching doc", () => {
        const db = { idb: { delete: jest.fn() } } as unknown as Database;
        const col = new Collection(db, "test");
        const doc = { _id: "1" };

        col._insert(doc);
        col.shouldPersist = () => false;
        col._remove("1");
        expect(db.idb.delete).not.toBeCalled();

        col._insert(doc);
        col.shouldPersist = () => true;
        col._remove("1");
        expect(db.idb.delete).toBeCalledWith("test", "1");
      });

      it("calls sendChanges() with delete, and TODO", () => {
        const col = new Collection(FakeDb, "test");
        const doc = { _id: "1" };

        // eslint-disable-next-line @typescript-eslint/no-empty-function
        col.sendChanges = () => {};
        col._insert(doc);

        col.sendChanges = jest.fn();
        col._remove("1");

        expect((col.sendChanges as unknown as jest.Mock).mock.calls[0][0]).toBe(
          "delete"
        );
        /* TODO
        expect(col.sendChanges.mock.calls[0][1]).toBe('1');
        expect(col.sendChanges.mock.calls[0][2]).toEqual({
          fullDocument: newDoc
        });
        */
      });
    });

    describe("removeId", () => {
      it("bails on non-existing doc", () => {
        const col = new Collection(FakeDb, "test");
        const result = col.removeId("1");
        expect(result).toBe(undefined);
      });

      it("instantly removes local doc", () => {
        const col = new Collection(FakeDb, "test", { isLocalCollection: true });
        col._insert({ _id: "1" });

        col._remove = jest.fn();
        col.remove("1");
        expect(col._remove).toHaveBeenCalledWith("1");
      });

      it("instantly removes non-synced insert", () => {
        const col = new Collection(FakeDb, "test");
        col.insert({ _id: "1" });

        col._remove = jest.fn();
        col.remove("1");
        expect(col._remove).toHaveBeenCalledWith("1");
      });
    });

    describe("remove", () => {
      it("calls removeId on strId", () => {
        const col = new Collection(FakeDb, "test");
        col._insert({ _id: "1" });

        col.removeId = jest.fn();
        col.remove("1");
        expect(col.removeId).toHaveBeenCalledWith("1");
      });

      it("calls removeId on matching documents to query", () => {
        const col = new Collection(FakeDb, "test");
        col._insert({ _id: "1", type: "apple" });
        col._insert({ _id: "2", type: "apple" });
        col._insert({ _id: "3", type: "banana" });

        col.removeId = jest.fn();
        col.remove({ type: "apple" });
        expect(col.removeId).toHaveBeenCalledWith("1"); // apple
        expect(col.removeId).toHaveBeenCalledWith("2"); // apple
        expect(col.removeId).not.toHaveBeenCalledWith("3"); // banana
      });

      it("throws on anything else", () => {
        const col = new Collection(FakeDb, "test");
        // @ts-expect-error: we're testing bad input
        expect(() => col.remove()).toThrow("invalid argument");
        // @ts-expect-error: we're testing bad input
        expect(() => col.remove(true)).toThrow("invalid argument");
        // @ts-expect-error: we're testing bad input
        expect(() => col.remove(null)).toThrow("invalid argument");
      });
    });
  });
});
