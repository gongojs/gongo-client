import * as utils from "./utils";

if (typeof global == "object" && global.window === undefined)
  // @ts-expect-error: duh
  // eslint-disable-next-line
  global.window = {};

describe("utils", () => {
  describe("log", () => {
    it("works with one string arg", () => {
      const mockConsole = { log: jest.fn() } as unknown as typeof console;
      const log = new utils.Log("test", mockConsole);
      log.log("test");
      expect(mockConsole.log).toHaveBeenCalledWith("[test] test");
    });

    it("works with multiple args", () => {
      const mockConsole = { log: jest.fn() } as unknown as typeof console;
      const log = new utils.Log("test", mockConsole);
      log.log({ a: 1 }, "str");
      expect(mockConsole.log).toHaveBeenCalledWith("[test]", { a: 1 }, "str");
    });
  });

  describe("debounce", () => {
    it("works", () => {
      const func = jest.fn();
      const debounced = utils.debounce(func, 0);
      jest.useFakeTimers();

      debounced();
      debounced();
      debounced();

      expect(func.mock.calls.length).toBe(0);
      jest.runAllTimers();
      expect(func.mock.calls.length).toBe(1);
    });
  });

  describe("randomId", () => {
    beforeAll(() => {
      if (!window.crypto)
        window.crypto = {
          // @ts-expect-error: stub
          getRandomValues(arr: number[]) {
            for (let i = 0; i < arr.length; i++)
              arr[i] = Math.floor(Math.random() * 100000);
          },
          isFake: true,
        };
    });

    afterAll(() => {
      // @ts-expect-error: stub
      if (window.crypto.isFake) delete window.crypto;
    });

    it("returns the right length", () => {
      expect(utils.randomId(5).length).toBe(5);
    });

    it("uses a default when no length given", () => {
      const result = utils.randomId();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns seemingly random results", () => {
      expect(utils.randomId(5)).not.toBe(utils.randomId(5));
    });
  });
});
