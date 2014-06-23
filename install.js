var os = require('os');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var exec = require('child_process').exec;
var Q = require('q');
var request = require('request');
var tar = require('tar');
var which = require('which');
var rimraf = require('rimraf');

var nwver = require('./package.json').nwVersion;

// This will take in an object and find any matching keys in the environment
// to use as overrides.
//
// ENV variables:
//
// PKG: Location of `package.json` sans `.json`.
// LIBGIT2: Location of libgit2 source. 
// BUILD: Location of nodegit build directory.
function envOverride(obj) {
  // Look through all keys.
  return Object.keys(obj).reduce(function(obj, key) {
    var normalize = key.toUpperCase();

    // Check for process environment existence.
    if (normalize in process.env) {
      obj[key] = process.env[normalize];
    }

    return obj;
  }, obj);
}

// Convert to the correct system path.
function systemPath(parts) {
  return parts.join(path.sep);
}

// Will be used near the end to configure `node-gyp`.
var python;

// Common reusable paths that can be overwritten by environment variables.
var paths = envOverride({
  pkg: __dirname + '/package',
  libgit2: __dirname + '/vendor/libgit2/',
  build: __dirname + '/vendor/libgit2/build/',
  release: __dirname + '/build/Release'
});

// Load the package.json.
var pkg = require(paths.pkg);

// Ensure all dependencies are available.
var dependencies = Q.allSettled([
  // This will prioritize `python2` over `python`, because we always want to
  // work with Python 2.* if it's available.
  Q.nfcall(which, 'python2'),
  Q.nfcall(which, 'python')
])

// Determine if all the dependency requirements are met.
.then(function(results) {
  console.info('[nodegit] Determining dependencies.');

  // Assign to reusable variables.
  python = results[0].value || results[1].value;
  
  // Now lets check the Python version to ensure it's < 3.
  return Q.nfcall(exec, python + ' --version').then(function(version) {
    if (version[1].indexOf('Python 3') === 0) {
      throw new Error('Incorrect version of Python, gyp requires < 3.');
    }
  });
})

// Successfully found all dependencies.  First step is to detect the vendor
// directory.
.then(function() {
  console.info('[nodegit] Detecting vendor/libgit2.');

  return Q.ninvoke(fs, 'stat', paths.libgit2).then(function() {
    return Q.ninvoke(fs, 'stat', paths.libgit2 + pkg.libgit2.sha);
  }).fail(function() {
    console.info('[nodegit] Removing outdated vendor/libgit2.');

    // This directory is outdated, remove. 
    throw Q.ninvoke(rimraf, null, paths.libgit2);
  });
})

// If the directory already exists, no need to refetch.
.fail(function() {
  // Otherwise fetch the libgit2 source from GitHub.
  console.info('[nodegit] Fetching vendor/libgit2.');

  var url = 'https://github.com/libgit2/libgit2/tarball/' + pkg.libgit2.sha;
  
  var extract = tar.Extract({
    path: paths.libgit2,
    strip: true
  });

  // First extract from Zlib and then extract from Tar.
  var expand = request.get(url).pipe(zlib.createUnzip()).pipe(extract);

  return Q.ninvoke(expand, 'on', 'end').then(function() {
    // Write out a sha file for testing in the future.
    return Q.ninvoke(fs, 'writeFile', paths.libgit2 + pkg.libgit2.sha, '');
  });
})

// Configure the native module using node-gyp.
.then(function() {
  console.info('[nodegit] Configuring native node module.');

  return Q.nfcall(exec, systemPath([
    '.', 'node_modules', '.bin', 'nw-gyp configure --target=' + nwver
  ]), {
    cwd: '.'
  });
})

// Build the native module using node-gyp.
.then(function() {
  console.info('[nodegit] Building native node module.');

  return Q.nfcall(exec, systemPath([
    '.', 'node_modules', '.bin', 'nw-gyp build'
  ]), {
    cwd: '.',
    maxBuffer: Number.MAX_VALUE
  });
})

// Attempt to fallback on a prebuilt binary.
.fail(function(message) {
  console.info('[nodegit] Failed to build nodegit.');
  console.info('[nodegit] Attempting to fallback on a prebuilt binary.');

  console.log(message.stack);

  function fetchPrebuilt() {
    console.info('[nodegit] Fetching binary from S3.');

    // Using the node-pre-gyp module, attempt to fetch a compatible build.
    return Q.nfcall(exec, 'node-pre-gyp install');
  }

  // Attempt to fetch prebuilt binary.
  return Q.ninvoke(fs, 'mkdir', paths.release)
    .then(fetchPrebuilt, fetchPrebuilt);
})

// Display a warning message about failing to build native node module.
.fail(function(message) {
  console.info('[nodegit] Failed to build and install nodegit.');
  console.info(message.message);
  console.info(message.stack);
})

// Display a success message.
.then(function() {
  console.info('[nodegit] Completed installation successfully.');
})

// Display a warning message about failing to build native node module.
.fail(function(message) {
  console.info('[nodegit] Failed to build nodegit.');
  console.info(message.message);
  console.info(message.stack);
});
