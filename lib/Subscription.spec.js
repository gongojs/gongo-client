const Subscription = require('./Subscription').default;

describe('Subscription', () => {

    describe('toHash', () => {

      it('hashes name and opts', () => {
        expect(Subscription.toHash('test')).toBe('["test"]');
        expect(Subscription.toHash('test', {a:1})).toBe('["test",{"a":1}]');
      });

    });

});
