import ChangeStream from "./ChangeStream";

describe("ChangeStream", () => {
  describe("close", () => {
    it("execs close", () => {
      const cs = new ChangeStream();
      const fn = jest.fn();
      cs.on("close", fn);
      cs.close();
      expect(fn.mock.calls.length).toBe(1);
    });

    it("skips if already closed, ()", () => {
      const cs = new ChangeStream();
      const fn = jest.fn();
      cs.on("close", fn);
      cs.close();
      cs.close();
      expect(fn.mock.calls.length).toBe(1);
    });
  });

  describe("isClosed", () => {
    it("returns _isClosed", () => {
      const cs = new ChangeStream();
      cs._isClosed = true;
      expect(cs.isClosed()).toBe(true);
      cs._isClosed = false;
      expect(cs.isClosed()).toBe(false);
    });
  });
});
