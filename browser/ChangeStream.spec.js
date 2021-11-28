const ChangeStream = require('./ChangeStream').default;

describe('ChangeStream', () => {

  describe('close', () => {

    it('execs close', () => {
      const cs = new ChangeStream();
      const fn = jest.fn();
      cs.on('close', fn);
      cs.close();
      expect(fn.mock.calls.length).toBe(1);
    });

    it('skips if already closed, ()', () => {
      const cs = new ChangeStream();
      const fn = jest.fn();
      cs.on('close', fn);
      cs.close();
      cs.close();
      expect(fn.mock.calls.length).toBe(1);
    });

  });

  describe('isClosed', () => {

    it('returns _isClosed', () => {
      const cs = new ChangeStream();
      cs._isClosed = 'xxx';
      expect(cs.isClosed()).toBe('xxx');
    });

  });

});
