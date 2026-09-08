const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const files = {
  '/': path.join(__dirname, 'fixture.html'),
  '/fixture.js': path.join(__dirname, 'fixture.js'),
  '/angular': path.join(__dirname, 'angular.html'),
  '/angular.js': path.join(__dirname, 'angular.js'),
  '/chat-tools-main.js': path.join(root, 'src/core/chat-tools-main.js'),
  '/chat-tools.js': path.join(root, 'src/features/chat-tools.js'),
  '/chat-react-main.js': path.join(root, 'src/core/chat-react-main.js'),
  '/chat-reply.js': path.join(root, 'src/features/chat-reply.js'),
  '/chat-design.css': path.join(root, 'src/features/chat-design.css')
};
http.createServer((req, res) => {
  const file = files[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'");
  res.end(fs.readFileSync(file));
}).listen(Number(process.argv[2]) || 0, '127.0.0.1', function () { console.log('http://127.0.0.1:' + this.address().port); });
