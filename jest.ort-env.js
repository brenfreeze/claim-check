// Jest runs each suite in its own VM context, so its typed-array constructors differ from the host realm that
// onnxruntime-node's native binding checks with instanceof. Share the host's so tensors cross the boundary.
const { TestEnvironment } = require('jest-environment-node');

const SHARED = ['ArrayBuffer', 'Float32Array', 'Float64Array', 'Int8Array', 'Uint8Array', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'BigInt64Array', 'BigUint64Array'];

module.exports = class OrtEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    for (const k of SHARED) this.global[k] = globalThis[k];
  }
};
