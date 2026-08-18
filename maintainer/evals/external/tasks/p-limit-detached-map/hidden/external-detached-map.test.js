import { setTimeout as delay } from "node:timers/promises";
import test from "ava";
import pLimit from "../index.js";

test("a detached map call shares its limiter with direct calls", async (t) => {
  const limit = pLimit(1);
  const { map } = limit;
  let running = 0;
  let maximumRunning = 0;

  const mapper = async (value, index) => {
    running++;
    maximumRunning = Math.max(maximumRunning, running);
    await delay(10);
    running--;
    return `${index}:${value * 2}`;
  };

  const directResult = limit(async (value) => {
    running++;
    maximumRunning = Math.max(maximumRunning, running);
    await delay(10);
    running--;
    return value;
  }, "direct");
  const mappedResult = map(new Set([2, 3]), mapper);

  t.deepEqual(await Promise.all([directResult, mappedResult]), [
    "direct",
    ["0:4", "1:6"],
  ]);
  t.is(maximumRunning, 1);
});
