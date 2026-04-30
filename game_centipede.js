const GameCentipede = {
  id:        'centipede',
  name:      'The Centipede Game',
  shortName: 'Centipede',
  category:  'theory',

  _ACADEMIC_A: -3.2,
  _ACADEMIC_B: 0.28,

  _academicTakeProb(node) {
    return 1 / (1 + Math.exp(-(this._ACADEMIC_A + this._ACADEMIC_B * node)));
  },

  _CONFIG: {
    capMin:        10,
    capMax:        20,
    startingPot:   2.00,
    growthPerNode: 0.50,
    // Loser share: drawn fresh each game via _drawLoserShare()
  },

  // ── 16 canonical 50-cent coin combinations ────────────────
  // {q:quarters, d:dimes, n:nickels, p:pennies}
  _COIN_COMBOS: [
    {q:2,d:0,n:0,p:0},{q:1,d:2,n:1,p:0},{q:0,d:5,n:0,p:0},
    {q:1,d:1,n:3,p:0},{q:0,d:4,n:2,p:0},{q:1,d:0,n:5,p:0},
    {q:0,d:3,n:4,p:0},{q:0,d:2,n:6,p:0},{q:1,d:2,n:0,p:5},
    {q:0,d:1,n:8,p:0},{q:1,d:1,n:2,p:5},{q:0,d:0,n:10,p:0},
    {q:0,d:4,n:1,p:5},{q:1,d:0,n:4,p:5},{q:0,d:3,n:3,p:5},
    {q:0,d:2,n:5,p:5},
  ],

  _state:    null,
  _shell:    null,
  _hintsEnabled: false,
  _animId:   null,
  _coins:    [],
  _canvas:   null,
  _ctx:      null,

  intro: {
    title: 'The Centipede Game',
    desc:  'You and an opponent take turns. Pass to grow the pot, or Take to claim it. The longer you cooperate, the more you might earn — but your opponent might strike first.',
    rules: [
      'Pass to grow the pot, or Take to end the game',
      'If you Take: you keep the larger share — split shown before play',
      'If your opponent Takes: you receive the smaller share',
      'A secret stopping node exists — if reached, the pot splits equally',
      'Your starting position (Player 1 or 2) is randomised each game',
    ]
  },

  mount(container, shellAPI, hintsEnabled) {
    this._shell        = shellAPI;
    this._hintsEnabled = !!hintsEnabled;
    const cfg          = this._CONFIG;
    const cap          = Math.floor(Math.random() * (cfg.capMax - cfg.capMin + 1)) + cfg.capMin;
    const loserShare   = this._drawLoserShare();
    const takerShare   = +(1 - loserShare).toFixed(2);
    // Random first mover
    const playerGoesFirst = Math.random() < 0.5;
    const playerPosition  = playerGoesFirst ? 1 : 2;

    // Pick coin combo for this game
    this._state = {
      node:           1,
      cap,
      pot:            cfg.startingPot,
      loserShare,
      takerShare,
      playerGoesFirst,
      playerPosition,
      playerTurn:     playerGoesFirst,
      gameOver:       false,
      outcome:        null,
      earnings:       0,
      history:        [],
      animating:      false,
    };

    this._coins  = [];
    container.innerHTML = this._html();
    this._setupCanvas();
    this._bindEvents();
    this._startPhysics();
    this._updateUI();

    // If opponent goes first, trigger their turn after short delay
    if (!playerGoesFirst) {
      setTimeout(() => this._opponentTurn(), 900);
    }
  },

  _drawLoserShare() {
    const mean = 0.25, sd = 0.10;
    let sample;
    do {
      const u1 = Math.random(), u2 = Math.random();
      const z  = Math.sqrt(-2*Math.log(u1)) * Math.cos(2*Math.PI*u2);
      sample = mean + sd * z;
    } while (sample < 0 || sample >= 0.50);
    return Math.round(sample * 100) / 100;
  },

  // ── HTML ──────────────────────────────────────────────────
  _html() {
    return `<style>
      #cent-root{display:flex;height:100%;overflow:hidden;font-family:'DM Sans',sans-serif;}
      .cent-main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:22px 20px;gap:18px;position:relative;background:var(--cream);}

      /* ── Pot ── */
      .cent-pot-area{text-align:center;}
      .cent-pot-label{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:5px;}
      .cent-pot-val{font-family:'Playfair Display',serif;font-size:clamp(40px,5.5vw,58px);font-weight:900;line-height:1;color:var(--ink);transition:transform .15s ease;}
      .cent-pot-val.grow{animation:potGrow .3s ease;}
      @keyframes potGrow{0%{transform:scale(1);}50%{transform:scale(1.08);color:var(--green);}100%{transform:scale(1);}}
      .cent-pot-sub{font-size:12px;color:var(--muted);font-family:'DM Mono',monospace;margin-top:5px;}

      /* ── Payoffs ── */
      .cent-payoffs{display:flex;gap:14px;align-items:center;}
      .cent-payoff-card{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:10px 16px;text-align:center;min-width:122px;transition:all .2s ease;}
      .cent-payoff-card.take-card{border-color:var(--red);}
      .cent-payoff-card.pass-card{border-color:var(--green);}
      .cent-payoff-title{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:5px;}
      .cent-payoff-you{font-family:'DM Mono',monospace;font-size:17px;font-weight:500;color:var(--ink);margin-bottom:2px;}
      .cent-payoff-opp{font-size:11px;color:var(--muted);}
      .cent-payoff-arrow{font-size:18px;color:var(--muted);}

      /* ── Buttons ── */
      .cent-actions{display:flex;gap:12px;}
      #cent-take{min-width:132px;height:50px;}
      #cent-pass{min-width:132px;height:50px;}

      /* ── Position badge ── */
      .cent-position-badge{font-family:'DM Mono',monospace;font-size:11px;padding:5px 12px;border-radius:2px;border:1px solid var(--border-solid);color:var(--muted);text-align:center;}
      .cent-position-badge.p1{border-color:rgba(200,168,75,.4);color:#8a6000;background:rgba(200,168,75,.08);}
      .cent-position-badge.p2{border-color:rgba(26,95,138,.4);color:#1A5F8A;background:rgba(26,95,138,.06);}

      .cent-status{font-size:13px;color:var(--muted);text-align:center;height:18px;font-family:'DM Mono',monospace;letter-spacing:.04em;}
      .cent-status.opponent{color:var(--gold);}

      /* ── COIN JAR ── */
      .coin-jar-section{display:flex;flex-direction:column;align-items:center;gap:4px;}
      .coin-jar-wrap{position:relative;}
      .coin-jar-canvas-wrap{
        position:relative;
        border:3px solid #8B7355;
        border-top:none;
        border-radius:0 0 20px 20px;
        background:linear-gradient(180deg,rgba(255,248,220,.95) 0%,rgba(255,235,180,.95) 100%);
        overflow:hidden;
        box-shadow:inset 0 -3px 10px rgba(139,115,85,.2),0 3px 12px rgba(139,115,85,.25);
      }
      .coin-jar-rim{
        height:12px;
        background:linear-gradient(180deg,#A0896A 0%,#8B7355 100%);
        border-radius:6px 6px 0 0;
        border:2px solid #6B5340;
        margin-bottom:0;
        box-shadow:0 2px 4px rgba(0,0,0,.2);
      }
      #coin-canvas{display:block;}
      .coin-jar-label{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;letter-spacing:.08em;}
      .coin-combo-tag{font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);text-align:center;letter-spacing:.06em;margin-top:2px;}

      /* ── Outcome overlay ── */
      #cent-outcome{position:absolute;inset:0;z-index:20;background:rgba(245,240,232,.96);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;opacity:0;pointer-events:none;transition:opacity .35s ease;text-align:center;padding:2rem;}
      #cent-outcome.show{opacity:1;pointer-events:auto;}
      .cent-out-emoji{font-size:52px;}
      .cent-out-title{font-family:'Playfair Display',serif;font-size:26px;font-weight:900;color:var(--ink);}
      .cent-out-sub{font-size:13px;color:var(--muted);max-width:360px;line-height:1.65;}
      .cent-out-earn{font-family:'DM Mono',monospace;font-size:20px;font-weight:500;padding:8px 20px;border-radius:4px;}
      .cent-out-earn.win{color:var(--green);background:rgba(46,125,82,.1);border:1px solid rgba(46,125,82,.2);}
      .cent-out-earn.lose{color:var(--muted);background:rgba(26,22,18,.05);border:1px solid var(--border-solid);}
      .cent-out-cap{font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;border:1px solid var(--border-solid);padding:5px 14px;border-radius:2px;}
      .thinking-dots span{animation:blink 1.2s ease-in-out infinite;opacity:0;}
      .thinking-dots span:nth-child(2){animation-delay:.2s;}
      .thinking-dots span:nth-child(3){animation-delay:.4s;}
      @keyframes blink{0%,80%,100%{opacity:0;}40%{opacity:1;}}

      /* ── Right panel ── */
      .cent-right{width:252px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;}
      .cent-panel-sec{padding:13px 15px;border-bottom:1px solid var(--border);}
      .cent-panel-lbl{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}
      .cent-stat-big{font-family:'DM Mono',monospace;font-size:26px;font-weight:500;color:var(--ink);}
      .cent-stat-sub{font-size:11px;color:var(--muted);margin-top:2px;}
      .cent-hist-list{flex:1;overflow-y:auto;padding:8px 15px;}
      .cent-hist-item{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);animation:fadeUp .2s ease;}
      .cent-hist-node{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);min-width:32px;}
      .cent-hist-actor{font-size:12px;color:var(--ink);}
      .cent-hist-action{font-family:'DM Mono',monospace;font-size:11px;font-weight:500;padding:2px 7px;border-radius:2px;}
      .cent-hist-action.pass{background:rgba(46,125,82,.12);color:var(--green);}
      .cent-hist-action.take{background:rgba(192,57,43,.12);color:var(--red);}
    </style>

    <div id="cent-root">
      <div class="cent-main">

        <div class="cent-pot-area">
          <div class="cent-pot-label">Current Pot</div>
          <div class="cent-pot-val" id="cent-pot">$2.00</div>
          <div class="cent-pot-sub" id="cent-node-label">Node 1</div>
        </div>

        <div class="cent-payoffs" id="cent-payoffs">
          <div class="cent-payoff-card take-card">
            <div class="cent-payoff-title">If You Take</div>
            <div class="cent-payoff-you" id="cent-take-you">+$1.30</div>
            <div class="cent-payoff-opp" id="cent-take-opp">Opponent gets $0.70</div>
          </div>
          <div class="cent-payoff-arrow">→</div>
          <div class="cent-payoff-card pass-card">
            <div class="cent-payoff-title">If You Pass</div>
            <div class="cent-payoff-you" id="cent-pass-you">Pot grows to $2.50</div>
            <div class="cent-payoff-opp" id="cent-pass-opp">Opponent decides next</div>
          </div>
        </div>

        <div class="cent-actions">
          <button class="btn btn-red"   id="cent-take" disabled>&#x2715; Take</button>
          <button class="btn btn-green" id="cent-pass" disabled>&#x2192; Pass</button>
        </div>

        <div class="cent-position-badge" id="cent-pos-badge">Player 1 (moves first)</div>
        <div class="cent-status" id="cent-status">Ready</div>

        <!-- Coin jar -->
        <div class="coin-jar-section">
          <div class="coin-jar-rim" id="coin-jar-rim" style="width:320px;"></div>
          <div class="coin-jar-canvas-wrap" id="coin-jar-wrap">
            <canvas id="coin-canvas"></canvas>
          </div>
          <div class="coin-jar-label" id="coin-jar-label">Pot: $0.00</div>
          <div class="coin-combo-tag" id="coin-combo-tag">—</div>
        </div>

        <div id="cent-outcome">
          <div class="cent-out-emoji" id="cent-out-emoji">&#x1F91D;</div>
          <div class="cent-out-title" id="cent-out-title">Game Over</div>
          <div class="cent-out-sub"   id="cent-out-sub"></div>
          <div class="cent-out-earn"  id="cent-out-earn">+$0.00</div>
          <div class="cent-out-cap"   id="cent-out-cap"></div>
        </div>
      </div>

      <div class="cent-right">
        <div class="cent-panel-sec">
          <div class="cent-panel-lbl">Node</div>
          <div class="cent-stat-big" id="cent-node-big">1</div>
          <div class="cent-stat-sub" id="cent-node-sub">Game ends: 10–20 nodes</div>
        </div>
        <div class="cent-panel-sec">
          <div class="cent-panel-lbl">Your Position</div>
          <div class="cent-stat-big" id="cent-pos-big" style="font-size:18px;padding-top:4px;">Player 1</div>
          <div class="cent-stat-sub" id="cent-pos-sub">moves first</div>
        </div>
        <div class="cent-panel-sec">
          <div class="cent-panel-lbl">Split This Game</div>
          <div class="cent-stat-big" id="cent-split-display" style="font-size:18px;padding-top:4px;">—</div>
          <div class="cent-stat-sub">taker % / loser %</div>
        </div>
        <div class="cent-panel-sec" style="padding-bottom:7px;">
          <div class="cent-panel-lbl">Move History</div>
        </div>
        <div class="cent-hist-list" id="cent-hist"></div>
      </div>
    </div>`;
  },

  // ── Canvas setup ──────────────────────────────────────────
  _setupCanvas() {
    const W = 320, H = 240;
    const wrap = document.getElementById('coin-jar-wrap');
    const canvas = document.getElementById('coin-canvas');
    const rim    = document.getElementById('coin-jar-rim');
    canvas.width = W; canvas.height = H;
    wrap.style.width = W + 'px';
    if (rim) rim.style.width = W + 'px';
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
    const tag = document.getElementById('coin-combo-tag');
    if (tag) tag.textContent = 'Coins fall in with each pass';
  },

  // ── Coin physics ──────────────────────────────────────────
  // Real coin diameters (mm): dime=17.9, penny=19.1, nickel=21.2, quarter=24.3
  // Scaled proportionally: dime=12px, penny=13px, nickel=14px, quarter=16px radius
  _COIN_PROPS: {
    Q: { r:16, face:'#9B9EA8', edge:'#5A5D65', label:'25¢', labelSize:9  },
    D: { r:12, face:'#A8ABB5', edge:'#585A62', label:'10¢', labelSize:8  },
    N: { r:14, face:'#8E9090', edge:'#4A4C4C', label:'5¢',  labelSize:8  },
    P: { r:13, face:'#B5651D', edge:'#7A3A08', label:'1¢',  labelSize:8  },
  },

  // Pick a fresh random 50¢ combo for each pass
  _pickCombo() {
    return this._COIN_COMBOS[Math.floor(Math.random() * this._COIN_COMBOS.length)];
  },

  // Expand a combo into an array of coin type strings e.g. ['Q','D','N','N']
  _expandCombo(combo) {
    const coins = [];
    for (let i = 0; i < combo.q; i++) coins.push('Q');
    for (let i = 0; i < combo.d; i++) coins.push('D');
    for (let i = 0; i < combo.n; i++) coins.push('N');
    for (let i = 0; i < combo.p; i++) coins.push('P');
    // Shuffle so they fall in random order
    for (let i = coins.length-1; i > 0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [coins[i],coins[j]] = [coins[j],coins[i]];
    }
    return coins;
  },

  _spawnCoin(type, delayOffset) {
    const W = 320;
    const props = this._COIN_PROPS[type];
    const r = props.r;
    const doSpawn = () => {
      this._coins.push({
        type, r, props,
        x:  r + Math.random() * (W - 2*r),
        y:  -r - Math.random() * 8,
        vx: (Math.random() - 0.5) * 1.5,
        vy: 0.5 + Math.random() * 0.5,
        settled: false,
      });
    };
    if (delayOffset) setTimeout(doSpawn, delayOffset);
    else doSpawn();
  },

  // Drop all coins from a fresh randomly-chosen 50¢ combo, staggered in time
  _dropCombo() {
    const combo  = this._pickCombo();
    const coins  = this._expandCombo(combo);
    coins.forEach((type, i) => this._spawnCoin(type, i * 80));
    // Update jar label to show what was dropped
    const parts = [];
    if (combo.q) parts.push(combo.q + 'Q');
    if (combo.d) parts.push(combo.d + 'D');
    if (combo.n) parts.push(combo.n + 'N');
    if (combo.p) parts.push(combo.p + 'P');
    const tag = document.getElementById('coin-combo-tag');
    if (tag) tag.textContent = 'Dropped: ' + parts.join(' + ');
  },

  _physicsStep() {
    const W = 320, H = 240;
    const GRAVITY = 0.35, DAMPING = 0.55, FRICTION = 0.88;
    for (const c of this._coins) {
      if (c.settled) continue;
      c.vy += GRAVITY;
      c.x  += c.vx;
      c.y  += c.vy;
      c.rotation += c.rotV;

      // Walls
      if (c.x - c.r < 0)  { c.x = c.r;   c.vx = Math.abs(c.vx) * DAMPING; }
      if (c.x + c.r > W)  { c.x = W-c.r; c.vx = -Math.abs(c.vx) * DAMPING; }
      // Floor
      if (c.y + c.r > H)  {
        c.y = H - c.r; c.vy *= -DAMPING; c.vx *= FRICTION;
        c.rotV *= 0.7;
        if (Math.abs(c.vy) < 0.5 && Math.abs(c.vx) < 0.3) { c.settled = true; c.vy = 0; c.vx = 0; c.rotV = 0; }
      }
    }
    // Coin-coin collision
    for (let i = 0; i < this._coins.length; i++) {
      for (let j = i+1; j < this._coins.length; j++) {
        const a = this._coins[i], b = this._coins[j];
        if (a.settled && b.settled) continue;
        const dx = b.x-a.x, dy = b.y-a.y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        const md   = a.r + b.r;
        if (dist < md && dist > 0.001) {
          const nx = dx/dist, ny = dy/dist, ov = (md-dist)/2;
          if (!a.settled) { a.x -= nx*ov; a.y -= ny*ov; }
          if (!b.settled) { b.x += nx*ov; b.y += ny*ov; }
          const rv = (b.vx-a.vx)*nx + (b.vy-a.vy)*ny;
          if (rv < 0) {
            const imp = rv * 0.5;
            if (!a.settled) { a.vx += imp*nx; a.vy += imp*ny; }
            if (!b.settled) { b.vx -= imp*nx; b.vy -= imp*ny; }
          }
        }
      }
    }
  },

  _drawCoin(ctx, coin) {
    const { x, y, r, props } = coin;
    const edgeH = Math.max(3, Math.round(r * 0.22)); // edge height proportional to radius

    ctx.save();
    ctx.translate(x, y);

    // ── 3D edge (cylinder side) — drawn as a filled arc below the face ──
    ctx.beginPath();
    ctx.arc(0, edgeH, r, 0, Math.PI);         // bottom half arc offset down
    ctx.lineTo(-r, 0);
    ctx.arc(0, 0, r, Math.PI, 0);             // top half arc
    ctx.closePath();
    ctx.fillStyle = props.edge;
    ctx.fill();

    // ── Coin face — full circle, face-on ──
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);

    // Radial gradient: bright highlight top-left, darker bottom-right
    const grad = ctx.createRadialGradient(-r*0.30, -r*0.30, r*0.05, 0, 0, r);
    grad.addColorStop(0,   shiftBrightness(props.face,  55));  // bright highlight
    grad.addColorStop(0.4, shiftBrightness(props.face,  15));
    grad.addColorStop(0.8, props.face);
    grad.addColorStop(1,   shiftBrightness(props.face, -25));  // dark rim
    ctx.fillStyle = grad;
    ctx.fill();

    // ── Rim ring ──
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = shiftBrightness(props.edge, 20);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // ── Inner design ring ──
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // ── Denomination label ──
    ctx.fillStyle = 'rgba(0,0,0,0.60)';
    ctx.font = 'bold ' + props.labelSize + 'px "DM Mono",monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(props.label, 0, 0);

    ctx.restore();
  },

  _startPhysics() {
    const loop = () => {
      this._physicsStep();
      this._drawJar();
      this._animId = requestAnimationFrame(loop);
    };
    this._animId = requestAnimationFrame(loop);
  },

  _drawJar() {
    const ctx = this._ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, 320, 240);
    for (const c of this._coins) this._drawCoin(ctx, c);
  },

  // ── Events ────────────────────────────────────────────────
  _bindEvents() {
    document.getElementById('cent-take').addEventListener('click', () => this._playerAction('take'));
    document.getElementById('cent-pass').addEventListener('click', () => this._playerAction('pass'));
  },

  // ── Update UI ─────────────────────────────────────────────
  _updateUI() {
    const s   = this._state;
    const cfg = this._CONFIG;
    const el  = id => document.getElementById(id);

    el('cent-pot').textContent = '$' + s.pot.toFixed(2);
    el('cent-node-big').textContent = s.node;

    const actor = s.playerTurn ? 'Your turn' : "Opponent's turn";
    el('cent-node-label').textContent = 'Node ' + s.node + ' \xb7 ' + actor;

    // Position badge
    const posEl = el('cent-pos-badge');
    if (posEl) {
      const label = s.playerGoesFirst ? 'Player 1 (moves first)' : 'Player 2 (moves second)';
      posEl.textContent = label;
      posEl.className = 'cent-position-badge ' + (s.playerGoesFirst ? 'p1' : 'p2');
    }
    const posBig = el('cent-pos-big');
    if (posBig) posBig.textContent = s.playerGoesFirst ? 'Player 1' : 'Player 2';
    const posSub = el('cent-pos-sub');
    if (posSub) posSub.textContent = s.playerGoesFirst ? 'moves first' : 'moves second';

    // Split display
    const splitEl = el('cent-split-display');
    if (splitEl) splitEl.textContent = Math.round(s.takerShare*100) + '% / ' + Math.round(s.loserShare*100) + '%';

    // Payoffs — only show if hints on
    const payoffsEl = el('cent-payoffs');
    if (payoffsEl) payoffsEl.style.display = this._hintsEnabled ? 'flex' : 'none';
    if (this._hintsEnabled) {
      const takeYou = +(s.pot * s.takerShare).toFixed(2);
      const nextPot = +(s.pot + cfg.growthPerNode).toFixed(2);
      el('cent-take-you').textContent = '+$' + takeYou.toFixed(2);
      el('cent-take-opp').textContent = 'Opponent gets $' + (s.pot * s.loserShare).toFixed(2) + ' (' + Math.round(s.loserShare*100) + '%)';
      el('cent-pass-you').textContent = 'Pot grows to $' + nextPot.toFixed(2);
      el('cent-pass-opp').textContent = s.playerTurn ? 'Opponent decides next' : 'You decide next';
    }

    el('cent-take').disabled = !s.playerTurn || s.gameOver || s.animating;
    el('cent-pass').disabled = !s.playerTurn || s.gameOver || s.animating;

    const statusEl = el('cent-status');
    if (statusEl && s.playerTurn && !s.gameOver) {
      statusEl.textContent = 'Your move \u2014 Take or Pass?';
      statusEl.className = 'cent-status';
    }

    // Coin jar label
    const jarLbl = el('coin-jar-label');
    if (jarLbl) jarLbl.textContent = 'Pot: $' + s.pot.toFixed(2);
  },

  // ── Player action ─────────────────────────────────────────
  async _playerAction(action) {
    const s = this._state;
    if (!s.playerTurn || s.gameOver || s.animating) return;
    s.animating = true;
    document.getElementById('cent-take').disabled = true;
    document.getElementById('cent-pass').disabled = true;
    s.history.push({ node: s.node, actor: 'player', action, pot: s.pot });
    this._addHistItem(s.node, 'You', action, s.pot);
    if (action === 'take') await this._endGame('player-took');
    else await this._advanceNode();
  },

  // ── Advance node ──────────────────────────────────────────
  async _advanceNode() {
    const s   = this._state;
    const cfg = this._CONFIG;

    // Drop a fresh random 50¢ coin combo into the jar for this pass
    this._dropCombo();

    s.pot = +(s.pot + cfg.growthPerNode).toFixed(2);
    s.node++;
    if (s.node > s.cap) { await this._endGame('cap-reached'); return; }
    s.playerTurn = !s.playerTurn;
    s.animating  = false;

    const potEl = document.getElementById('cent-pot');
    if (potEl) { potEl.classList.add('grow'); setTimeout(() => potEl.classList.remove('grow'), 300); }

    this._updateUI();
    if (!s.playerTurn) await this._opponentTurn();
  },

  // ── Opponent turn ─────────────────────────────────────────
  async _opponentTurn() {
    const s = this._state;
    const statusEl = document.getElementById('cent-status');
    const thinkTime = 800 + Math.random() * 1200;
    if (statusEl) {
      statusEl.innerHTML = 'Opponent is thinking <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>';
      statusEl.className = 'cent-status opponent';
    }
    await this._delay(thinkTime);
    const action = Math.random() < this._academicTakeProb(s.node) ? 'take' : 'pass';
    s.history.push({ node: s.node, actor: 'opponent', action, pot: s.pot });
    this._addHistItem(s.node, 'Opponent', action, s.pot);
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'cent-status'; }
    if (action === 'take') await this._endGame('opponent-took');
    else await this._advanceNode();
  },

  // ── End game ──────────────────────────────────────────────
  async _endGame(outcome) {
    const s = this._state;
    s.gameOver = true; s.outcome = outcome;
    const takerPct = Math.round(s.takerShare*100);
    const loserPct = Math.round(s.loserShare*100);
    let emoji, title, sub, earnings;

    if (outcome === 'player-took') {
      earnings = +(s.pot * s.takerShare).toFixed(2);
      emoji = '\uD83D\uDCB0'; title = 'You took the pot';
      sub = 'You claimed ' + takerPct + '% of the $' + s.pot.toFixed(2) + ' pot at node ' + s.node + '. Your opponent received $' + (s.pot * s.loserShare).toFixed(2) + ' (' + loserPct + '%).';
    } else if (outcome === 'opponent-took') {
      earnings = +(s.pot * s.loserShare).toFixed(2);
      emoji = '\uD83D\uDE24'; title = 'Opponent took the pot';
      sub = 'Your opponent claimed ' + takerPct + '% at node ' + s.node + '. You received $' + earnings.toFixed(2) + ' (the ' + loserPct + '% loser share).';
    } else {
      earnings = +(s.pot / 2).toFixed(2);
      emoji = '\uD83E\uDD1D'; title = 'The game ended naturally';
      sub = 'Both players passed until node ' + s.cap + '. The pot splits equally — $' + earnings.toFixed(2) + ' each.';
    }
    s.earnings = earnings;

    const el = id => document.getElementById(id);
    el('cent-out-emoji').textContent = emoji;
    el('cent-out-title').textContent = title;
    el('cent-out-sub').textContent   = sub;
    el('cent-out-earn').textContent  = '+$' + earnings.toFixed(2);
    el('cent-out-earn').className    = 'cent-out-earn ' + (earnings > 0 ? 'win' : 'lose');
    el('cent-out-cap').textContent   = 'Secret stopping node was: ' + s.cap + ' \xb7 You were Player ' + s.playerPosition;

    // Drop one final combo as a flourish when the game ends
    this._dropCombo();

    await this._delay(300);
    el('cent-outcome').classList.add('show');
    await this._delay(600);
    this._shell.flashBalance(earnings);
    await this._delay(3200);
    this._shell.onGameComplete();
  },

  _addHistItem(node, actor, action, pot) {
    const list = document.getElementById('cent-hist');
    if (!list) return;
    const el = document.createElement('div');
    el.className = 'cent-hist-item';
    el.innerHTML = '<span class="cent-hist-node">N' + node + '</span>'
      + '<span class="cent-hist-actor">' + actor + '</span>'
      + '<span class="cent-hist-action ' + (action==='take'?'take':'pass') + '">' + (action==='take'?'\u2715 TAKE':'\u2192 PASS') + '</span>';
    list.insertBefore(el, list.firstChild);
  },

  getResults() {
    const s = this._state;
    const passes      = s.history.filter(h => h.action==='pass').length;
    const playerPasses= s.history.filter(h => h.actor==='player' && h.action==='pass').length;
    const exitNode    = s.node;
    const takerPct   = Math.round(s.takerShare*100);
    const loserPct   = Math.round(s.loserShare*100);
    const posLabel   = 'Player ' + s.playerPosition + ' (' + (s.playerGoesFirst ? 'first mover' : 'second mover') + ')';
    let title, profile, analysis;
    if (s.outcome === 'player-took') {
      if (exitNode <= 3) {
        title='Early Defector';profile='The Backward Inductor';
        analysis='You defected at node '+exitNode+' as '+posLabel+'. Only ~5% of players take this early in McKelvey & Palfrey data. The '+takerPct+'/'+loserPct+' split made early taking decisive.';
      } else if (exitNode <= 8) {
        title='Calculated Defector';profile='The Strategic Opportunist';
        analysis='You passed '+playerPasses+' time'+(playerPasses!==1?'s':'')+' before defecting at node '+exitNode+' ('+posLabel+'). The '+takerPct+'/'+loserPct+' split this game.';
      } else {
        title='Late Defector';profile='The Patient Maximizer';
        analysis='You cooperated to node '+exitNode+' as '+posLabel+' before taking. Secret cap was '+s.cap+'. The '+takerPct+'/'+loserPct+' split.';
      }
    } else if (s.outcome === 'opponent-took') {
      title='Betrayed';profile='The Trusting Cooperator';
      analysis='You passed '+playerPasses+' time'+(playerPasses!==1?'s':'')+' as '+posLabel+' — opponent defected at node '+exitNode+', leaving you with '+loserPct+'% ($'+s.earnings.toFixed(2)+').';
    } else {
      title='Full Cooperator';profile='The Altruistic Maximizer';
      analysis='Both players passed until node '+s.cap+' ('+posLabel+'). Fewer than 4% of games end this way experimentally. The '+takerPct+'/'+loserPct+' split made defection tempting throughout.';
    }
    return {
      title, profile, analysis,
      balanceDelta: s.earnings,
      stats: [
        { val: '+$' + s.earnings.toFixed(2),        label: 'Earnings' },
        { val: 'Node ' + exitNode,                   label: 'Game Ended' },
        { val: takerPct + '% / ' + loserPct + '%',  label: 'Taker / Loser Split' },
      ]
    };
  },

  getSubmissionData() {
    const s   = this._state;
    const cfg = this._CONFIG;
    const playerPasses   = s.history.filter(h => h.actor==='player'   && h.action==='pass').length;
    const opponentPasses = s.history.filter(h => h.actor==='opponent' && h.action==='pass').length;
    const moveSeq = s.history.map(h => h.action==='take'?'T':'P').join('');
    return {
      // ── Game configuration (snapshot at time of play) ──────
      config: {
        cap_min:            cfg.capMin,             // 10 — secret stopping node range
        cap_max:            cfg.capMax,             // 20
        starting_pot:       cfg.startingPot,        // $2.00
        growth_per_node:    cfg.growthPerNode,      // $0.50 per pass
        loser_share_mean:   0.25,                   // truncated normal mean
        loser_share_sd:     0.10,                   // truncated normal sd
        loser_share_min:    0,                      // bounds
        loser_share_max:    0.50,
      },
      // ── Random parameters drawn for this game ───────────────
      drawn_params: {
        secret_cap:         s.cap,                  // integer 10–20
        taker_split_pct:    s.takerShare,           // winner's share (full range: 0.50–1.0)
        loser_split_pct:    s.loserShare,           // loser's share  (full range: 0.0–0.50)
      },
      // ── Payoff structure ────────────────────────────────────
      payoffs: {
        taker_payoff:       +(s.pot * s.takerShare).toFixed(2),    // $ taker received
        loser_payoff:       +(s.pot * s.loserShare).toFixed(2),    // $ loser received
        cap_payoff_each:    +(s.pot / 2).toFixed(2),               // if game reaches cap
        final_pot:          +s.pot.toFixed(2),
      },
      // ── Opponent model ──────────────────────────────────────
      opponent_model: {
        type:               'academic_phase1',
        academic_a:         this._ACADEMIC_A,       // -3.2 (logistic intercept)
        academic_b:         this._ACADEMIC_B,       // 0.28 (logistic slope)
      },
      // ── Player behaviour ────────────────────────────────────
      is_first_mover:       s.playerGoesFirst,
      player_position:      s.playerPosition,
      num_passes_player:    playerPasses,
      num_passes_opponent:  opponentPasses,
      total_passes:         playerPasses + opponentPasses,
      player_won:           s.outcome === 'player-took' || s.outcome === 'cap-reached',
      player_took:          s.outcome === 'player-took',
      opponent_took:        s.outcome === 'opponent-took',
      reached_cap:          s.outcome === 'cap-reached',
      exit_node:            s.node,
      move_sequence:        moveSeq,
      total_earnings:       +s.earnings.toFixed(2),
    };
  },

  destroy() {
    if (this._animId) cancelAnimationFrame(this._animId);
    this._coins  = [];
    this._canvas = null;
    this._ctx    = null;
    this._state  = null;
    this._shell  = null;
    this._animId = null;
  },

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); },
};

// ── Coin colour helper (positive amt = lighten, negative = darken) ────────────
function shiftBrightness(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n>>16) + amt));
  const g = Math.min(255, Math.max(0, ((n>>8)&0xff) + amt));
  const b = Math.min(255, Math.max(0, (n&0xff) + amt));
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

GameRegistry.register(GameCentipede);
