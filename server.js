const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = 8000;

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