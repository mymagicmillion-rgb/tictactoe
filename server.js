const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send('UTTT Server is running. Active rooms: ' + rooms.size);
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // allow from extension
        methods: ["GET", "POST"]
    }
});

/**
 * Room state:
 * { 
 *   host: socketId, 
 *   guest: socketId, 
 *   lastWinner: 'X'|'O'|'DRAW'|null,
 *   assignments: { socketId: 'X'|'O' }
 * }
 */
const rooms = new Map();
const socketToRoom = new Map();

/**
 * Generates a random 4-character room code.
 */
function generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Randomly assigns X and O to two players.
 * @param {string} id1 - First socket ID.
 * @param {string} id2 - Second socket ID.
 * @returns {Object} Mapping of socket ID to symbol.
 */
function assignRandomSymbols(id1, id2) {
    const symbols = Math.random() < 0.5 ? ['X', 'O'] : ['O', 'X'];
    return {
        [id1]: symbols[0],
        [id2]: symbols[1]
    };
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Host creates a game
    socket.on('create_game', () => {
        try {
            let code = generateCode();
            let attempts = 0;
            while (rooms.has(code) && attempts < 100) {
                code = generateCode();
                attempts++;
            }
            
            rooms.set(code, { 
                host: socket.id, 
                guest: null, 
                lastWinner: null,
                assignments: {} 
            });
            socketToRoom.set(socket.id, code);
            socket.join(code);
            
            console.log(`Room ${code} created by ${socket.id}`);
            socket.emit('game_created', { code });
        } catch (e) {
            console.error('Error in create_game:', e);
        }
    });

    // Guest joins a game
    socket.on('join_game', ({ code }) => {
        try {
            if (!code || typeof code !== 'string') {
                socket.emit('error', { message: 'Некорректный код!' });
                return;
            }

            const roomCode = code.toUpperCase();
            const room = rooms.get(roomCode);

            if (!room) {
                socket.emit('error', { message: 'Комната не найдена!' });
                return;
            }

            if (room.guest) {
                socket.emit('error', { message: 'Комната полная!' });
                return;
            }

            room.guest = socket.id;
            socketToRoom.set(socket.id, roomCode);
            socket.join(roomCode);
            
            // Randomly assign symbols for the first game
            room.assignments = assignRandomSymbols(room.host, room.guest);

            console.log(`${socket.id} joined room ${roomCode}`);

            // Send each player their own symbol directly (avoids socket ID lookup issues)
            io.to(room.host).emit('game_start', { mySymbol: room.assignments[room.host], startingPlayer: 'X' });
            io.to(room.guest).emit('game_start', { mySymbol: room.assignments[room.guest], startingPlayer: 'X' });
        } catch (e) {
            console.error('Error in join_game:', e);
        }
    });

    // Make a move
    socket.on('make_move', ({ code, boardIdx, cellIdx }) => {
        try {
            if (!code || typeof boardIdx !== 'number' || typeof cellIdx !== 'number') return;
            socket.to(code).emit('opponent_move', { boardIdx, cellIdx });
        } catch (e) {
            console.error('Error in make_move:', e);
        }
    });

    // Notify server about game result
    socket.on('game_result', ({ code, winner }) => {
        try {
            const room = rooms.get(code);
            if (room) {
                room.lastWinner = winner; // 'X', 'O', or 'DRAW'
                console.log(`Room ${code} result: ${winner}`);
            }
        } catch (e) {}
    });

    // Restart request
    socket.on('restart_request', ({ code }) => {
        try {
            const room = rooms.get(code);
            if (!room) return;

            // Logic: Loser starts first (gets 'X')
            if (room.lastWinner && room.lastWinner !== 'DRAW') {
                // Find who was the winner symbol
                const winnerSocket = Object.keys(room.assignments).find(sid => room.assignments[sid] === room.lastWinner);
                const loserSocket = (winnerSocket === room.host) ? room.guest : room.host;
                
                // Loser gets X, Winner gets O
                room.assignments = {
                    [loserSocket]: 'X',
                    [winnerSocket]: 'O'
                };
            } else {
                // DRAW or first game restart (before result) -> Random
                room.assignments = assignRandomSymbols(room.host, room.guest);
            }

            // Send each player their own symbol directly
            io.to(room.host).emit('restart_game', { mySymbol: room.assignments[room.host], startingPlayer: 'X' });
            io.to(room.guest).emit('restart_game', { mySymbol: room.assignments[room.guest], startingPlayer: 'X' });
        } catch (e) {
            console.error('Error in restart_request:', e);
        }
    });

    socket.on('disconnect', () => {
        const code = socketToRoom.get(socket.id);
        if (code) {
            io.to(code).emit('player_left');
            rooms.delete(code);
            socketToRoom.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
