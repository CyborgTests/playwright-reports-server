/**
 * Merge configuration used for server side reports merging. Needed to handle errors like this:
 
Network response was not ok: Error: Command failed: npx playwright merge-reports --reporter html /app/.tmp/99f690b3-aace-4293-a988-d5945eb0d259
Error: Blob reports being merged were recorded with different test directories, and
merging cannot proceed. This may happen if you are merging reports from
machines with different environments, like different operating systems or
if the tests ran with different playwright configs.

You can force merge by specifying a merge config file with "-c" option. If
you'd like all test paths to be correct, make sure 'testDir' in the merge config
file points to the actual tests location.

Found directories:
/builds/_JRRzYANI/1/doxyme/code/doxyme-core/e2e/v2/tests/doxyme
/builds/_JRRzYANI/2/doxyme/code/doxyme-core/e2e/v2/tests/doxyme
/builds/_JRRzYANI/3/doxyme/code/doxyme-core/e2e/v2/tests/doxyme
    at mergeConfigureEvents
 */
export default {
  testDir: 'rootTestsDir',
};
