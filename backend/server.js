// server/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Game = require('./models/Game');

// --- DB & Express Setup ---
const app = express();
app.use(cors());
app.use(express.json());

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected successfully.'))
  .catch((err) => console.error('☠️MongoDB Connection Error:', err));

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// --- HTTP & Socket.io Server Setup ---
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

// --- Game State ---
const games = {}; // In-memory store for *live* games
let matchingQueue = [];

const ROUND_TIME = 8000;
const POINTS_TO_WIN = 2;
const POST_ROUND_COOLDOWN = 3000; // time to show results before next round

// --- Helper Functions ---
function getGameResult(move1, move2) {
  if (move1 === move2) return 'draw';
  if (
    (move1 === 'rock' && move2 === 'scissors') ||
    (move1 === 'scissors' && move2 === 'paper') ||
    (move1 === 'paper' && move2 === 'rock')
  ) {
    return 'player1';
  }
  return 'player2';
}

// --- Game Logic Functions ---
async function startRound(roomId) {
  const game = games[roomId];
  if (!game) return;

  game.round++;
  game.moves = [null, null];
  io.to(roomId).emit('new-round', { round: game.round });

  game.timer = setTimeout(() => {
    endRound(roomId);
  }, ROUND_TIME);
}

async function endRound(roomId) {
  const game = games[roomId];
  if (!game) return;

  clearTimeout(game.timer);

  const [move1, move2] = game.moves;
  const p1_id = game.players[0].id;
  const p2_id = game.players[1].id;
  let roundWinner = null;
  let roundWinnerId = null;

  if (!move1 && !move2) {
    roundWinner = 'draw';
  } else if (!move1) {
    roundWinner = 'player2';
    roundWinnerId = p2_id;
    game.scores[1]++;
  } else if (!move2) {
    roundWinner = 'player1';
    roundWinnerId = p1_id;
    game.scores[0]++;
  } else {
    const result = getGameResult(move1, move2);
    if (result === 'player1') {
      roundWinner = 'player1';
      roundWinnerId = p1_id;
      game.scores[0]++;
    } else if (result === 'player2') {
      roundWinner = 'player2';
      roundWinnerId = p2_id;
      game.scores[1]++;
    } else {
      roundWinner = 'draw';
    }
  }

  // Save round data to DB
  const roundData = {
    roundNumber: game.round,
    moves: [
      { user: p1_id, move: move1 },
      { user: p2_id, move: move2 },
    ],
    winner: roundWinnerId,
  };

  try {
    await Game.findByIdAndUpdate(game.dbGameId, { $push: { rounds: roundData } });
  } catch (err) {
    console.error('Error saving round data:', err);
  }

  // Send round result to clients
  io.to(roomId).emit('round-result', {
    winner: roundWinner,
    moves: game.moves,
    scores: game.scores,
    cooldownMs: POST_ROUND_COOLDOWN,
  });

  // Check for game over
  if (game.scores[0] === POINTS_TO_WIN || game.scores[1] === POINTS_TO_WIN) {
    const gameWinnerId =
      game.scores[0] === POINTS_TO_WIN ? game.players[0].id : game.players[1].id;

    try {
      await Game.findByIdAndUpdate(game.dbGameId, {
        $set: { status: 'completed', winner: gameWinnerId },
      });
    } catch (err) {
      console.error('Error saving game winner:', err);
    }

    io.to(roomId).emit('game-over', { winner: gameWinnerId });
    delete games[roomId];
  } else {
    // Delay the next round so players can see the result and opponent's move
    setTimeout(() => {
      // Ensure game still exists (not deleted due to disconnect) before starting next round
      if (games[roomId]) {
        startRound(roomId);
      }
    }, POST_ROUND_COOLDOWN);
  }
}

// --- Socket.io Auth Middleware ---
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error: No token provided.'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return next(new Error('Authentication error: User not found.'));
    }
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token.'));
  }
});

// --- Socket.io Connection Logic ---
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.user.username} (${socket.id})`);

  // 1. Create Private Room
  socket.on('create-room', () => {
    const roomId = uuidv4();
    games[roomId] = {
      players: [
        {
          id: socket.user._id.toString(),
          username: socket.user.username,
          socketId: socket.id,
        },
      ],
      scores: [0, 0],
      round: 0,
      moves: [null, null],
      timer: null,
      dbGameId: null,
    };
    socket.join(roomId);
    socket.emit('room-created', { roomId });
    console.log(`Room created: ${roomId} by ${socket.user.username}`);
  });

  // 2. Join Private Room
  socket.on('join-room', async ({ roomId }) => {
    const game = games[roomId];

    if (!game) {
      socket.emit('error', { message: 'Room not found.' });
      return;
    }

    if (game.players.length >= 2) {
      socket.emit('error', { message: 'Room is full.' });
      return;
    }

    // Check if user is already in the game
    const alreadyInGame = game.players.some(p => p.id === socket.user._id.toString());
    if (alreadyInGame) {
      console.log(`${socket.user.username} already in game ${roomId}, just joining socket room`);
      socket.join(roomId);
      
      // Send current game state
      const clientPlayers = game.players.map((p) => ({
        id: p.id,
        username: p.username,
      }));
      socket.emit('game-start', { players: clientPlayers });
      
      // If game is in progress, send current round
      if (game.round > 0) {
        socket.emit('new-round', { round: game.round });
      }
      return;
    }

    // Add 2nd player
    game.players.push({
      id: socket.user._id.toString(),
      username: socket.user.username,
      socketId: socket.id,
    });
    socket.join(roomId);

    console.log(`${socket.user.username} joined room ${roomId}`);

    // Create game in DB
    try {
      const newGame = new Game({
        players: [game.players[0].id, game.players[1].id],
        status: 'active',
      });
      await newGame.save();
      game.dbGameId = newGame._id;

      const clientPlayers = game.players.map((p) => ({
        id: p.id,
        username: p.username,
      }));
      
      io.to(roomId).emit('game-start', { players: clientPlayers });
      startRound(roomId);
    } catch (err) {
      console.error('Error creating game:', err);
      socket.emit('error', { message: 'Could not create game.' });
    }
  });

  // 3. Find Random Match - FIXED VERSION
  socket.on('find-random-match', async () => {
    // Check if already in queue
    const alreadyInQueue = matchingQueue.some(s => s.id === socket.id);
    if (alreadyInQueue) {
      console.log(`${socket.user.username} already in queue`);
      return;
    }

    matchingQueue.push(socket);
    console.log(`${socket.user.username} joined matchmaking queue. Queue size: ${matchingQueue.length}`);

    if (matchingQueue.length >= 2) {
      const p1Socket = matchingQueue.shift();
      const p2Socket = matchingQueue.shift();
      const roomId = uuidv4();

      console.log(`Matching ${p1Socket.user.username} vs ${p2Socket.user.username} in room ${roomId}`);

      try {
        const newGame = new Game({
          players: [p1Socket.user._id, p2Socket.user._id],
          status: 'active',
        });
        await newGame.save();

        // Create in-memory game
        games[roomId] = {
          dbGameId: newGame._id,
          players: [
            {
              id: p1Socket.user._id.toString(),
              username: p1Socket.user.username,
              socketId: p1Socket.id,
            },
            {
              id: p2Socket.user._id.toString(),
              username: p2Socket.user.username,
              socketId: p2Socket.id,
            },
          ],
          scores: [0, 0],
          round: 0,
          moves: [null, null],
          timer: null,
        };

        // Join both players to the room
        p1Socket.join(roomId);
        p2Socket.join(roomId);

        const clientPlayers = games[roomId].players.map((p) => ({
          id: p.id,
          username: p.username,
        }));

        // CRITICAL FIX: Emit to each socket individually with roomId
        // This ensures they receive it before navigating
        p1Socket.emit('match-found', { roomId, players: clientPlayers });
        p2Socket.emit('match-found', { roomId, players: clientPlayers });
        
        console.log(`Match found, sent to both players for room ${roomId}`);
        
        // Start the game after a small delay to ensure clients have navigated
        setTimeout(() => {
          console.log(`Starting game in room ${roomId}`);
          io.to(roomId).emit('game-start', { players: clientPlayers });
          startRound(roomId);
        }, 1000);
        
      } catch (err) {
        console.error('Error creating game:', err);
        p1Socket.emit('error', { message: 'Could not create game.' });
        p2Socket.emit('error', { message: 'Could not create game.' });
      }
    } else {
      socket.emit('waiting-for-match');
    }
  });

  // 4. Handle Player Move
  socket.on('make-move', ({ roomId, move }) => {
    const game = games[roomId];
    if (!game) {
      console.log(`Move attempted in non-existent room: ${roomId}`);
      return;
    }

    const playerIndex = game.players.findIndex((p) => p.socketId === socket.id);
    if (playerIndex === -1) {
      console.log(`Player ${socket.user.username} not found in room ${roomId}`);
      return;
    }

    if (game.moves[playerIndex] !== null) {
      console.log(`Player ${socket.user.username} already made a move`);
      return;
    }

    game.moves[playerIndex] = move;
    console.log(`${socket.user.username} made move: ${move} in room ${roomId}`);
    socket.emit('move-confirmed');

    if (game.moves[0] && game.moves[1]) {
      endRound(roomId);
    }
  });

  // 5. Handle Disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.user.username} (${socket.id})`);
    
    matchingQueue = matchingQueue.filter((s) => s.id !== socket.id);

    for (const roomId in games) {
      const game = games[roomId];
      const playerIndex = game.players.findIndex((p) => p.socketId === socket.id);

      if (playerIndex !== -1) {
        console.log(`Player ${socket.user.username} left game ${roomId}`);
        
        const otherPlayerIndex = playerIndex === 0 ? 1 : 0;
        const otherPlayer = game.players[otherPlayerIndex];
        
        if (otherPlayer) {
          const winnerId = otherPlayer.id;
          try {
            if (game.dbGameId) {
              Game.findByIdAndUpdate(game.dbGameId, {
                $set: { status: 'completed', winner: winnerId },
              }).exec();
            }
          } catch (err) {
            console.error('Error handling disconnect:', err);
          }
          
          io.to(roomId).emit('opponent-left');
        }
        delete games[roomId];
        break;
      }
    }
  });
});

// --- Start Server ---
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🎉Server running on port ${PORT}`));