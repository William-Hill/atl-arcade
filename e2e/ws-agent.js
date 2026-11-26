// A small stand-in for the Autopilot agent service (#386): a WebSocket server
// on 127.0.0.1 with node:http only (no new dependency). It reads the bridge's
// frames, sends welcome and requests, and waits for the answers.
//
// It reads only what the bridge sends: unfragmented text frames, masked by
// the client, and a close frame.

import { createHash } from "node:crypto";
import { createServer } from "node:http";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encode(text) {
  const data = Buffer.from(text);
  let head;
  if (data.length < 126) head = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(data.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([head, data]);
}

// The frames in buf: {texts, rest, closed}.
function decode(buf) {
  const texts = [];
  let closed = false;
  let at = 0;
  while (buf.length - at >= 2) {
    const op = buf[at] & 0x0f;
    let len = buf[at + 1] & 0x7f;
    const masked = (buf[at + 1] & 0x80) !== 0;
    let p = at + 2;
    if (len === 126) {
      if (buf.length < p + 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length < p + 8) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    const maskAt = p;
    if (masked) p += 4;
    if (buf.length < p + len) break;
    const data = Buffer.from(buf.subarray(p, p + len));
    if (masked) for (let i = 0; i < len; i += 1) data[i] ^= buf[maskAt + (i % 4)];
    if (op === 1) texts.push(data.toString("utf8"));
    if (op === 8) closed = true;
    at = p + len;
  }
  return { texts, rest: buf.subarray(at), closed };
}

// Starts the server on a free port. Each bridge connection is an agent:
// agent.frames (every frame it sent), agent.hello(), agent.welcome(),
// agent.request(op, args) -> the response frame.
export async function startAgent() {
  const agents = [];
  const waiters = [];
  const server = createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "", ""].join("\r\n"));
    const agent = makeAgent(socket, req.url);
    agents.push(agent);
    for (const w of waiters.splice(0)) w(agent);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    url: `ws://127.0.0.1:${port}/v1/bridge`,
    agents,
    // The next (or the first waiting) connection.
    connection(timeout = 20000) {
      if (agents.length) return Promise.resolve(agents[0]);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no bridge connected")), timeout);
        waiters.push((a) => {
          clearTimeout(t);
          resolve(a);
        });
      });
    },
    close: () => {
      for (const a of agents) a.socket.destroy();
      return new Promise((r) => server.close(r));
    },
  };
}

function makeAgent(socket, path) {
  const frames = [];
  const listeners = [];
  let buf = Buffer.alloc(0);
  let nextId = 1;
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { texts, rest, closed } = decode(buf);
    buf = rest;
    for (const t of texts) {
      const f = JSON.parse(t);
      frames.push(f);
      for (const l of [...listeners]) l(f);
    }
    if (closed) socket.end();
  });
  socket.on("error", () => {});
  const send = (obj) => socket.write(encode(JSON.stringify(obj)));
  // The first frame that matches, from the frames so far or the next ones.
  const waitFor = (match, timeout = 20000) => {
    const had = frames.find(match);
    if (had) return Promise.resolve(had);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no such frame from the bridge")), timeout);
      const l = (f) => {
        if (!match(f)) return;
        clearTimeout(t);
        listeners.splice(listeners.indexOf(l), 1);
        resolve(f);
      };
      listeners.push(l);
    });
  };
  return {
    socket,
    path,
    frames,
    hello: () => waitFor((f) => f.type === "hello"),
    welcome: () => send({ type: "welcome", session: "e2e-386" }),
    request(op, args = {}) {
      const id = nextId;
      nextId += 1;
      send({ type: "request", id, op, args });
      return waitFor((f) => f.type === "response" && f.id === id);
    },
  };
}
