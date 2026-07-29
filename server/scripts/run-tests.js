const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const serverRoot = path.resolve(__dirname, "..");
const testsRoot = path.join(serverRoot, "tests");
const jestBin = path.join(serverRoot, "node_modules", "jest", "bin", "jest.js");
const batchSize = 6;

function collectTests(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTests(entryPath);
      return entry.isFile() && entry.name.endsWith(".test.js") ? [entryPath] : [];
    });
}

const tests = collectTests(testsRoot).sort((left, right) => left.localeCompare(right));
const passthrough = process.argv
  .slice(2)
  .filter((argument) => argument !== "--runInBand" && argument !== "--forceExit");

if (tests.length === 0) {
  console.error("No Jest test files were found.");
  process.exit(1);
}

const batchCount = Math.ceil(tests.length / batchSize);

for (let offset = 0; offset < tests.length; offset += batchSize) {
  const batch = tests.slice(offset, offset + batchSize);
  const batchNumber = offset / batchSize + 1;
  console.log(`\nRunning Jest batch ${batchNumber}/${batchCount} (${batch.length} suites)`);

  const result = spawnSync(
    process.execPath,
    [jestBin, "--runTestsByPath", ...batch, "--runInBand", "--forceExit", ...passthrough],
    { cwd: serverRoot, env: process.env, stdio: "inherit" },
  );

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`\nAll ${tests.length} Jest suites passed in ${batchCount} bounded batches.`);
