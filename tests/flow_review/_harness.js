let passedCount = 0;
let failedCount = 0;
const failureMessages = [];

function assert(condition, message) {
  if (condition) {
    passedCount += 1;
  } else {
    failedCount += 1;
    failureMessages.push(message || '(no message)');
    console.error(`  ✗ ${message || '(no message)'}`);
  }
}

function assertEqual(actualValue, expectedValue, message) {
  const equal = JSON.stringify(actualValue) === JSON.stringify(expectedValue);
  assert(equal, `${message}\n      expected: ${JSON.stringify(expectedValue)}\n      actual:   ${JSON.stringify(actualValue)}`);
}

function describe(name, fn) {
  console.log(`\n• ${name}`);
  fn();
}

function summary(label) {
  console.log('');
  console.log(`[${label}] passed: ${passedCount}, failed: ${failedCount}`);
  if (failedCount > 0) {
    console.log('Failures:');
    failureMessages.forEach(m => console.log('  - ' + m));
    process.exit(1);
  }
}

module.exports = { assert, assertEqual, describe, summary };
