import Subscription from "./Subscription";
import type Database from "./Database";

describe("Subscription", () => {
  const fakeDb = {} as unknown as Database;

  describe("Class instances", () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    describe("constructor()", () => {}); /* constructor() */

    describe("toObject()", () => {
      it("includes args if they exist", () => {
        const sub = new Subscription(fakeDb, "test", { a: 1 });
        expect(sub.toObject().args).toMatchObject({ a: 1 });
      });

      it("doesn't include args if they don't exist", () => {
        const sub = new Subscription(fakeDb, "test");
        expect(sub.toObject().args).toBeUndefined();
      });

      /*
      it("includes opts if they exist", () => {
        const sub = new Subscription(
          fakeDb,
          "test",
          {},
          { minInterval: 1, maxInterval: 2 }
        );
        expect(sub.toObject().opts).toMatchObject({
          minInterval: 1,
          maxInterval: 2,
        });
      });

      it("doesn't include opts if they don't exist", () => {
        const sub = new Subscription(fakeDb, "test");
        expect(sub.toObject().opts).toBeUndefined();
      });
      */
    }); /* toObject() */

    describe("slug()", () => {
      it("returns cached result from 2nd call onwards", () => {
        const sub = new Subscription(fakeDb, "test");
        // @ts-expect-error: for test purposes
        const obj = (sub._slug = {});
        expect(sub.slug()).toBe(obj);
      });
    }); /* slug() */

    describe("stop()", () => {
      it("de-activates sub", () => {
        const sub = new Subscription(fakeDb, "test");
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
        } as unknown as Database;

        const sub = new Subscription(db, "test");
        db.subscriptions.set(sub.slug(), sub);

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
    describe("toSlug", () => {
      it("slugs name and opts", () => {
        expect(Subscription.toSlug("test")).toBe('["test"]');
        expect(Subscription.toSlug("test", { a: 1 })).toBe('["test",{"a":1}]');
      });
    });

    describe("fromSlug()", () => {
      it("creates a new sub from slug", () => {
        const sub = new Subscription(fakeDb, "test", { a: 1 });
        const slug = sub.slug();

        const newSub = Subscription.fromSlug(slug, fakeDb);
        expect(newSub.name).toBe(sub.name);
        expect(newSub.args).toEqual(sub.args);
      });
    });
  });
});
