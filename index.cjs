const http = require('http');

const PORT = process.env.PORT || 3000;

console.log("SERVER STARTING...");

const server = http.createServer((req, res) => {
res.end("OK");
});

server.listen(PORT, () => {
console.log("SERVER STARTED OK on port", PORT);
});
