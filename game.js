const socket = io();

let side = null;
let roomId = null;

socket.on('connect', () => {
  socket.emit('join');
});

socket.on('waiting', () => {
  document.getElementById('ui').innerText = 'Waiting for opponent...';
});

socket.on('joined', (d) => {
  side = d.side;
  roomId = d.roomId;
  document.getElementById('ui').innerText = `Joined as ${side}`;
});

socket.on('start', () => {
  console.log('game starting');
});

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 480,
  backgroundColor: '#2d3446',
  scene: {
    preload,
    create,
    update
  }
};

const game = new Phaser.Game(config);

let stateSnapshot = { units: [], towers: {}, elixir: {} };

function preload() {
  // simple shapes will be drawn; no image assets required for prototype
}

function create() {
  const s = this;
  // draw towers (positions fixed)
  s.towerSprites = {
    A: [s.add.rectangle(50, 120, 60, 120, 0x996633), s.add.rectangle(50, 240, 60, 120, 0x996633), s.add.rectangle(50, 360, 60, 120, 0x996633)],
    B: [s.add.rectangle(750, 120, 60, 120, 0x333333), s.add.rectangle(750, 240, 60, 120, 0x333333), s.add.rectangle(750, 360, 60, 120, 0x333333)]
  };

  s.unitGroup = s.add.group();

  // simple UI buttons to play card on each lane
  const lanes = [0,1,2];
  lanes.forEach((lane, i) => {
    const btn = s.add.rectangle(400, 80 + i*120, 140, 50, 0x5566ff).setInteractive();
    const txt = s.add.text(360, 65 + i*120, 'Play ('+lane+')', {font:'14px Arial'});
    btn.on('pointerdown', () => {
      socket.emit('playCard', { roomId, cardId: 'unit1', lane: lane });
    });
  });

  // display elixir & tower HP
  s.elixirText = s.add.text(10, 10, '', {font:'16px Arial'});
  s.towerText = s.add.text(600, 10, '', {font:'16px Arial'});

  // listen for snapshot updates
  socket.on('state', (snap) => {
    stateSnapshot = snap;
  });

  socket.on('winner', (w) => {
    console.log('winner', w);
  });

  socket.on('left', () => {
    s.add.text(300,240,'Opponent left', {font:'24px Arial'});
  });
}

function update() {
  const s = this;
  // update tower colors based on HP
  if (stateSnapshot.towers) {
    const towers = stateSnapshot.towers;
    if (towers.A) towers.A.forEach((t, i) => {
      const hs = Math.max(0, Math.min(255, Math.floor(255 * (t.hp / 1000))));
      s.towerSprites.A[i].fillColor = Phaser.Display.Color.GetColor(255-hs, hs, 100);
    });
    if (towers.B) towers.B.forEach((t, i) => {
      const hs = Math.max(0, Math.min(255, Math.floor(255 * (t.hp / 1000))));
      s.towerSprites.B[i].fillColor = Phaser.Display.Color.GetColor(255-hs, hs, 100);
    });
  }

  // sync units: naive approach - wipe and recreate
  s.unitGroup.clear(true, true);
  for (const u of stateSnapshot.units || []) {
    const color = u.owner === 'A' ? 0x00ff99 : 0xff5555;
    const rect = s.add.rectangle(u.x, u.y, 28, 28, color);
    s.unitGroup.add(rect);
  }

  // update UI
  const el = stateSnapshot.elixir || {};
  s.elixirText.setText(`Elixir A: ${el.A ? el.A.toFixed(1) : 0}  B: ${el.B ? el.B.toFixed(1) : 0}`);
  if (stateSnapshot.towers) {
    const tA = stateSnapshot.towers.A.map(t=>Math.max(0,Math.round(t.hp))).join(',');
    const tB = stateSnapshot.towers.B.map(t=>Math.max(0,Math.round(t.hp))).join(',');
    s.towerText.setText(`Towers A: ${tA}\nTowers B: ${tB}`);
  }

  // check winner
  if (stateSnapshot.winner) {
    s.add.text(300,200, `Winner: ${stateSnapshot.winner}`, {font:'28px Arial'});
  }
}