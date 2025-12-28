import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';

// Enum igual ao do Frontend para identificar o tipo de linha
enum Linha {
  VERTICAL,
  HORIZONTAL
}

// Interfaces de Estado
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

// Configuração do Servidor
const app = express();
const server = http.createServer(app);
const origin = process.env.CORS_ORIGIN || "*";

const io = new Server(server, {
  cors: {
    origin: origin,
    methods: ["GET", "POST"]
  }
});

// Armazenamento das salas em memória
const rooms: Record<string, Room> = {};

// Função auxiliar para criar o estado inicial do jogo
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
    // Gera um ID curto de 5 caracteres
    const roomId = randomUUID().slice(0, 5).toUpperCase();

    rooms[roomId] = {
      id: roomId,
      boardSize,
      players: [{ socketId: socket.id, playerType: 'A', name }],
      gameState: initializeGame(boardSize)
    };

    socket.join(roomId);
    socket.emit('room_created', { roomId, playerType: 'A' });
    console.log(`Sala ${roomId} criada por ${name} (Tamanho: ${boardSize})`);
  });

  // 2. Entrar na Sala
  socket.on('join_room', ({ roomId, name }) => {
    const room = rooms[roomId];

    if (!room) {
      socket.emit('error', 'Sala não encontrada. Verifique o ID.');
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('error', 'A sala já está cheia.');
      return;
    }

    // Adiciona o jogador B
    room.players.push({ socketId: socket.id, playerType: 'B', name });
    socket.join(roomId);

    console.log(`${name} entrou na sala ${roomId}`);

    // Avisa a todos da sala que o jogo começou e envia os dados iniciais
    io.to(roomId).emit('game_start', { 
      roomId,
      gameState: room.gameState,
      players: room.players,
      boardSize: room.boardSize
    });
  });

  // 3. Rolar Dado
  socket.on('roll_dice', ({ roomId }) => {
    
    const room = rooms[roomId];
    if (!room) return;
    
    const game = room.gameState;

    console.log("Tentando rolar...", { socket: !!socket, game: !!game, roomId }); // <--- DEBUG
    
    if (!socket || !game || !roomId) {
        console.error("Faltando dados para rolar!");
        return;
    }
    
    // Lógica simples do dado (1 até o tamanho do tabuleiro)
    const rolledNumber = Math.floor(Math.random() * room.boardSize) + 1;
    
    game.diceValue = rolledNumber;
    game.movesLeft = rolledNumber;
    game.waitingForRoll = false;

    // Envia atualização para todos
    io.to(roomId).emit('update_game', game);
  });

  // 4. Fazer Jogada (Lógica principal trazida do Frontend)
  socket.on('make_move', ({ roomId, type, row, column }) => {
    console.log(`Recebido movimento na sala ${roomId}: Tipo ${type}, Linha ${row}, Coluna ${column}`); // <--- Log para debug

    const room = rooms[roomId];
    if (!room) return;

    const game = room.gameState;
    const size = room.boardSize;

    // --- VALIDAÇÕES ---
    if (game.waitingForRoll) return;
    if (game.movesLeft <= 0) return;
    if (type === Linha.HORIZONTAL && game.horizontalLines[row][column]) return;
    if (type === Linha.VERTICAL && game.verticalLines[row][column]) return;

    // --- APLICA O MOVIMENTO ---
    if (type === Linha.HORIZONTAL){ 
      game.horizontalLines[row][column] = true;
    } else {
      game.verticalLines[row][column] = true;
    }

    game.movesLeft--;

    // --- VERIFICA SE FECHOU QUADRADO ---
    const checkSquare = (r: number, c: number) => {
      if (
        game.horizontalLines[r][c] &&       // Topo
        game.horizontalLines[r + 1][c] &&   // Base
        game.verticalLines[r][c] &&         // Esquerda
        game.verticalLines[r][c + 1]        // Direita
      ) {
        if (!game.squares[r][c]) {
          game.squares[r][c] = game.currentPlayer;
          game.scores[game.currentPlayer] += 1;
        }
      }
    };

    if (type === Linha.HORIZONTAL) {
      if (row < size) checkSquare(row, column);
      if (row > 0) checkSquare(row - 1, column);
    } else {
      if (column < size) checkSquare(row, column);
      if (column > 0) checkSquare(row, column - 1);
    }

    // --- TROCA DE TURNO ---
    if (game.movesLeft === 0) {
      game.currentPlayer = game.currentPlayer === 'A' ? 'B' : 'A';
      game.waitingForRoll = true;
      game.diceValue = null; 
    }

    // Verifica Fim de Jogo
    const totalScore = game.scores.A + game.scores.B;
    if (totalScore === size * size) {
        game.movesLeft = 0;
        game.waitingForRoll = false;
        game.winner = game.scores.A > game.scores.B ? 'A' : (game.scores.B > game.scores.A ? 'B' : 'Draw');
    }

    io.to(roomId).emit('update_game', game);
  });

  // 5. Desconexão
  socket.on('disconnect', () => {
    console.log('Usuário desconectado:', socket.id);
    // Aqui você pode adicionar lógica para remover o jogador da sala
    // ou encerrar o jogo se alguém sair.
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`CORS liberado para: ${origin}`);
});