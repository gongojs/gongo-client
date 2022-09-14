import Subscription from "./Subscription";
import Scheduler from "./scheduler";

describe("Scheduler", () => {
  const subs = new Map();
  subs.set(
    "a",
    // @ts-expect-error: stub
    new Subscription(null, "a", {}, { minInterval: 1000, maxInterval: 2000 })
  );
  subs.set(
    "b",
    // @ts-expect-error: stub
    new Subscription(null, "b", {}, { minInterval: 2000, maxInterval: 4000 })
  );
  subs.set(
    "c",
    // @ts-expect-error: stub
    new Subscription(null, "c", {}, { minInterval: 2500, maxInterval: 3000 })
  );

  it("runs nothing if nothing needed (no maxInterval exceeeded", () => {
    const now = 1000;
    const scheduler = new Scheduler(subs);
    const run = scheduler.findAndUpdateNames({ now });
    expect(run).toHaveLength(0);
  });

  it("works", () => {
    let now: number, run: Subscription[];
    const scheduler = new Scheduler(subs);

    now = 2000;
    run = scheduler.findAndUpdateNames({ now });
    expect(run).toEqual(["a", "b"]);

    // lastRuns: { a: 2000, b: 2000, c: 0 }
    now = 3000;
    run = scheduler.findAndUpdateNames({ now }); //?
    expect(run).toEqual(["a", "c"]);
  });
});
