// The loader lines of smart-whisper 0.8.1's dist/index.js, verbatim, for patch-smart-whisper tests.
var import_node_path = { default: require("path") };
var module2 = require(import_node_path.default.join(__dirname, "../build/Release/smart-whisper"));
var binding = module2;
module.exports = { binding };
