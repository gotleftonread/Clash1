const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/../client'));

const PORT = 3000;

let waiting = null;
const rooms = {}; // roomId -> game state

function makeInitialState() {
  return {
    players: {}, // socketId -> {pos, side, elixir}
    towers: {
      // left(0), center(1), right(2) for both players
      A: [{hp: 1000},{hp:1000},{hp:1000}],
      B: [{hp:1000},{hp:1000},{hp:1000}]
    },
    units: [], // {id, owner, x, y, hp, speed, dmg, targetSide}
    nextUnitId: 1,
    t: Date.now()
  };
}

function startGameLoop(roomId) {
  const tickMs = 100; // 10 ticks/sec
  const state = rooms[roomId];
  if (!state) return;

  state.loop = setInterval(() => {
    // simple physics + unit movement
    const units = state.units;
    for (let u of units) {
      // move to right if owner A, left if owner B
      if (u.owner === 'A') u.x += u.speed;
      else u.x -= u.speed;

      // find collision with opponent tower (simplified)
      // arena width 800, towers at edges (x = 50 for A's towers to B, x = 750 for B)
      if (u.owner === 'A' && u.x >= 720) {
        // hit opponent B towers; pick nearest by y (lane)
        const lane = u.lane;
        const tower = state.towers.B[lane];
        tower.hp -= u.dmg;
        u.hp = 0; // die after hitting
      } else if (u.owner === 'B' && u.x <= 80) {
        const lane = u.lane;
        const tower = state.towers.A[lane];
        tower.hp -= u.dmg;
        u.hp = 0;
      }
    }
    // remove dead
    state.units = units.filter(u => u.hp > 0);

    // check win:
    function checkSide(side) {
      return state.towers[side].every(t => t.hp <= 0);
    }
    let winner = null;
    if (checkSide('A')) winner = 'B';
    if (checkSide('B')) winner = 'A';

    // broadcast state snapshot (small)
    io.to(roomId).emit('state', {
      units: state.units,
      towers: state.towers,
      elixir: { ...Object.fromEntries(Object.entries(state.players).map(([k,v]) => [v.side, v.elixir]))},
      winner
    });

    if (winner) {
      clearInterval(state.loop);
    }
  }, tickMs);
}

io.on('connection', socket => {
  console.log('conn', socket.id);

  socket.on('join', () => {
    if (waiting === null) {
      waiting = socket;
      socket.emit('waiting');
    } else {
      // start a room
      const roomId = 'room-' + socket.id + '-' + waiting.id;
      socket.join(roomId);
      waiting.join(roomId);

      // create state
      const state = makeInitialState();
      rooms[roomId] = state;
      // assign players
      state.players[socket.id] = { side: 'B', elixir: 0 };
      state.players[waiting.id] = { side: 'A', elixir: 0 };

      // attach mapping from socketId to side for quick access
      io.to(roomId).emit('start', { roomId });

      // give sockets their side
      socket.emit('joined', { side: 'B', roomId });
      waiting.emit('joined', { side: 'A', roomId });

      // start elixir regen loop per player
      state.elixirTick = setInterval(() => {
        for (let sid of Object.keys(state.players)) {
          const p = state.players[sid];
          p.elixir = Math.min(10, p.elixir + 0.5); // regen 0.5 per tick
        }
      }, 1000);

      startGameLoop(roomId);
      waiting = null;
    }
  });

  socket.on('playCard', data => {
    // data: {roomId, cardId, lane, x,y}
    const roomId = data.roomId;
    const state = rooms[roomId];
    if (!state) return;
    const player = state.players[socket.id];
    if (!player) return;

    // simplistic card costs
    const cardCost = 3;
    if (player.elixir < cardCost) {
      socket.emit('err', {msg:'not enough elixir'});
      return;
    }
    player.elixir -= cardCost;

    // spawn unit
    const unit = {
      id: state.nextUnitId++,
      owner: player.side,
      x: player.side === 'A' ? 120 : 680, // spawn side
      y: 150 + data.lane * 120,
      hp: 100,
      speed: player.side === 'A' ? 8 :  -8,
      dmg: 30,
      lane: data.lane
    };
    // normalize speed to positive for server logic
    unit.speed = Math.abs(unit.speed) / 10; // server ticks move value
    state.units.push(unit);
  });

  socket.on('disconnect', () => {
    console.log('disconn', socket.id);
    // cleanup rooms containing this socket
    for (const [roomId, state] of Object.entries(rooms)) {
      if (state.players && state.players[socket.id]) {
        io.to(roomId).emit('left');
        clearInterval(state.loop);
        clearInterval(state.elixirTick);
        delete rooms[roomId];
      }
    }
    if (waiting && waiting.id === socket.id) waiting = null;
  });
});

server.listen(PORT, () => {
  console.log('listening', PORT);
});