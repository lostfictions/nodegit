var promisify = require('promisify-node');
var descriptors = require('./build/codegen/v0.18.0.json');
var rawApi;

// Attempt to load the production release first, if it fails fall back to the
// debug release.
try {
  rawApi = require('./build/Release/nodegit');
} catch (e) {
  rawApi = require('./build/Debug/nodegit');
}

// Set the exports prototype to the raw API.
exports.__proto__ = rawApi;

// Import extensions.
require('./lib/commit.js');
require('./lib/blob.js');
require('./lib/object.js');
require('./lib/signature.js');
require('./lib/odb.js');
require('./lib/oid.js');
require('./lib/index.js');
require('./lib/repo.js');
require('./lib/reference.js');
require('./lib/revwalk.js');
require('./lib/tree.js');
require('./lib/diff_list.js');
require('./lib/tree_entry.js');
require('./lib/tree_builder.js');

// Wrap asynchronous methods to return promises.
promisify(exports);

// Native methods do not return an identifiable function, so this function will
// filter down the function identity to match the libgit2 descriptor.
promisify(rawApi, function(func, keyName, parentKeyName) {
  // Find the correct descriptor.
  var descriptor = descriptors.filter(function(descriptor) {
    var key = parentKeyName ? parentKeyName.slice(0, -1) : keyName; 
    return descriptor.jsClassName === key;
  })[0];

  // If this is a top level construct, recurse into.
  if (!parentKeyName) {
    return true;
  }

  // Determine if this is a prototype method.
  var isPrototypeMethod = parentKeyName.slice(-1) === "#";

  if (descriptor && descriptor.functions) {
    // Find the nested function in the descriptor.
    var nestedFunction = descriptor.functions.filter(function(nestedFunction) {
      if (nestedFunction.jsFunctionName === func.name) {
        return func.isPrototypeMethod === isPrototypeMethod;
      }
    })[0];

    // Verify it is an asynchronous method.
    //console.log(func && func.isAsync);
    return !!(nestedFunction && nestedFunction.isAsync);
  }
});

// Set version.
exports.version = require('./package').version;

// Initialize threads.
exports.Threads.init();
