/**
 * §F.1/7 — dead code and unreachable screens.
 *   a) every route module under apps/api/src/routes must be registered
 *   b) every non-test module under apps/web/src/features must be imported by
 *      something other than its own test
 *   c) every service module under apps/api/src/services must be imported
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tracked = execSync('git ls-files', { encoding: 'utf8' }).trim().split(/\r?\n/);
const src = (globs) => tracked.filter((f) => globs.test(f));

function corpusOf(files) {
  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

function report(title, candidates, corpusFiles, selfExclude) {
  const orphans = [];
  for (const file of candidates) {
    const base = path.basename(file).replace(/\.(tsx?|jsx?)$/, '');
    const others = corpusFiles.filter((f) => f !== file && !selfExclude(f, file));
    const corpus = corpusOf(others);
    // An import of this module names its basename in a from-specifier.
    const named = new RegExp("from\\s+['\"][^'\"]*" + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(\\.js)?['\"]");
    if (!named.test(corpus)) orphans.push(file);
  }
  console.log('### ' + title + ': ' + orphans.length + ' unreferenced of ' + candidates.length);
  orphans.forEach((o) => console.log('   ' + o));
  return orphans;
}

const allTs = src(/\.(ts|tsx)$/);

// a) API route modules
const routes = src(/^apps\/api\/src\/routes\/.*\.ts$/).filter((f) => !/\.test\.ts$/.test(f));
report('api route modules', routes, allTs, (other, self) => other === self.replace('.ts', '.test.ts'));

// b) web feature modules
const feats = src(/^apps\/web\/src\/features\/.*\.tsx?$/).filter((f) => !/\.test\.tsx?$/.test(f));
report('web feature modules', feats, allTs, (other, self) =>
  other === self.replace(/\.tsx?$/, (m) => '.test' + m),
);

// c) API service modules
const svcs = src(/^apps\/api\/src\/services\/.*\.ts$/).filter((f) => !/\.test\.ts$/.test(f));
report('api service modules', svcs, allTs, (other, self) => other === self.replace('.ts', '.test.ts'));
