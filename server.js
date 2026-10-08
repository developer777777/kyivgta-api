const http = require('http');
const url = require('url');
const playerHandler = require('./api/player');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    req.query = parsed.query;

    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (data) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
    };

    if (parsed.pathname === '/' || parsed.pathname === '/api/player' || parsed.pathname === '/player') {
        playerHandler(req, res);
    } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(PORT, () => {
    console.log(`KyivGTA API Server running on port ${PORT}`);
});
