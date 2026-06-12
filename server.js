const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });
app.use(express.static('public'));

const ROLES = {
  aldeano: { name: 'Aldeano', desc: 'Sin poderes', team: 'village' },
  lobo: { name: 'Hombre Lobo', desc: 'Mata cada noche', team: 'wolves', nightAction: true },
  vidente: { name: 'Vidente', desc: 'Ve rol', team: 'village', nightAction: true },
  bruja: { name: 'Bruja', desc: 'Protege/envenena', team: 'village', nightAction: true },
  cazador: { name: 'Cazador', desc: 'Dispara al morir', team: 'village' },
  pequenia: { name: 'Pequeña Niña', desc: 'Ve lobos', team: 'village', nightAction: true },
  amor: { name: 'Enamorados', desc: 'Mueren juntos', team: 'village' },
  zorro: { name: 'Zorro', desc: 'Busca lobos', team: 'village', nightAction: true },
  flautista: { name: 'Flautista', desc: 'Hechiza', team: 'village', nightAction: true },
  anciano: { name: 'Anciano', desc: 'Resiste ataque', team: 'village' },
  domador: { name: 'Domador de Osos', desc: 'Gruñe de día', team: 'village' },
  inquisidor: { name: 'Inquisidor', desc: 'Interroga', team: 'village', nightAction: true },
  alcalde: { name: 'Alcalde', desc: 'Voto doble', team: 'village' },
  justiciero: { name: 'Justiciero', desc: 'Muere por voto injusto', team: 'village' },
  principe: { name: 'Príncipe', desc: 'Inmune a votos', team: 'village' },
  picaro: { name: 'Pícaro', desc: 'Pierde si vidente lo ve', team: 'village' },
  chivo: { name: 'Chivo Expiatorio', desc: 'Voto extra', team: 'village' },
  pastor: { name: 'Pastor', desc: 'Conoce a otro', team: 'village' },
  hermanas: { name: 'Dos Hermanas', desc: 'Se conocen', team: 'village' },
  ninoSalvaje: { name: 'Niño Salvaje', desc: 'Elige modelo', team: 'village' },
  loboFeroz: { name: 'Lobo Feroz', desc: 'Come dos veces', team: 'wolves', nightAction: true },
  hobreLoboAlbino: { name: 'Hombre Lobo Albino', desc: 'Ataca solo', team: 'wolves', nightAction: true },
  infectoPadre: { name: 'Infecto Padre', desc: 'Propaga infección', team: 'wolves', nightAction: true },
};

// Restricciones de roles (máximo 1 a menos que se indique)
const ROLE_LIMITS = {
  aldeano: 999,      // Ilimitados
  lobo: 999,         // Pueden ser varios
  vidente: 1,
  bruja: 1,
  cazador: 1,
  pequenia: 1,
  amor: 1,           // 1 grupo = 2 personas
  zorro: 1,
  flautista: 1,
  anciano: 1,
  domador: 1,
  inquisidor: 1,
  alcalde: 1,
  justiciero: 1,
  principe: 1,
  picaro: 1,
  chivo: 1,
  pastor: 1,
  hermanas: 1,       // 1 grupo = 2 personas
  ninoSalvaje: 1,
  loboFeroz: 1,
  hobreLoboAlbino: 1,
  infectoPadre: 1,
  ladrona: 1,
  gigolo: 1,
  perroSalvaje: 1,
  loboBlanco: 1,
  loboSalvaje: 1,
};

let gameRooms = {};

io.on('connection', (socket) => {
  socket.on('createRoom', (data) => {
    const code = Math.random().toString(36).substring(7).toUpperCase();
    gameRooms[code] = {
      host: socket.id,
      players: [{ id: socket.id, name: data.hostName, role: 'aldeano', alive: true }],
      gameStarted: false,
      day: 1,
      isNight: false,
      logs: ['🌅 Sala creada'],
      votes: {},
      currentNightStep: 0,
      nightActions: {},
      maxPlayers: 4,
      selectedRoles: {},
    };
    socket.join(code);
    socket.emit('roomCreated', { code });
    io.to(code).emit('updateGame', gameRooms[code]);
  });

  socket.on('joinRoom', (data) => {
    const room = gameRooms[data.code];
    if (!room || room.gameStarted) {
      socket.emit('error', room ? 'Partida ya comenzó' : 'Sala no encontrada');
      return;
    }
    room.players.push({ id: socket.id, name: data.playerName, role: 'aldeano', alive: true });
    socket.join(data.code);
    socket.emit('roomJoined', { code: data.code });
    io.to(data.code).emit('updateGame', room);
  });

  socket.on('setupGame', (data) => {
    const room = gameRooms[data.code];
    if (!room || room.host !== socket.id) return;

    room.maxPlayers = data.maxPlayers;
    room.selectedRoles = data.selectedRoles;
    
    // Validar que no exceda límites
    for (let role in data.selectedRoles) {
      const count = data.selectedRoles[role];
      const limit = ROLE_LIMITS[role] || 1;
      if (count > limit) {
        socket.emit('error', `${ROLES[role].name} máximo ${limit}`);
        return;
      }
    }

    io.to(data.code).emit('updateGame', room);
    io.to(data.code).emit('gameReady');
  });

  socket.on('assignRole', (data) => {
    const room = gameRooms[data.code];
    if (!room) return;
    const player = room.players.find(p => p.id === data.playerId);
    if (player) {
      player.role = data.role;
      io.to(data.code).emit('updateGame', room);
    }
  });

  socket.on('startGame', (data) => {
    const room = gameRooms[data.code];
    if (!room || room.host !== socket.id || room.players.length < 4) return;
    room.gameStarted = true;
    room.logs.push(`🎮 Partida iniciada: ${room.players.length} jugadores`);
    room.isNight = true;
    room.currentNightStep = 0;
    io.to(data.code).emit('gameStarted', room);
    io.to(data.code).emit('narratorGuide', { step: 'primera_noche_cupido', message: 'Cupido, despierta y elige dos enamorados' });
  });

  socket.on('nextNightStep', (data) => {
    const room = gameRooms[data.code];
    if (!room || room.host !== socket.id) return;

    const nightSteps = [
      'primera_noche_cupido',
      'primera_noche_enamorados',
      'primera_noche_vidente',
      'primera_noche_hermanas',
      'primera_noche_nino_salvaje',
      'primera_noche_domador',
      'noche_lobos',
      'noche_lobo_feroz',
      'noche_bruja',
      'noche_zorro',
      'noche_flautista',
      'noche_vidente',
      'noche_pequenia',
      'noche_inquisidor',
      'dia_revela_victimas',
    ];

    room.currentNightStep++;
    if (room.currentNightStep >= nightSteps.length) {
      room.day++;
      room.isNight = false;
      room.currentNightStep = 0;
      room.votes = {};
      room.logs.push(`🌅 Amanece el día ${room.day}. El Osó gruñe si está en juego.`);
      io.to(data.code).emit('narratorGuide', { step: 'dia', message: '☀️ DÍA: Debate y votación para ejecutar' });
    } else {
      const step = nightSteps[room.currentNightStep];
      const messages = {
        'noche_lobos': '🐺 Hombres Lobo, ¡a actuar!',
        'noche_lobo_feroz': '🐺 Lobo Feroz, elige segunda víctima',
        'noche_bruja': '🧪 Bruja, protege o envenena',
        'noche_zorro': '🦊 Zorro, busca lobos',
        'noche_flautista': '🪄 Flautista, hechiza',
        'noche_vidente': '👁️ Vidente, mira a alguien',
        'noche_pequenia': '👧 Pequeña Niña, mira a los lobos',
        'noche_inquisidor': '❓ Inquisidor, interroga',
        'dia_revela_victimas': '💀 Se revelan las víctimas',
      };
      io.to(data.code).emit('narratorGuide', { step, message: messages[step] || 'Siguiente acción' });
    }
    io.to(data.code).emit('updateGame', room);
  });

  socket.on('vote', (data) => {
    const room = gameRooms[data.code];
    if (!room) return;
    room.votes[data.votedId] = (room.votes[data.votedId] || 0) + 1;
    io.to(data.code).emit('updateGame', room);
  });

  socket.on('executeVote', (data) => {
    const room = gameRooms[data.code];
    if (!room || room.host !== socket.id) return;

    const maxVotes = Math.max(...Object.values(room.votes), 0);
    const executedId = Object.entries(room.votes).find(([_, v]) => v === maxVotes)?.[0];

    if (executedId) {
      const victim = room.players.find(p => p.id === executedId);
      victim.alive = false;
      room.logs.push(`🗳️ ${victim.name} ejecutado (${ROLES[victim.role].name})`);
    }

    room.votes = {};
    room.isNight = true;
    room.currentNightStep = 0;
    room.logs.push(`🌙 Cae la noche...`);
    io.to(data.code).emit('updateGame', room);
    io.to(data.code).emit('narratorGuide', { step: 'noche_lobos', message: '🐺 Hombres Lobo, ¡a actuar!' });
  });

  socket.on('nightAction', (data) => {
    const room = gameRooms[data.code];
    if (!room) return;
    const actor = room.players.find(p => p.id === data.actorId);
    const target = room.players.find(p => p.id === data.targetId);
    if (actor && target) {
      room.logs.push(`🌙 ${actor.name} actúa sobre ${target.name}`);
    }
    io.to(data.code).emit('updateGame', room);
  });

  socket.on('newGame', (data) => {
    const room = gameRooms[data.code];
    if (!room || room.host !== socket.id) return;
    room.gameStarted = false;
    room.day = 1;
    room.isNight = false;
    room.logs = ['🌅 Nueva partida'];
    room.votes = {};
    room.nightActions = {};
    room.players.forEach(p => { p.alive = true; p.role = 'aldeano'; });
    io.to(data.code).emit('updateGame', room);
  });

  socket.on('disconnect', () => {
    for (let code in gameRooms) {
      gameRooms[code].players = gameRooms[code].players.filter(p => p.id !== socket.id);
      if (gameRooms[code].players.length === 0) delete gameRooms[code];
      else io.to(code).emit('updateGame', gameRooms[code]);
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`🎮 Servidor corriendo en puerto ${process.env.PORT || 3000}`);
});
