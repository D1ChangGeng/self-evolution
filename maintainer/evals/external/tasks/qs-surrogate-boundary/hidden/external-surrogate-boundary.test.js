"use strict";

var test = require("tape");

var utils = require("../lib/utils");

var repeat = function repeat(character, count) {
  return new Array(count + 1).join(character);
};

test("encode preserves surrogate pairs across every long-string chunk", function (t) {
  var emoji = "\uD83D\uDE00";
  var encodedEmoji = "%F0%9F%98%80";
  var firstBoundary = repeat("a", 1023) + emoji;
  var laterBoundary = repeat("b", 2047) + emoji;
  var twoBoundaries = repeat("c", 1023) + emoji + repeat("d", 1022) + emoji;

  t.equal(
    utils.encode(firstBoundary),
    repeat("a", 1023) + encodedEmoji,
    "preserves a pair crossing the first chunk boundary",
  );
  t.equal(
    utils.encode(laterBoundary),
    repeat("b", 2047) + encodedEmoji,
    "preserves a pair crossing a later chunk boundary",
  );
  t.equal(
    (utils.encode(twoBoundaries).match(/%F0%9F%98%80/g) || []).length,
    2,
    "preserves multiple boundary-crossing pairs",
  );
  t.equal(
    decodeURIComponent(utils.encode(firstBoundary)),
    firstBoundary,
    "the encoded value round-trips",
  );

  var loneHighAtBoundary = repeat("e", 1023) + "\uD83DX";
  t.equal(
    utils.encode(loneHighAtBoundary),
    repeat("e", 1023) + "%F0%9F%91%98",
    "keeps the historical lone-surrogate behavior at a chunk boundary",
  );

  t.end();
});
