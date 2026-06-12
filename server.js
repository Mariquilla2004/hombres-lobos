const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });
app.use(express.static('public'));

// ============ ROLES ============
const ROLES = {
  aldeano:        { name: 'Aldeano', desc: 'Sin poderes. Vota con cabeza.', team: 'village' },
  lobo:           { name: 'Hombre Lobo', desc: 'Cada noche devora a un aldeano junto a los demás lobos.', team: 'wolves' },
  vidente:        { name: 'Vidente', desc: 'Cada noche descubre el rol de un jugador.', team: 'village' },
  bruja:          { name: 'Bruja', desc: 'Tiene 2 pociones: una cura y un veneno (1 uso cada una).', team: 'village' },
  cazador:        { name: 'Cazador', desc: 'Al morir, dispara y se lleva a alguien por delante.', team: 'village' },
  pequenia:       { name: 'Niña Pequeña', desc: 'Espía a los lobos mientras actúan.', team: 'village' },
  amor:           { name: 'Enamorados', desc: 'Se conocen y mueren juntos. (2 jugadores)', team: 'village', cards: 2 },
  zorro:          { name: 'Zorro', desc: 'Cada noche olfatea a un jugador y sus vecinos buscando lobos. Si falla, pierde el olfato.', team: 'village' },
  flautista:      { name: 'Flautista', desc: 'Cada noche hechiza a 2 jugadores. Gana si hechiza a todos.', team: 'solo' },
  anciano:        { name: 'Anciano', desc: 'Sobrevive al primer ataque de los lobos. Si el pueblo lo mata, todos pierden sus poderes.', team: 'village' },
  domador:        { name: 'Domador de Osos', desc: 'Si amanece junto a un lobo, el oso gruñe.', team: 'village' },
  inquisidor:     { name: 'Inquisidor', desc: 'Cada noche interroga: descubre el bando de un jugador.', team: 'village' },
  alcalde:        { name: 'Alcalde', desc: 'Su voto vale doble y decide cuándo se cierra la votación.', team: 'village' },
  justiciero:     { name: 'Justiciero', desc: 'Aldeano de honor. Si el pueblo lo ejecuta, su muerte pesa en la conciencia.', team: 'village' },
  principe:       { name: 'Príncipe', desc: 'La primera vez que lo votan, revela su carta y se salva.', team: 'village' },
  picaro:         { name: 'Pícaro', desc: 'Si la Vidente lo mira, muere al amanecer.', team: 'village' },
  chivo:          { name: 'Chivo Expiatorio', desc: 'Si la votación queda empatada, muere él.', team: 'village' },
  pastor:         { name: 'Pastor', desc: 'La primera noche conoce el rol de un jugador al azar.', team: 'village' },
  hermanas:       { name: 'Dos Hermanas', desc: 'Se conocen entre ellas. (2 jugadoras)', team: 'village', cards: 2 },
  ninoSalvaje:    { name: 'Niño Salvaje', desc: 'Elige un modelo. Si su modelo muere, se convierte en lobo.', team: 'village' },
  loboFeroz:      { name: 'Lobo Feroz', desc: 'Devora una segunda víctima cada noche hasta que muera un lobo.', team: 'wolves' },
  hobreLoboAlbino:{ name: 'Hombre Lobo Albino', desc: 'Lobo solitario: las noches pares puede devorar a otro lobo. Gana si queda solo.', team: 'wolves' },
  infectoPadre:   { name: 'Infecto Padre', desc: 'Una vez por partida puede infectar a la víctima: sobrevive convertida en lobo.', team: 'wolves' },
};

const ROLE_LIMITS = {
  aldeano: 999, lobo: 999,
  vidente: 1, bruja: 1, cazador: 1, pequenia: 1, amor: 1, zorro: 1, flautista: 1,
  anciano: 1, domador: 1, inquisidor: 1, alcalde: 1, justiciero: 1, principe: 1,
  picaro: 1, chivo: 1, pastor: 1, hermanas: 1, ninoSalvaje: 1,
  loboFeroz: 1, hobreLoboAlbino: 1, infectoPadre: 1,
};

const WOLF_ROLES = ['lobo', 'loboFeroz', 'hobreLoboAlbino', 'infectoPadre'];

let gameRooms = {};
let pidCounter = 0;

// ============ HELPERS ============
const newPid = () => 'p' + (++pidCounter) + Math.random().toString(36).slice(2, 6);

function isWolf(p) { return p.becameWolf || WOLF_ROLES.includes(p.role); }
function alive(room) { return room.players.filter(p => p.alive); }
function aliveWolves(room) { return alive(room).filter(isWolf); }
function byPid(room, pid) { return room.players.find(p => p.pid === pid); }
function byRole(room, role) { return alive(room).filter(p => p.role === role); }
function names(list) { return list.map(p => p.name).join(', '); }

function cardCount(role, count) { return (ROLES[role]?.cards || 1) * count; }

function totalCards(selectedRoles) {
  let t = 0;
  for (const [r, c] of Object.entries(selectedRoles || {})) t += cardCount(r, c || 0);
  return t;
}

function log(room, msg) { room.logs.push(msg); }

function sendTo(room, p, event, data) {
  if (p.socketId) io.to(p.socketId).emit(event, data);
}

function publicState(room) {
  return {
    code: room.code,
    hostPid: room.hostPid,
    phase: room.phase,
    nightNumber: room.nightNumber,
    maxPlayers: room.maxPlayers,
    selectedRoles: room.selectedRoles,
    logs: room.logs.slice(-60),
    players: room.players.map(p => ({
      pid: p.pid, name: p.name, alive: p.alive, connected: p.connected,
      role: p.alive ? null : p.role, // solo se revela al morir
      roleName: p.alive ? null : (ROLES[p.role]?.name || p.role),
      revealedPrince: p.revealedPrince || false,
    })),
    voteInfo: room.phase === 'vote' ? voteProgress(room) : null,
    winner: room.winner || null,
  };
}

function broadcast(room) { io.to(room.code).emit('state', publicState(room)); }

function announce(room, message) {
  log(room, message);
  io.to(room.code).emit('narrator', { message });
}

// ============ SETUP / ROLES ============
function assignRoles(room) {
  const deck = [];
  for (const [role, count] of Object.entries(room.selectedRoles)) {
    const copies = cardCount(role, count || 0);
    for (let i = 0; i < copies; i++) deck.push(role);
  }
  while (deck.length < room.players.length) deck.push('aldeano');
  // barajar
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  room.players.forEach((p, i) => {
    p.role = deck[i];
    p.alive = true;
    p.becameWolf = false;
    p.charmed = false;
    p.revealedPrince = false;
  });
  // los enamorados por carta se enlazan entre sí
  const lovers = room.players.filter(p => p.role === 'amor');
  if (lovers.length === 2) {
    lovers[0].lover = lovers[1].pid;
    lovers[1].lover = lovers[0].pid;
  }
}

// ============ MOTOR DE NOCHE ============
function buildNightQueue(room) {
  const q = [];
  const n = room.nightNumber;
  const has = role => byRole(room, role).length > 0;
  const powers = !room.villagePowersLost;

  if (n === 1) {
    if (byRole(room, 'amor').length === 2) q.push('amor_info');
    if (byRole(room, 'hermanas').length === 2) q.push('hermanas_info');
    if (has('pastor')) q.push('pastor_info');
    if (has('ninoSalvaje')) q.push('ninoSalvaje');
  }
  if (has('vidente') && powers) q.push('vidente');
  if (aliveWolves(room).length > 0) q.push('lobos');
  if (has('hobreLoboAlbino') && n % 2 === 0 && aliveWolves(room).length > 1) q.push('albino');
  if (has('infectoPadre') && !room.infectoUsed) q.push('infecto');
  if (has('loboFeroz') && !room.wolfDiedEver) q.push('feroz');
  if (has('bruja') && powers && (room.witch.heal || room.witch.poison)) q.push('bruja');
  if (has('zorro') && powers && room.zorroPower) q.push('zorro');
  if (has('inquisidor') && powers) q.push('inquisidor');
  if (has('flautista')) q.push('flautista');
  return q;
}

function startNight(room) {
  room.nightNumber++;
  room.phase = 'night';
  room.night = { victims: [], healed: null, poisoned: null, infected: null, picaroSeen: room.night?.picaroSeen || false };
  room.queue = buildNightQueue(room);
  room.stepIndex = -1;
  room.pending = null;
  announce(room, `🌙 Noche ${room.nightNumber}. Castronegro duerme...`);
  broadcast(room);
  nextStep(room);
}

function nextStep(room) {
  room.stepIndex++;
  if (room.stepIndex >= room.queue.length) return resolveDawn(room);
  const step = room.queue[room.stepIndex];
  runStep(room, step);
}

function targetOpts(list) { return list.map(p => ({ pid: p.pid, name: p.name })); }

function runStep(room, step) {
  const others = me => alive(room).filter(p => p.pid !== me.pid);

  switch (step) {
    case 'amor_info': {
      const [a, b] = byRole(room, 'amor');
      sendTo(room, a, 'info', { message: `💘 Estás enamorado/a de ${b.name}. Si muere, mueres con él/ella.` });
      sendTo(room, b, 'info', { message: `💘 Estás enamorado/a de ${a.name}. Si muere, mueres con él/ella.` });
      announce(room, '💘 Los Enamorados se reconocen.');
      return nextStep(room);
    }
    case 'hermanas_info': {
      const [a, b] = byRole(room, 'hermanas');
      sendTo(room, a, 'info', { message: `👭 Tu hermana es ${b.name}.` });
      sendTo(room, b, 'info', { message: `👭 Tu hermana es ${a.name}.` });
      announce(room, '👭 Las Dos Hermanas se reconocen.');
      return nextStep(room);
    }
    case 'pastor_info': {
      const pastor = byRole(room, 'pastor')[0];
      const pool = others(pastor);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      sendTo(room, pastor, 'info', { message: `⛪ Tu fe te revela: ${pick.name} es ${ROLES[pick.role].name}.` });
      announce(room, '⛪ El Pastor recibe una revelación.');
      return nextStep(room);
    }
    case 'ninoSalvaje': {
      const nino = byRole(room, 'ninoSalvaje')[0];
      return ask(room, step, [nino], {
        prompt: '🐾 Elige a tu modelo. Si muere, te convertirás en Hombre Lobo.',
        options: targetOpts(others(nino)), count: 1,
      });
    }
    case 'vidente': {
      const v = byRole(room, 'vidente')[0];
      return ask(room, step, [v], {
        prompt: '👁️ ¿De quién quieres ver la carta?',
        options: targetOpts(others(v)), count: 1,
      });
    }
    case 'lobos': {
      const wolves = aliveWolves(room);
      const prey = alive(room).filter(p => !isWolf(p));
      if (!prey.length) return nextStep(room);
      announce(room, '🐺 Los Hombres Lobo salen de caza...');
      // la Niña Pequeña espía
      const nina = byRole(room, 'pequenia')[0];
      if (nina && !room.villagePowersLost) {
        sendTo(room, nina, 'info', { message: `👧 Espías entre las contraventanas... Los lobos son: ${names(wolves)}.` });
      }
      return ask(room, step, wolves, {
        prompt: `🐺 Tus compañeros lobos: ${names(wolves)}. Elegid víctima (gana la mayoría).`,
        options: targetOpts(prey), count: 1,
      });
    }
    case 'albino': {
      const albino = byRole(room, 'hobreLoboAlbino')[0];
      const targets = aliveWolves(room).filter(p => p.pid !== albino.pid);
      return ask(room, step, [albino], {
        prompt: '🤍 Noche par: puedes devorar a otro lobo (o pasar).',
        options: targetOpts(targets), count: 1, canSkip: true,
      });
    }
    case 'infecto': {
      const inf = byRole(room, 'infectoPadre')[0];
      const victim = room.night.wolfVictim ? byPid(room, room.night.wolfVictim) : null;
      if (!victim) return nextStep(room);
      return ask(room, step, [inf], {
        prompt: `🦠 La víctima es ${victim.name}. ¿Quieres infectarla? (sobrevivirá convertida en lobo, 1 uso por partida)`,
        options: [{ pid: 'si', name: '🦠 Sí, infectar' }, { pid: 'no', name: 'No, que muera' }], count: 1,
      });
    }
    case 'feroz': {
      const feroz = byRole(room, 'loboFeroz')[0];
      const prey = alive(room).filter(p => !isWolf(p) && p.pid !== room.night.wolfVictim);
      if (!prey.length) return nextStep(room);
      return ask(room, step, [feroz], {
        prompt: '🐺🐺 Tu hambre feroz exige una segunda víctima (o pasa).',
        options: targetOpts(prey), count: 1, canSkip: true,
      });
    }
    case 'bruja': {
      const bruja = byRole(room, 'bruja')[0];
      const victims = [room.night.wolfVictim, room.night.ferozVictim].filter(Boolean).map(pid => byPid(room, pid));
      let msg = victims.length ? `Esta noche los lobos atacan a: ${names(victims)}.` : 'Esta noche los lobos no han cazado.';
      const options = [];
      if (room.witch.heal && victims.length) options.push({ pid: 'curar', name: `🧪 Curar a ${names(victims)}`.slice(0, 60) });
      if (room.witch.poison) alive(room).filter(p => p.pid !== bruja.pid).forEach(p => options.push({ pid: 'veneno:' + p.pid, name: `☠️ Envenenar a ${p.name}` }));
      if (!options.length) return nextStep(room);
      return ask(room, step, [bruja], { prompt: `🧪 ${msg}`, options, count: 1, canSkip: true });
    }
    case 'zorro': {
      const zorro = byRole(room, 'zorro')[0];
      return ask(room, step, [zorro], {
        prompt: '🦊 Olfatea a un jugador: sabrás si él o sus vecinos esconden un lobo. Si no hay, pierdes el olfato.',
        options: targetOpts(others(zorro)), count: 1,
      });
    }
    case 'inquisidor': {
      const inq = byRole(room, 'inquisidor')[0];
      return ask(room, step, [inq], {
        prompt: '❓ ¿A quién interrogas esta noche?',
        options: targetOpts(others(inq)), count: 1,
      });
    }
    case 'flautista': {
      const fl = byRole(room, 'flautista')[0];
      const targets = alive(room).filter(p => p.pid !== fl.pid && !p.charmed);
      if (!targets.length) return nextStep(room);
      return ask(room, step, [fl], {
        prompt: '🪄 Toca tu flauta: hechiza hasta a 2 jugadores.',
        options: targetOpts(targets), count: Math.min(2, targets.length),
      });
    }
  }
  nextStep(room);
}

function ask(room, step, actors, payload) {
  const liveActors = actors.filter(p => p && p.alive);
  if (!liveActors.length) return nextStep(room);
  room.pending = { step, waiting: liveActors.map(p => p.pid), responses: {} };
  liveActors.forEach(p => sendTo(room, p, 'actionRequest', { step, ...payload }));
  io.to(room.code).emit('waitingFor', { step, count: liveActors.length });
}

function handleAction(room, player, data) {
  const pend = room.pending;
  if (!pend || !pend.waiting.includes(player.pid)) return;
  pend.responses[player.pid] = data.choices || [];
  pend.waiting = pend.waiting.filter(pid => pid !== player.pid);
  if (pend.waiting.length) return;

  const step = pend.step;
  const first = Object.values(pend.responses)[0] || [];
  room.pending = null;

  switch (step) {
    case 'ninoSalvaje': {
      const nino = byRole(room, 'ninoSalvaje')[0];
      nino.model = first[0] || null;
      const m = byPid(room, nino.model);
      if (m) sendTo(room, nino, 'info', { message: `🐾 Tu modelo es ${m.name}. Reza por su vida.` });
      break;
    }
    case 'vidente': {
      const v = byRole(room, 'vidente')[0];
      const t = byPid(room, first[0]);
      if (t) {
        sendTo(room, v, 'info', { message: `👁️ ${t.name} es... ${ROLES[t.role].name}.` });
        if (t.role === 'picaro') room.night.picaroSeen = true;
        announce(room, '👁️ La Vidente ha consultado las cartas.');
      }
      break;
    }
    case 'lobos': {
      const tally = {};
      Object.values(pend.responses).forEach(ch => { if (ch[0]) tally[ch[0]] = (tally[ch[0]] || 0) + 1; });
      const max = Math.max(...Object.values(tally), 0);
      const top = Object.keys(tally).filter(pid => tally[pid] === max);
      room.night.wolfVictim = top[Math.floor(Math.random() * top.length)] || null;
      break;
    }
    case 'albino': {
      room.night.albinoVictim = first[0] && first[0] !== 'skip' ? first[0] : null;
      break;
    }
    case 'infecto': {
      if (first[0] === 'si' && room.night.wolfVictim) {
        room.night.infected = room.night.wolfVictim;
        room.infectoUsed = true;
      }
      break;
    }
    case 'feroz': {
      room.night.ferozVictim = first[0] && first[0] !== 'skip' ? first[0] : null;
      break;
    }
    case 'bruja': {
      const bruja = byRole(room, 'bruja')[0];
      const c = first[0];
      if (c === 'curar') { room.night.healed = true; room.witch.heal = false; sendTo(room, bruja, 'info', { message: '🧪 Has usado tu poción de cura.' }); }
      else if (c && c.startsWith('veneno:')) { room.night.poisoned = c.slice(7); room.witch.poison = false; sendTo(room, bruja, 'info', { message: '☠️ Has usado tu veneno.' }); }
      break;
    }
    case 'zorro': {
      const zorro = byRole(room, 'zorro')[0];
      const t = byPid(room, first[0]);
      if (t) {
        const circle = alive(room);
        const i = circle.findIndex(p => p.pid === t.pid);
        const group = [circle[i], circle[(i + 1) % circle.length], circle[(i - 1 + circle.length) % circle.length]];
        const found = group.some(isWolf);
        sendTo(room, zorro, 'info', { message: found ? `🦊 ¡Hueles a lobo cerca de ${t.name}!` : `🦊 Nada sospechoso cerca de ${t.name}... y tu olfato se agota.` });
        if (!found) room.zorroPower = false;
      }
      break;
    }
    case 'inquisidor': {
      const inq = byRole(room, 'inquisidor')[0];
      const t = byPid(room, first[0]);
      if (t) sendTo(room, inq, 'info', { message: `❓ ${t.name} pertenece al bando de ${isWolf(t) ? '🐺 los Lobos' : '🏡 la Aldea'}.` });
      break;
    }
    case 'flautista': {
      first.filter(pid => pid !== 'skip').forEach(pid => {
        const t = byPid(room, pid);
        if (t) { t.charmed = true; sendTo(room, t, 'info', { message: '🪄 Has oído una melodía hipnótica... estás hechizado/a.' }); }
      });
      announce(room, '🪄 El Flautista ha tocado su melodía.');
      break;
    }
    case 'cazador': {
      const t = byPid(room, first[0]);
      if (t && t.alive) {
        announce(room, `🔫 ¡El Cazador dispara su último cartucho contra ${t.name}!`);
        killPlayer(room, t, 'cazador');
      }
      return afterDeaths(room);
    }
    case 'alcalde_empate': {
      const t = byPid(room, first[0]);
      if (t && t.alive) {
        announce(room, `⚖️ El Alcalde rompe el empate: ${t.name} es ejecutado.`);
        executePlayer(room, t);
      }
      return afterDeaths(room);
    }
  }
  if (room.phase === 'night') nextStep(room);
}

// ============ AMANECER ============
function resolveDawn(room) {
  room.phase = 'dawn';
  const n = room.night;
  const deaths = [];

  const wolfTarget = n.wolfVictim ? byPid(room, n.wolfVictim) : null;
  if (wolfTarget && wolfTarget.alive) {
    if (n.infected === wolfTarget.pid) {
      wolfTarget.becameWolf = true;
      sendTo(room, wolfTarget, 'info', { message: '🦠 Has sido infectado/a. ¡Ahora eres un Hombre Lobo! Caza con ellos cada noche.' });
    } else if (n.healed) {
      // salvado por la bruja
    } else if (wolfTarget.role === 'anciano' && !room.ancianoHit) {
      room.ancianoHit = true;
      announce(room, '🌅 Los lobos atacaron... pero su presa resistió el mordisco.');
    } else deaths.push(wolfTarget);
  }
  const ferozTarget = n.ferozVictim ? byPid(room, n.ferozVictim) : null;
  if (ferozTarget && ferozTarget.alive && !deaths.includes(ferozTarget)) {
    if (n.healed) { /* la poción salva a las víctimas de los lobos */ }
    else if (ferozTarget.role === 'anciano' && !room.ancianoHit) { room.ancianoHit = true; }
    else deaths.push(ferozTarget);
  }
  const albinoTarget = n.albinoVictim ? byPid(room, n.albinoVictim) : null;
  if (albinoTarget && albinoTarget.alive) deaths.push(albinoTarget);
  const poisonTarget = n.poisoned ? byPid(room, n.poisoned) : null;
  if (poisonTarget && poisonTarget.alive && !deaths.includes(poisonTarget)) deaths.push(poisonTarget);
  if (n.picaroSeen) {
    const pic = byRole(room, 'picaro')[0];
    if (pic && !deaths.includes(pic)) { deaths.push(pic); announce(room, '🎭 La mirada de la Vidente fulmina al Pícaro.'); }
    room.night.picaroSeen = false;
  }

  announce(room, `🌅 Amanece el día ${room.nightNumber}...`);
  if (!deaths.length) announce(room, '😮‍💨 Milagro: nadie ha muerto esta noche.');
  deaths.forEach(p => killPlayer(room, p, p === poisonTarget ? 'veneno' : 'lobos'));
  afterDeaths(room);
}

function killPlayer(room, p, cause) {
  if (!p.alive) return;
  p.alive = false;
  announce(room, `💀 ${p.name} ha muerto. Era... ${ROLES[p.role].name}.`);
  sendTo(room, p, 'info', { message: '💀 Has muerto. Sigue mirando, pero guarda silencio.' });
  if (cause === 'veneno' || cause === 'voto' || cause === 'cazador') {
    if (p.role === 'anciano') {
      room.villagePowersLost = true;
      announce(room, '😱 ¡Habéis matado al Anciano! La aldea pierde todos sus poderes.');
    }
  }
  room.deathChain = room.deathChain || [];
  room.deathChain.push(p);
}

function afterDeaths(room) {
  // procesa cadenas: enamorados, niño salvaje, lobo muerto, cazador
  const chain = room.deathChain || [];
  room.deathChain = [];
  for (const dead of chain) {
    if (isWolf(dead)) room.wolfDiedEver = true;
    // enamorados
    if (dead.lover) {
      const partner = byPid(room, dead.lover);
      if (partner && partner.alive) {
        announce(room, `💔 ${partner.name} muere de pena junto a su amor.`);
        killPlayer(room, partner, 'pena');
        return afterDeaths(room);
      }
    }
    // niño salvaje
    const nino = byRole(room, 'ninoSalvaje')[0];
    if (nino && nino.model === dead.pid && !nino.becameWolf) {
      nino.becameWolf = true;
      sendTo(room, nino, 'info', { message: '🐺 Tu modelo ha muerto. La rabia te transforma: ¡ahora eres un Hombre Lobo!' });
    }
    // cazador dispara
    if (dead.role === 'cazador' && !dead.shotFired) {
      dead.shotFired = true;
      const targets = alive(room);
      if (targets.length) {
        announce(room, '🔫 El Cazador agoniza... y carga su escopeta.');
        broadcast(room);
        return ask(room, 'cazador', [{ ...dead, alive: true }], {
          prompt: '🔫 Estás muriendo. Elige a quién llevarte contigo.',
          options: targetOpts(targets), count: 1,
        });
      }
    }
  }
  if (checkWin(room)) return;
  if (room.phase === 'dawn') {
    bearGrowl(room);
    startVote(room);
  } else if (room.phase === 'vote' || room.phase === 'day') {
    startNight(room);
  }
}

function bearGrowl(room) {
  const dom = byRole(room, 'domador')[0];
  if (!dom) return;
  const circle = alive(room);
  const i = circle.findIndex(p => p.pid === dom.pid);
  if (i === -1) return;
  const neighbors = [circle[(i + 1) % circle.length], circle[(i - 1 + circle.length) % circle.length]];
  const growl = neighbors.some(isWolf) || isWolf(dom);
  announce(room, growl ? '🐻 ¡¡El oso del Domador GRUÑE!! Hay un lobo cerca de él.' : '🐻 El oso del Domador ronca tranquilo.');
}

// ============ VOTACIÓN ============
function startVote(room) {
  room.phase = 'vote';
  room.votes = {};
  room.voteClosed = false;
  const alc = byRole(room, 'alcalde')[0];
  announce(room, `🗳️ Debate y votación. ${alc ? 'El Alcalde cerrará la votación cuando todos hayan votado.' : 'La votación se cierra cuando todos voten.'}`);
  broadcast(room);
}

function voteProgress(room) {
  const voters = alive(room);
  const voted = voters.filter(p => room.votes[p.pid]);
  return {
    total: voters.length,
    voted: voted.length,
    pending: voters.filter(p => !room.votes[p.pid]).map(p => p.name),
    allVoted: voted.length === voters.length,
    alcaldePid: byRole(room, 'alcalde')[0]?.pid || null,
  };
}

function closeVote(room) {
  if (room.voteClosed) return;
  room.voteClosed = true;
  const tally = {};
  alive(room).forEach(p => {
    const t = room.votes[p.pid];
    if (!t) return;
    const weight = p.role === 'alcalde' ? 2 : 1;
    tally[t] = (tally[t] || 0) + weight;
  });
  const max = Math.max(...Object.values(tally), 0);
  const top = Object.keys(tally).filter(pid => tally[pid] === max);

  if (!max || !top.length) {
    announce(room, '🗳️ Nadie recibe votos. La aldea duda...');
    return startNight(room);
  }
  if (top.length > 1) {
    const chivo = byRole(room, 'chivo')[0];
    if (chivo) {
      announce(room, `🐐 ¡Empate! El Chivo Expiatorio paga los platos rotos.`);
      executePlayer(room, chivo);
      return afterDeaths(room);
    }
    const alc = byRole(room, 'alcalde')[0];
    if (alc) {
      const tied = top.map(pid => byPid(room, pid)).filter(Boolean);
      announce(room, `⚖️ Empate entre ${names(tied)}. El Alcalde decide.`);
      return ask(room, 'alcalde_empate', [alc], {
        prompt: '⚖️ Hay empate. Decide quién muere.',
        options: targetOpts(tied), count: 1,
      });
    }
    announce(room, '🗳️ Empate sin Alcalde: nadie es ejecutado hoy.');
    return startNight(room);
  }
  executePlayer(room, byPid(room, top[0]));
  afterDeaths(room);
}

function executePlayer(room, p) {
  if (!p || !p.alive) return;
  if (p.role === 'principe' && !p.revealedPrince) {
    p.revealedPrince = true;
    announce(room, `👑 ¡${p.name} revela su carta: es el Príncipe! La soga no es para la realeza.`);
    return;
  }
  announce(room, `🪢 La aldea ha hablado: ${p.name} es ejecutado.`);
  killPlayer(room, p, 'voto');
}

// ============ VICTORIA ============
function checkWin(room) {
  const a = alive(room);
  const wolves = a.filter(isWolf);
  const villagers = a.filter(p => !isWolf(p));
  let winner = null;

  const fl = byRole(room, 'flautista')[0];
  if (fl && a.filter(p => p.pid !== fl.pid).every(p => p.charmed) && a.length > 1) {
    winner = { team: 'flautista', message: `🪄 ¡Todos bailan al son del Flautista! ${fl.name} gana en solitario.` };
  } else if (a.length === 2 && a[0].lover === a[1].pid) {
    winner = { team: 'amor', message: `💘 El amor triunfa: ${names(a)} se quedan solos en Castronegro.` };
  } else if (!wolves.length) {
    winner = { team: 'village', message: '🏡 ¡La aldea ha exterminado a todos los lobos! Victoria del pueblo.' };
  } else if (!villagers.length) {
    const albino = wolves.length === 1 && wolves[0].role === 'hobreLoboAlbino';
    winner = { team: 'wolves', message: albino ? `🤍 El Lobo Albino devora la aldea entera. Gana solo.` : '🐺 Los Hombres Lobo devoran Castronegro. Victoria de los lobos.' };
  } else if (wolves.length >= villagers.length) {
    winner = { team: 'wolves', message: '🐺 Los lobos ya son mayoría: la aldea está perdida. Victoria de los lobos.' };
  }

  if (winner) {
    room.phase = 'ended';
    room.winner = winner;
    announce(room, winner.message);
    announce(room, '🃏 Cartas finales: ' + room.players.map(p => `${p.name}=${ROLES[p.role].name}`).join(' · '));
    room.players.forEach(p => { p.alive = false; }); // revela todas las cartas
    broadcast(room);
    return true;
  }
  return false;
}

// ============ SOCKETS ============
io.on('connection', (socket) => {
  let myRoom = null, myPid = null;

  const me = () => myRoom && byPid(myRoom, myPid);

  socket.on('createRoom', (data) => {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const pid = newPid();
    gameRooms[code] = {
      code, hostPid: pid,
      players: [{ pid, socketId: socket.id, name: String(data.hostName || 'Anfitrión').slice(0, 20), role: 'aldeano', alive: true, connected: true }],
      phase: 'lobby', nightNumber: 0, logs: ['🌅 Sala creada'],
      selectedRoles: {}, maxPlayers: 8,
      witch: { heal: true, poison: true }, zorroPower: true,
      infectoUsed: false, wolfDiedEver: false, villagePowersLost: false, ancianoHit: false,
      votes: {},
    };
    myRoom = gameRooms[code]; myPid = pid;
    socket.join(code);
    socket.emit('joined', { code, pid, isHost: true });
    broadcast(myRoom);
  });

  socket.on('joinRoom', (data) => {
    const room = gameRooms[(data.code || '').toUpperCase().trim()];
    const name = String(data.playerName || '').slice(0, 20).trim();
    if (!room) return socket.emit('errorMsg', 'Sala no encontrada');
    if (!name) return socket.emit('errorMsg', 'Pon un nombre');

    // reconexión: mismo nombre
    const existing = room.players.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (existing.connected) return socket.emit('errorMsg', 'Ese nombre ya está en uso');
      existing.socketId = socket.id; existing.connected = true;
      myRoom = room; myPid = existing.pid;
      socket.join(room.code);
      socket.emit('joined', { code: room.code, pid: existing.pid, isHost: room.hostPid === existing.pid });
      if (room.phase !== 'lobby') socket.emit('yourRole', { role: existing.role, ...ROLES[existing.role], wolves: isWolf(existing) ? names(aliveWolves(room)) : null });
      announce(room, `🔄 ${existing.name} ha vuelto.`);
      broadcast(room);
      return;
    }
    if (room.phase !== 'lobby') return socket.emit('errorMsg', 'La partida ya comenzó');
    if (room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'Sala llena');
    const pid = newPid();
    room.players.push({ pid, socketId: socket.id, name, role: 'aldeano', alive: true, connected: true });
    myRoom = room; myPid = pid;
    socket.join(room.code);
    socket.emit('joined', { code: room.code, pid, isHost: false });
    broadcast(room);
  });

  socket.on('setupGame', (data) => {
    const room = myRoom;
    if (!room || room.hostPid !== myPid || room.phase !== 'lobby') return;
    const sel = data.selectedRoles || {};
    for (const role in sel) {
      if (!ROLES[role]) delete sel[role];
      else if (sel[role] > (ROLE_LIMITS[role] || 1)) return socket.emit('errorMsg', `${ROLES[role].name}: máximo ${ROLE_LIMITS[role]}`);
    }
    room.maxPlayers = Math.max(4, Math.min(24, data.maxPlayers || room.players.length));
    room.selectedRoles = sel;
    broadcast(room);
  });

  socket.on('startGame', () => {
    const room = myRoom;
    if (!room || room.hostPid !== myPid || room.phase !== 'lobby') return;
    if (room.players.length < 4) return socket.emit('errorMsg', 'Mínimo 4 jugadores');
    const cards = totalCards(room.selectedRoles);
    if (cards > room.players.length) return socket.emit('errorMsg', `Has elegido ${cards} cartas para ${room.players.length} jugadores. Quita roles.`);
    if (cards < room.players.length && !(room.selectedRoles.aldeano > 0)) {
      // se rellena con aldeanos solo si faltan cartas
      log(room, `ℹ️ Faltaban ${room.players.length - cards} cartas: se añaden Aldeanos.`);
    }
    assignRoles(room);
    room.players.forEach(p => {
      sendTo(room, p, 'yourRole', { role: p.role, ...ROLES[p.role], wolves: isWolf(p) ? names(room.players.filter(x => isWolf(x))) : null });
    });
    announce(room, `🎮 Comienza la partida con ${room.players.length} habitantes.`);
    startNight(room);
  });

  socket.on('action', (data) => {
    const room = myRoom, p = me();
    if (room && p) handleAction(room, p, data || {});
  });

  socket.on('vote', (data) => {
    const room = myRoom, p = me();
    if (!room || !p || !p.alive || room.phase !== 'vote' || room.voteClosed) return;
    const t = byPid(room, data.targetPid);
    if (!t || !t.alive) return;
    room.votes[p.pid] = t.pid;
    broadcast(room);
    const prog = voteProgress(room);
    const alc = byRole(room, 'alcalde')[0];
    if (prog.allVoted && !alc) closeVote(room); // sin alcalde: cierre automático
  });

  socket.on('closeVote', () => {
    const room = myRoom, p = me();
    if (!room || !p || room.phase !== 'vote' || room.voteClosed) return;
    const alc = byRole(room, 'alcalde')[0];
    const canClose = alc ? p.pid === alc.pid : p.pid === room.hostPid;
    if (!canClose) return;
    if (!voteProgress(room).allVoted) return socket.emit('errorMsg', 'Aún no han votado todos los vivos');
    closeVote(room);
  });

  socket.on('hostSkipStep', () => {
    const room = myRoom;
    if (!room || room.hostPid !== myPid || !room.pending) return;
    announce(room, '⏭️ El anfitrión salta el turno atascado.');
    room.pending = null;
    if (room.phase === 'night') nextStep(room);
  });

  socket.on('newGame', () => {
    const room = myRoom;
    if (!room || room.hostPid !== myPid) return;
    Object.assign(room, {
      phase: 'lobby', nightNumber: 0, logs: ['🌅 Nueva partida'], winner: null,
      witch: { heal: true, poison: true }, zorroPower: true,
      infectoUsed: false, wolfDiedEver: false, villagePowersLost: false, ancianoHit: false,
      votes: {}, pending: null, deathChain: [],
    });
    room.players.forEach(p => Object.assign(p, { alive: true, role: 'aldeano', becameWolf: false, charmed: false, lover: null, model: null, revealedPrince: false, shotFired: false }));
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = myRoom, p = me();
    if (!room || !p) return;
    p.connected = false;
    if (room.phase === 'lobby') {
      room.players = room.players.filter(x => x.pid !== p.pid);
      if (room.hostPid === p.pid && room.players.length) room.hostPid = room.players[0].pid;
    }
    if (!room.players.length) { delete gameRooms[room.code]; return; }
    broadcast(room);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`🎮 Servidor corriendo en puerto ${process.env.PORT || 3000}`);
});
