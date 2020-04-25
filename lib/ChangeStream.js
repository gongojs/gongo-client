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
    if (this._isClosed)
      return;

    this._isClosed = true;
    this.exec('close');
    delete this.callbacks;
  }

  isClosed() {
    return this._isClosed;
  }
}

module.exports = { __esModule: true, default: ChangeStream };
