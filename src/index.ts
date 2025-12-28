// server/index.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

// Reutilize as interfaces do seu front aqui ou crie um arquivo compartilhado
interface GameState {
  horizontalLines: boolean[][];
  verticalLines: boolean[][];
  squares: (string | null)[][]; // 'A' ou 'B'
  currentPlayer: 'A' | 'B';
  scores: { A: number; B: number };
  movesLeft: number;
  diceValue: number | null;
  waitingForRoll: boolean;
  winner: string | null;
}

interface Room {
  id: string;
  players: {
    socketId: string;
    playerType: 'A' | 'B';
    name: string;
  }[];
  boardSize: number;
  gameState: GameState;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // No produção, coloque a URL do seu front (ex: localhost:5173)
    methods: ["GET", "POST"]
  }
});

const rooms: Record<string, Room> = {};

// Função auxiliar para estado inicial (igual ao seu front)
const initializeGame = (size: number): GameState => ({
    horizontalLines: Array(size + 1).fill(null).map(() => Array(size).fill(false)),
    verticalLines: Array(size).fill(null).map(() => Array(size + 1).fill(false)),
    squares: Array(size).fill(null).map(() => Array(size).fill(null)),
    currentPlayer: 'A',
    scores: { A: 0, B: 0 },
    movesLeft: 0,
    diceValue: null,
    waitingForRoll: true,
    winner: null
});

io.on('connection', (socket) => {
  console.log('Usuário conectado:', socket.id);

  // 1. Criar Sala
  socket.on('create_room', ({ name, boardSize }) => {
    const roomId = uuidv4().slice(0, 5).toUpperCase(); // Gera ID curto ex: "A1B2"
    
    rooms[roomId] = {
      id: roomId,
      boardSize,
      players: [{ socketId: socket.id, playerType: 'A', name }],
      gameState: initializeGame(boardSize)
    };

    socket.join(roomId);
    socket.emit('room_created', { roomId, playerType: 'A' });
    console.log(`Sala ${roomId} criada por ${name}`);
  });

  // 2. Entrar na Sala
  socket.on('join_room', ({ roomId, name }) => {
    const room = rooms[roomId];

    if (!room) {
      socket.emit('error', 'Sala não encontrada.');
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('error', 'Sala cheia.');
      return;
    }

    room.players.push({ socketId: socket.id, playerType: 'B', name });
    socket.join(roomId);

    // Avisa todos na sala que o jogo começou e envia o estado inicial
    io.to(roomId).emit('game_start', { 
      gameState: room.gameState,
      players: room.players,
      boardSize: room.boardSize
    });
  });

  // 3. Ações do Jogo (Rolar Dado)
  socket.on('roll_dice', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // Lógica do dado no servidor para evitar trapaça
    const rolledNumber = Math.floor(Math.random() * room.boardSize) + 1;
    
    room.gameState.diceValue = rolledNumber;
    room.gameState.movesLeft = rolledNumber;
    room.gameState.waitingForRoll = false;

    io.to(roomId).emit('update_game', room.gameState);
  });

  // 4. Ações do Jogo (Clicar na Linha)
  socket.on('make_move', ({ roomId, type, row, column }) => {
    const room = rooms[roomId];
    if (!room) return;

    // AQUI você deve mover toda aquela lógica do `handleLineClick` do seu front
    // Para validar se a jogada é válida e atualizar o `room.gameState`
    // ... lógica de fechar quadrado, atualizar score, trocar turno ...
    
    // Após atualizar o estado:
    io.to(roomId).emit('update_game', room.gameState);
  });

  socket.on('disconnect', () => {
    // Lógica para lidar com desconexão (avisar o outro jogador, deletar sala, etc)
  });
});

server.listen(3001, () => {
  console.log('Servidor rodando na porta 3001');
});