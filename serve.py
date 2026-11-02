#!/usr/bin/env python3
"""Local static server for CircuitDeck.
The live site is static files on Vercel plus one serverless function, api/ai.js.
This reproduces Vercel's static-hosting behaviour: serve files from this folder,
'/' -> index.html, unknown paths -> the site's own 404.html with HTTP 404.
/api/ai answers like the function does with no GEMINI_API_KEY set: "not configured"
(the key never lives here; tests mock /api/ai in the browser).
Usage: python3 serve.py [port]   (default 8080)"""
import http.server, os, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'application/javascript', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2'}
    def send_error(self, code, message=None, explain=None):
        if code == 404:
            body = open(os.path.join(ROOT, '404.html'), 'rb').read()
            self.send_response(404); self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body))); self.end_headers()
            if self.command != 'HEAD': self.wfile.write(body)
        else: super().send_error(code, message, explain)
    def end_headers(self):
        self.send_header('Cache-Control', 'public, max-age=0, must-revalidate'); super().end_headers()
    def list_directory(self, path): self.send_error(404)
    def _ai(self, status, body):
        b = body.encode(); self.send_response(status); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.split('?')[0] == '/api/ai': return self._ai(200, '{"configured":false}')
        super().do_GET()
    def do_POST(self):
        if self.path.split('?')[0] == '/api/ai':
            n = int(self.headers.get('Content-Length') or 0)
            if n > 24 * 1024: return self._ai(413, '{"error":"Request too large."}')
            self.rfile.read(n); return self._ai(503, '{"configured":false,"error":"AI not configured yet."}')
        self.send_error(404)
if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f'CircuitDeck local server: http://localhost:{port}/')
    http.server.ThreadingHTTPServer(('0.0.0.0', port), H).serve_forever()
