import { VERIFICATION_SCOPE } from "../constants.js";

// Tiny inline Node scripts standing in for real build/test/behavior steps.
// Using `node -e` keeps these fake profiles real subprocesses (so timeout
// and output-size handling get genuine exercise) without depending on any
// actual project tooling.
const node = (script) => ({ command: "node", args: ["-e", script] });

export const FAKE_COMMAND_PROFILES = Object.freeze({
  success: {
    id: "fake-success",
    scope: VERIFICATION_SCOPE.BUILD_AND_TESTS,
    steps: {
      build: node("process.exit(0)"),
      test: node("process.exit(0)"),
      behavior: null
    }
  },

  failure: {
    id: "fake-failure",
    scope: VERIFICATION_SCOPE.BUILD_AND_TESTS,
    retainOnFailure: false,
    steps: {
      build: node("process.exit(0)"),
      test: node("process.exit(1)"),
      behavior: null
    }
  },

  retainedFailure: {
    id: "fake-retained-failure",
    scope: VERIFICATION_SCOPE.BUILD_AND_TESTS,
    retainOnFailure: true,
    steps: {
      build: node("process.exit(0)"),
      test: node("process.exit(1)"),
      behavior: null
    }
  },

  timeout: {
    id: "fake-timeout",
    scope: VERIFICATION_SCOPE.BUILD_ONLY,
    steps: {
      build: node("setTimeout(() => {}, 60000)"),
      test: null,
      behavior: null
    }
  },

  oversizedOutput: {
    id: "fake-oversized-output",
    scope: VERIFICATION_SCOPE.BUILD_ONLY,
    steps: {
      build: node("process.stdout.write('x'.repeat(50 * 1024 * 1024)); process.exit(0)"),
      test: null,
      behavior: null
    }
  },

  malformedResult: {
    id: "fake-malformed-result",
    scope: VERIFICATION_SCOPE.FULL_BEHAVIOR,
    steps: {
      build: node("process.exit(0)"),
      test: node("process.exit(0)"),
      behavior: { ...node("process.stdout.write('not-json'); process.exit(0)"), parseResult: true }
    }
  }
});
