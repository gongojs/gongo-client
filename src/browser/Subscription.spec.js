const Subscription = require("./Subscription").default;

describe("Subscription", () => {
  describe("Class instances", () => {
    describe("constructor()", () => {}); /* constructor() */

    describe("toObject()", () => {
      it("includes opts if they exist", () => {
        const sub = new Subscription(null, null, { a: 1 });
        expect(sub.toObject().opts).toMatchObject({ a: 1 });
      });

      it("doesn't include opts if they don't exist", () => {
        const sub = new Subscription(null, null);
        expect(sub.toObject().opts).toBeUndefined();
      });
    }); /* toObject() */

    describe("hash()", () => {
      it("returns cached result from 2nd call onwards", () => {
        const sub = new Subscription(null, "test");
        const obj = (sub._hash = {});
        expect(sub.hash()).toBe(obj);
      });
    }); /* hash() */

    describe("stop()", () => {
      it("de-activates sub", () => {
        const sub = new Subscription();
        sub.stop();
        expect(sub.active).toBe(false);
      });
    }); /* stop() */

    describe("delete()", () => {
      it("deletes sub from db and syncs subs to store", () => {
        const db = {
          subscriptions: new Map(),
          gongoStore: { _insertOrReplaceOne: jest.fn() },
          getSubscriptions: jest.fn().mockReturnValueOnce("getsubs"),
        };

        const sub = new Subscription(db, "test");
        db.subscriptions.set(sub.hash(), sub);

        sub.delete();
        expect(db.getSubscriptions).toHaveBeenCalled();
        expect(db.gongoStore._insertOrReplaceOne).toHaveBeenCalledWith({
          _id: "subscriptions",
          subscriptions: "getsubs",
        });
      });
    }); /* delete() */
  });

  describe("Static Functions", () => {
    describe("toHash", () => {
      it("hashes name and opts", () => {
        expect(Subscription.toHash("test")).toBe('["test"]');
        expect(Subscription.toHash("test", { a: 1 })).toBe('["test",{"a":1}]');
      });
    });

    describe("fromHash()", () => {
      it("creates a new sub from hash", () => {
        const sub = new Subscription(null, "test", { a: 1 });
        const hash = sub.hash();

        const newSub = Subscription.fromHash(hash);
        expect(newSub.name).toBe(sub.name);
        expect(newSub.opts).toEqual(sub.opts);
      });
    });
  });
});
