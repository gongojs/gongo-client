const utils = require('./utils');

describe('utils', () => {

  describe('log', () => {

    it('works with one string arg', () => {
      const mockConsole = { log: jest.fn() };
      const log = new utils.Log('test', mockConsole);
      log.log('test');
      expect(mockConsole.log).toHaveBeenCalledWith('[test] test')
    });

    it('works with multiple args', () => {
      const mockConsole = { log: jest.fn() };
      const log = new utils.Log('test', mockConsole);
      log.log({ a: 1 }, 'str');
      expect(mockConsole.log).toHaveBeenCalledWith('[test]', {a:1}, 'str');
    });

  });

  describe('debounce', () => {

    it('works', () => {

      const func = jest.fn();
      const debounced = utils.debounce(func);
      jest.useFakeTimers();

      debounced();
      debounced();
      debounced();

      expect(func.mock.calls.length).toBe(0);
      jest.runAllTimers();
      expect(func.mock.calls.length).toBe(1);
    });

  });

});
