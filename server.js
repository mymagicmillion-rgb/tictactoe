const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // allow from extension
        methods: ["GET", "POST"]
    }
});

// Store active rooms. Key = roomCode, Value = { host: socketId, guest: socketId, xTurn: true }
const rooms = {};

// Generate random 4-char code
function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Host creates a game
    socket.on('create_game', () => {
        let code = generateCode();
        while (rooms[code]) {
            code = generateCode(); // Ensure uniqueness
        }
        
        rooms[code] = { host: socket.id, guest: null };
        socket.join(code);
        
        console.log(`Room ${code} created by ${socket.id}`);
        socket.emit('game_created', { code });
    });

    // Guest joins a game
    socket.on('join_game', ({ code }) => {
        const roomCode = code.toUpperCase();
        const room = rooms[roomCode];

        if (!room) {
            socket.emit('error', { message: 'Комната не найдена!' });
            return;
        }

        if (room.guest) {
            socket.emit('error', { message: 'Комната уже полная!' });
            return;
        }

        room.guest = socket.id;
        socket.join(roomCode);
        
        console.log(`${socket.id} joined room ${roomCode}`);
        socket.emit('game_joined', { code: roomCode, symbol: 'O' });
        
        // Notify host that guest joined
        io.to(room.host).emit('guest_joined');
        
        // Start game
        io.to(roomCode).emit('game_start');
    });

    // Make a move
    socket.on('make_move', ({ code, boardIdx, cellIdx }) => {
        // Just broadast the move to everyone in the room except sender
        socket.to(code).emit('opponent_move', { boardIdx, cellIdx });
    });

    // Restart request
    socket.on('restart_request', ({ code }) => {
        socket.to(code).emit('restart_game');
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Find if user was in a room and clean up
        for (const [code, room] of Object.entries(rooms)) {
            if (room.host === socket.id || room.guest === socket.id) {
                io.to(code).emit('player_left');
                delete rooms[code];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
