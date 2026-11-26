import { expect, test } from "@playwright/test";
import { startAgent } from "./ws-agent.js";

// The Autopilot bridge over a real WebSocket (#386). A small local server
// (ws-agent.js) stands in for the agent service. The bridge says hello, and
// `rc` reaches only the registered objects: own properties, own functions,
// and no write that the game does not export.

let agent;
test.beforeEach(async () => {
  agent = await startAgent();
});
test.afterEach(async () => {
  await agent?.close();
});

// An rc request and its response frame.
const rc = (a, verb, body) => a.request("rc", { verb, body });

async function connected(page, path) {
  await page.goto(`${path}autopilot=1&autopilot_url=${encodeURIComponent(agent.url)}`);
  const a = await agent.connection();
  const hello = await a.hello();
  expect(hello.engine).toBe("threejs");
  expect(hello.project).toBe("atl-arcade");
  expect(hello.share).toBe(false);
  a.welcome();
  await expect.poll(() => page.evaluate(() => window.__autopilot?.state)).toBe("connected");
  return a;
}

// The rc requests that must fail on every page: a banned name, an inherited
// name, and a write the game does not export.
async function expectRefused(a, objectName, fnName) {
  const refused = [
    { verb: "property", body: { objectPath: `${objectName}.${fnName}.constructor` } },
    { verb: "property", body: { objectPath: `${objectName}.${fnName}`, propertyName: "constructor" } },
    { verb: "property", body: { objectPath: objectName, propertyName: "__proto__" } },
    { verb: "property", body: { objectPath: objectName, propertyName: "hasOwnProperty" } },
    { verb: "property", body: { objectPath: "constructor" } },
    { verb: "call", body: { objectPath: objectName, functionName: "toString" } },
    { verb: "call", body: { objectPath: `${objectName}.${fnName}`, functionName: "call" } },
    { verb: "call", body: { objectPath: objectName, functionName: "constructor", parameters: { args: ["return 1"] } } },
    { verb: "property", body: { objectPath: objectName, propertyName: fnName, propertyValue: { [fnName]: 1 }, access: "WRITE_ACCESS" } },
  ];
  for (const r of refused) {
    const res = await rc(a, r.verb, r.body);
    expect(res.ok, JSON.stringify(r)).toBe(false);
    expect(res.status, JSON.stringify(r)).toBe(403);
  }
}

test("the trick input prototype: rc reaches the playtest log, and nothing past it", async ({ page }) => {
  const a = await connected(page, "/prototypes/trick-input/index.html?");

  const intend = await rc(a, "call", { objectPath: "playtest", functionName: "intend", parameters: { args: ["l"] } });
  expect(intend.ok).toBe(true);
  expect(intend.result.ReturnValue).toMatchObject({ ok: true, dir: "l" });

  const metrics = await rc(a, "call", { objectPath: "playtest", functionName: "metrics" });
  expect(metrics.ok).toBe(true);
  expect(typeof metrics.result.ReturnValue.config).toBe("string");

  const rows = await rc(a, "call", { objectPath: "playtest", functionName: "rows", parameters: { args: [0, 10] } });
  expect(rows.ok).toBe(true);
  expect(rows.result.ReturnValue).toMatchObject({ total: expect.any(Number) });

  await expectRefused(a, "playtest", "intend");
  // The write did not change the log
  const again = await rc(a, "call", { objectPath: "playtest", functionName: "intend", parameters: { args: ["r"] } });
  expect(again.result.ReturnValue).toMatchObject({ ok: true, dir: "r" });

  // Only the playtest log is registered
  const ti = await rc(a, "property", { objectPath: "__ti" });
  expect(ti.ok).toBe(false);
  expect(ti.status).toBe(404);
  await page.screenshot({ path: "e2e/.output/autopilot-agent-trick-input.png" });
});

test("the game: rc reads the registered atl object, and nothing past it", async ({ page }) => {
  const a = await connected(page, "/?level=greybox&mute=1&");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });

  const state = await rc(a, "property", { objectPath: "atl", propertyName: "skater.state" });
  expect(state.ok).toBe(true);
  expect(typeof state.result["skater.state"]).toBe("string");

  const pose = await a.request("pose", {});
  expect(pose.ok).toBe(true);
  expect(pose.result.path).toBe("/Scene/skater");

  await expectRefused(a, "atl", "resetSkater");
  // renderPaused has a setter, but the game exports no write for it
  const write = await rc(a, "property", { objectPath: "atl", propertyName: "renderPaused", propertyValue: { renderPaused: true }, access: "WRITE_ACCESS" });
  expect(write.ok).toBe(false);
  expect(write.status).toBe(403);
  expect(await page.evaluate(() => window.__atl.renderPaused)).toBe(false);

  // Every response came on this one socket
  expect(agent.agents.length).toBe(1);
  await page.screenshot({ path: "e2e/.output/autopilot-agent-game.png" });
});
