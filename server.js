const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = 8000;
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get("/v1/ping", (req, res) => {
  res.send("ok");
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "welcome", ts: Date.now() }));

  socket.on("message", (msg) => {
    const text = msg.toString();
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(text);
      }
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on ${PORT}`);
});

app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ err_no: 40001, err_tips: "invalid json body", data: null });
  }
  if (err instanceof SyntaxError) {
    return res.status(400).json({ err_no: 40001, err_tips: "invalid body", data: null });
  }
  next(err);
});

// Live room info proxy
app.post("/api/live/info", async (req, res) => {
  try {
    const token = req.body && req.body.token;
    const xToken = req.body && req.body.xToken;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ err_no: 40001, err_tips: "invalid token", data: null });
    }
    const resp = await fetch("https://webcast.bytedance.com/api/webcastmate/info", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-token": xToken || token
      },
      body: JSON.stringify({ token })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return res.status(200).json(body);
    }
    return res.status(200).json(body);
  } catch (e) {
    return res.status(500).json({ err_no: -1, err_tips: "internal error", data: null });
  }
});