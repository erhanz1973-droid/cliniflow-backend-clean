const http = require('http');

const PORT = process.env.PORT || 3000;

console.log("SERVER STARTING...");

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true }));
});

server.listen(PORT, () => {
  console.log("SERVER STARTED OK on port", PORT);
});
