const mysql = require('mysql2/promise');
const pickupHandler = require('./pickup');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const query = req.query || {};
    const body = req.body || {};
    const action = query.action || body.action;

    // Support action=pickup
    if (action === 'pickup') {
        return pickupHandler(req, res);
    }

    let conn;
    try {
        conn = await mysql.createConnection({
            host: '51.210.223.180',
            port: 3306,
            user: 'gs112661',
            password: 'OJifVDbDq5LJbMBLD4Xuxpx',
            database: 'gs112661',
            connectTimeout: 8000
        });

        // 1. ACTION: LOGIN (Strict credentials check with 2FA)
        if (action === 'login') {
            const loginInput = (query.login || query.email || body.login || body.email || '').trim();
            const passInput = (query.password || body.password || '').trim();
            const clientIp = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1').split(',')[0].trim();

            if (!loginInput || !passInput) {
                await conn.end();
                return res.status(400).json({ error: 'Введіть логін та пароль' });
            }

            const [rows] = await conn.execute(
                `SELECT id, nickname, login, email, password, level, exp, money, donate, skin, telegram_id, telegram_2fa_enabled 
                 FROM ugta_players 
                 WHERE LOWER(login) = LOWER(?) OR LOWER(email) = LOWER(?) OR LOWER(nickname) = LOWER(?) 
                 LIMIT 1`,
                [loginInput, loginInput, loginInput]
            );

            if (!rows.length) {
                await conn.end();
                return res.status(401).json({ error: 'Користувача з таким логіном або e-mail не знайдено' });
            }

            const p = rows[0];
            if (String(p.password).trim() !== passInput) {
                await conn.end();
                return res.status(401).json({ error: 'Невірний пароль' });
            }

            // Перевіряємо, чи увімкнено 2FA
            const is2FA = p.telegram_2fa_enabled == 1 && p.telegram_id;
            if (is2FA) {
                const crypto = require('crypto');
                const token = crypto.randomBytes(16).toString('hex');
                const now = Math.floor(Date.now() / 1000);
                const expires = now + 180; // 3 хвилини

                await conn.execute(
                    `INSERT INTO ugta_player_telegram2fa_requests 
                     (token, player_id, nickname, mode, reward, status, telegram_id, ip, created_at, expires_at, processed) 
                     VALUES (?, ?, ?, 'cabinet_login', 0, 'pending', ?, ?, ?, ?, 0)`,
                    [token, p.id, p.nickname, String(p.telegram_id), clientIp, now, expires]
                );

                await conn.end();

                return res.status(200).json({
                    result: 'requires_2fa',
                    token: token,
                    ip: clientIp,
                    nickname: p.nickname
                });
            }

            await conn.end();

            p.bank = Math.floor((p.money || 0) * 0.35);
            delete p.password;
            delete p.telegram_id;

            return res.status(200).json({
                result: 'success',
                player: p
            });
        }

        // ACTION: CHECK 2FA STATUS
        if (action === 'check_2fa') {
            const token = (query.token || body.token || '').trim();
            if (!token) {
                await conn.end();
                return res.status(400).json({ error: 'No token' });
            }

            const [reqRows] = await conn.execute(
                `SELECT * FROM ugta_player_telegram2fa_requests WHERE token = ? LIMIT 1`,
                [token]
            );

            if (!reqRows.length) {
                await conn.end();
                return res.status(404).json({ status: 'not_found' });
            }

            const reqData = reqRows[0];
            if (reqData.status === 'approved') {
                const [pRows] = await conn.execute(
                    `SELECT id, nickname, login, email, level, exp, money, donate, skin FROM ugta_players WHERE id = ? LIMIT 1`,
                    [reqData.player_id]
                );
                await conn.end();

                if (pRows.length) {
                    const p = pRows[0];
                    p.bank = Math.floor((p.money || 0) * 0.35);
                    return res.status(200).json({ status: 'approved', player: p });
                }
            } else if (reqData.status === 'rejected') {
                await conn.end();
                return res.status(200).json({ status: 'rejected' });
            } else if (reqData.status === 'expired' || Math.floor(Date.now() / 1000) > reqData.expires_at) {
                await conn.end();
                return res.status(200).json({ status: 'expired' });
            }

            await conn.end();
            return res.status(200).json({ status: 'pending' });
        }

        const { id, nickname } = query;

        if (id) {
            const [rows] = await conn.execute(
                'SELECT id, nickname, login, money, donate, level, skin FROM ugta_players WHERE id = ? LIMIT 1',
                [parseInt(id)]
            );
            await conn.end();
            if (!rows.length) return res.status(404).json({ error: 'Player not found' });
            const p = rows[0];
            p.bank = Math.floor((p.money || 0) * 0.35);
            return res.status(200).json(p);
        } else if (nickname) {
            const [rows] = await conn.execute(
                'SELECT id, nickname, login, money, donate, level, skin FROM ugta_players WHERE nickname = ? OR login = ? LIMIT 1',
                [nickname, nickname]
            );
            await conn.end();
            if (!rows.length) return res.status(404).json({ error: 'Player not found' });
            const p = rows[0];
            p.bank = Math.floor((p.money || 0) * 0.35);
            return res.status(200).json(p);
        } else {
            // Return all players
            const [rows] = await conn.execute(
                'SELECT id, nickname, login, money, donate, level, skin FROM ugta_players ORDER BY money DESC'
            );
            await conn.end();
            const players = rows.map(p => {
                p.bank = Math.floor((p.money || 0) * 0.35);
                return p;
            });
            return res.status(200).json(players);
        }
    } catch (e) {
        if (conn) { try { await conn.end(); } catch(_) {} }
        return res.status(500).json({ error: e.message });
    }
};
