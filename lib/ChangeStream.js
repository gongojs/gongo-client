class ChangeStream {

  constructor() {
    this.callbacks = { change: [], populateStart: [], populateEnd: [], close: [] };
  }

  on(event, callback) {
    this.callbacks[event].push(callback);
  }

  exec(type, obj) {
    this.callbacks[type].forEach(callback => callback(obj));
  }

  close() {
    this.exec('close');
  }
}

module.exports = { __esModule: true, default: ChangeStream };
