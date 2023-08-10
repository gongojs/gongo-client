import Subscription from "./Subscription";
/**
 * Scheduler.  Subscriptions have a minInterval and maxInterval option.
 * If any subscription reaches maxInterval, we call a poll, and take with us
 * all other subscriptions that have reached minInterval.
 */

export default class Scheduler {
  subscriptions: Map<string, Subscription>;
  lastRun: number;

  constructor(subscriptions: Map<string, Subscription>) {
    this.subscriptions = subscriptions;
    this.lastRun = 0;
  }

  findAndUpdate({ now = Date.now() }: { now?: number } = {}) {
    let atleastOne = false;
    for (const [_slug, sub] of this.subscriptions) {
      if (
        sub.opts &&
        sub.opts.maxInterval &&
        sub.active &&
        sub.lastCalled + sub.opts.maxInterval <= now
      ) {
        atleastOne = true;
        break;
      }
    }

    const relevantSubs: Subscription[] = [];
    if (!atleastOne) return relevantSubs;

    for (const [_slug, sub] of this.subscriptions) {
      if (
        sub.opts &&
        sub.opts.minInterval &&
        sub.active &&
        sub.lastCalled + sub.opts.minInterval <= now
      ) {
        sub.lastCalled = now;
        relevantSubs.push(sub);
      }
    }

    return relevantSubs;
  }

  findAndUpdateNames({ now = Date.now() }: { now: number }) {
    return this.findAndUpdate({ now }).map((sub) => sub.name);
  }
}
