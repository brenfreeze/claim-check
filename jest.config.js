/** Jest runs the engine on Node (onnxruntime-node) against the Python reference export. */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', target: 'es2022', esModuleInterop: true, strict: true, skipLibCheck: true, types: ['jest', 'node'] } }],
  },
  testTimeout: 120000,
};
