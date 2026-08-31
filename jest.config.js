module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { module: 'commonjs' } }],
  },
  transformIgnorePatterns: ['/node_modules/'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: './coverage',
  testPathIgnorePatterns: ['/node_modules/', '/test/integration/'],
};
