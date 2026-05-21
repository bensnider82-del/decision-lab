/* ============================================================
   DECISION LAB — GAME MODULE
   Game:     Monty Hall
   ID:       monty_hall
   Category: theory

   MECHANICS:
   Each round, M is drawn randomly from {9, 16, 25, 36, 50}.
   Optimal n* = floor(√M), clamped to [3, max_doors].
   Prize = S(M) × (M − n*), scaled so E(optimal) = $100 always.
   Player picks n (3 to n*+2), selects a door, host opens n−2
   empty doors, player chooses to Stay or Switch.

   SCALARS S(M):
   M=9  → S=25.000  prize=$150.00  (n*=3, E=4)
   M=16 → S=11.111  prize=$133.33  (n*=4, E=9)
   M=25 → S=6.250   prize=$125.00  (n*=5, E=16)
   M=36 → S=4.000   prize=$120.00  (n*=6, E=25)
   M=50 → S=2.713   prize=$116.67  (n*=7, E≈36.86)

   OPTIMAL STRATEGY (proven):
   1. Choose n = n*(M) = floor(√M)
   2. Always switch — P(win|switch) = (n−1)/n > 1/n = P(win|stay)

   ACADEMIC REFERENCE:
   Selvin (1975) "A problem in probability" American Statistician.
   Granberg & Brown (1995) — only 13% of participants switch
   without instruction. With instruction, ~30% switch.
============================================================ */

const GameMontyHall = {
  id:        'monty_hall',
  name:      'Monty Hall',
  shortName: 'Monty Hall',
  category:  'theory',

  _CONFIG: {
    // M values and their precomputed scalars and optimal n
    M_OPTIONS: [
      { M:  9, nOpt: 3, S: 25,         prize: 150.00 },
      { M: 16, nOpt: 4, S: 100/9,      prize: 400/3  },
      { M: 25, nOpt: 5, S: 6.25,       prize: 125.00 },
      { M: 36, nOpt: 6, S: 4,          prize: 120.00 },
      { M: 50, nOpt: 7, S: 100/36.857, prize: 2.713*43 },
    ],
    MIN_DOORS: 3,
    MAX_DOOR_OFFSET: 2,  // player can pick up to nOpt + 2 doors
  },

  _state: null,
  _shell: null,
  _hintsEnabled: false,

  intro: {
    title: 'Monty Hall',
    desc:  'A prize is hidden behind one of N doors. Pick a door, watch the host open empty ones, then decide: stay with your choice or switch to the other closed door.',
    rules: [
      'Choose how many doors to play with (3 or more)',
      'Pick a door — a prize is hidden behind exactly one',
      'The host opens all empty doors except one other',
      'Stay with your door, or switch to the remaining closed one',
      'Your payoff depends on your door choice AND how many doors you picked',
      'There is a mathematically optimal number of doors — can you find it?',
    ],
  },

  mount(container, shellAPI, hintsEnabled) {
    this._hintsEnabled = !!hintsEnabled;
    this._shell        = shellAPI;

    // Draw random M for this session
    const opts = this._CONFIG.M_OPTIONS;
    const mEntry = opts[Math.floor(Math.random() * opts.length)];

    this._state = {
      mEntry,                          // full M config object
      nOpt:   mEntry.nOpt,            // optimal number of doors
      nMin:   this._CONFIG.MIN_DOORS,
      nMax:   mEntry.M,  // player can pick up to M doors
      n:      null,                    // player's chosen number of doors
      prize:  +mEntry.prize.toFixed(2),// scaled prize amount
      prizeDoor:  null,                // index of prize door (0-based)
      pickedDoor: null,                // player's initial pick
      openedDoors: [],                 // doors host opened
      finalDoor:   null,              // player's final door after stay/switch
      decision:    null,              // 'stay' | 'switch'
      won:         false,
      earnings:    0,
      phase: 'choose-n',              // 'choose-n' | 'pick-door' | 'reveal' | 'done'
    };

    container.innerHTML = this._html();
    this._bindEvents();
    this._renderChooseN();
    this._updateRightPanel();
  },

  // ── HTML ────────────────────────────────────────────────────
  _html() {
    const s = this._state;
    return `<style>
      #mh-root{display:flex;height:100%;overflow:hidden;font-family:'DM Sans',sans-serif;}
      .mh-main{flex:1;display:flex;flex-direction:column;background:var(--cream);overflow:hidden;}
      .mh-arena{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.2rem 2rem;gap:1rem;overflow:hidden;}

      /* Phase headings */
      .mh-phase-title{font-family:'Playfair Display',serif;font-size:20px;font-weight:700;color:var(--ink);text-align:center;}
      .mh-phase-sub{font-size:13px;color:var(--muted);text-align:center;max-width:420px;line-height:1.6;}

      /* N chooser */
      .mh-n-chooser{display:flex;align-items:center;gap:16px;}
      .mh-n-btn{width:36px;height:36px;border-radius:50%;border:1px solid var(--border-solid);background:var(--surface);font-size:18px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--ink);transition:all .15s;}
      .mh-n-btn:hover:not(:disabled){border-color:var(--gold);color:var(--gold);}
      .mh-n-btn:disabled{opacity:.3;cursor:not-allowed;}
      .mh-n-display{font-family:'DM Mono',monospace;font-size:48px;font-weight:500;color:var(--ink);min-width:60px;text-align:center;}
      .mh-n-label{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;text-align:center;}

      /* Doors */
      .mh-doors{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:680px;padding:4px;}
      /* Door base */
      .mh-door{width:72px;height:96px;border-radius:6px;border:2px solid var(--border-solid);background:var(--surface);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:all .2s;position:relative;flex-shrink:0;}
      .mh-door-icon{font-size:22px;}
      .mh-door-num{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);}
      /* sm: 8-14 doors */
      .mh-doors.sm .mh-door{width:54px;height:72px;gap:3px;}
      .mh-doors.sm .mh-door-icon{font-size:17px;}
      .mh-doors.sm .mh-door-num{font-size:10px;}
      /* xs: 15-24 doors */
      .mh-doors.xs .mh-door{width:40px;height:52px;border-radius:4px;gap:2px;}
      .mh-doors.xs .mh-door-icon{font-size:13px;}
      .mh-doors.xs .mh-door-num{font-size:9px;}
      /* xxs: 25+ doors */
      .mh-doors.xxs .mh-door{width:28px;height:38px;border-radius:3px;border-width:1px;gap:1px;}
      .mh-doors.xxs .mh-door-icon{font-size:10px;}
      .mh-doors.xxs .mh-door-num{font-size:8px;}
      .mh-door:hover:not(.opened):not(.disabled){border-color:var(--gold);transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.08);}
      .mh-door.picked{border-color:var(--gold);background:rgba(200,168,75,.08);}
      .mh-door.opened{border-color:var(--border);background:var(--border);opacity:.5;cursor:default;}
      .mh-door.winner{border-color:var(--green);background:rgba(46,125,82,.08);}
      .mh-door.loser{border-color:var(--red);background:rgba(192,57,43,.06);}
      .mh-door.switch-target{border-color:var(--ink);background:rgba(26,22,18,.04);}
      .mh-door.disabled{cursor:default;}
      .mh-door-badge{position:absolute;top:-8px;left:50%;transform:translateX(-50%);font-family:'DM Mono',monospace;font-size:9px;padding:2px 6px;border-radius:2px;white-space:nowrap;}
      .mh-door-badge.you{background:var(--gold);color:#fff;}
      .mh-door-badge.switch{background:var(--ink);color:#fff;}
      .mh-door-badge.prize{background:var(--green);color:#fff;}
      .mh-door-badge.empty{background:var(--muted);color:#fff;}

      /* Outcome */
      .mh-outcome-big{font-family:'DM Mono',monospace;font-size:36px;font-weight:500;padding:12px 28px;border-radius:4px;}
      .mh-outcome-big.win{color:var(--green);background:rgba(46,125,82,.08);border:1px solid rgba(46,125,82,.2);}
      .mh-outcome-big.lose{color:var(--muted);background:rgba(26,22,18,.04);border:1px solid var(--border-solid);}
      .mh-insight{font-size:12px;color:var(--muted);text-align:center;max-width:400px;line-height:1.7;font-style:italic;}

      /* Hint box */
      .mh-hint{background:rgba(200,168,75,.07);border:1px solid rgba(200,168,75,.25);border-radius:4px;padding:10px 16px;font-size:12px;color:var(--muted);text-align:center;max-width:400px;line-height:1.65;}
      .mh-hint strong{color:var(--gold);}

      /* Switch/Stay buttons */
      .mh-decision-row{display:flex;gap:16px;align-items:center;}
      .btn-stay{padding:12px 28px;border-radius:3px;border:1px solid var(--border-solid);background:var(--surface);font-size:14px;cursor:pointer;font-family:'DM Sans',sans-serif;color:var(--ink);}
      .btn-stay:hover{border-color:var(--ink);}

      /* Actions */
      .mh-actions{padding:12px 20px;border-top:1px solid var(--border);background:var(--surface);display:flex;gap:12px;justify-content:center;flex-shrink:0;}

      /* Right panel */
      .mh-right{width:236px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;}
      .mh-panel-sec{padding:13px 15px;border-bottom:1px solid var(--border);flex-shrink:0;}
      .mh-panel-lbl{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:5px;}
      .mh-stat-big{font-family:'DM Mono',monospace;font-size:26px;font-weight:500;color:var(--ink);}
      .mh-stat-sub{font-size:11px;color:var(--muted);margin-top:2px;}
      .mh-ev-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:12px;border-bottom:1px solid var(--border);}
      .mh-ev-label{color:var(--muted);}
      .mh-ev-val{font-family:'DM Mono',monospace;font-size:11px;color:var(--ink);}
      .mh-ev-val.opt{color:var(--gold);font-weight:500;}
    </style>

    <div id="mh-root">
      <div class="mh-main">
        <div class="mh-arena" id="mh-arena">
          <!-- content injected by phase renderers -->
        </div>
        <div class="mh-actions" id="mh-actions">
          <button class="btn btn-dark" id="mh-confirm-n" style="display:none;">Confirm — Play with <span id="mh-confirm-n-label">3</span> doors &rarr;</button>
          <button class="btn btn-dark" id="mh-switch-btn" style="display:none;">Switch Door</button>
          <button class="btn-stay"     id="mh-stay-btn"   style="display:none;">Stay</button>
          <button class="btn btn-dark" id="mh-finish-btn" style="display:none;">Finish &rarr;</button>
        </div>
      </div>

      <div class="mh-right">
        <div class="mh-panel-sec">
          <div class="mh-panel-lbl">Prize Value</div>
          <div class="mh-stat-big" id="mh-prize-display">$—</div>
          <div class="mh-stat-sub" id="mh-prize-sub">if your door has the prize</div>
        </div>
        <div class="mh-panel-sec">
          <div class="mh-panel-lbl">Your Door</div>
          <div class="mh-stat-big" id="mh-picked-display">—</div>
          <div class="mh-stat-sub" id="mh-picked-sub">not yet picked</div>
        </div>
        <div class="mh-panel-sec" style="flex:1;overflow-y:auto;">
          <div class="mh-panel-lbl" style="margin-bottom:8px;">Prize Value by n</div>
          <div id="mh-ev-table"></div>
        </div>
      </div>
    </div>`;
  },

  // ── Bind events ─────────────────────────────────────────────
  _bindEvents() {
    document.getElementById('mh-confirm-n').addEventListener('click',  () => this._confirmN());
    document.getElementById('mh-switch-btn').addEventListener('click', () => this._decide('switch'));
    document.getElementById('mh-stay-btn').addEventListener('click',   () => this._decide('stay'));
    document.getElementById('mh-finish-btn').addEventListener('click', () => this._finish());
  },

  // ── Phase 1: Choose N ────────────────────────────────────────
  _renderChooseN() {
    const s   = this._state;
    const cfg = this._CONFIG;
    s.n = s.nOpt; // default to optimal

    const arena = document.getElementById('mh-arena');
    arena.innerHTML = `
      <div class="mh-phase-title">How many doors?</div>
      <div class="mh-phase-sub">This round you can choose between <strong>${s.nMin}</strong> and <strong>${s.nMax}</strong> doors. More doors = higher prize, lower odds. There is a mathematically optimal number.</div>

      <div class="mh-n-chooser">
        <button class="mh-n-btn" id="mh-n-minus">−</button>
        <div>
          <div class="mh-n-display" id="mh-n-val">${s.n}</div>
          <div class="mh-n-label">doors</div>
        </div>
        <button class="mh-n-btn" id="mh-n-plus">+</button>
      </div>

      <div id="mh-hint-area"></div>`;

    // Wire stepper
    document.getElementById('mh-n-minus').addEventListener('click', () => this._stepN(-1));
    document.getElementById('mh-n-plus').addEventListener('click',  () => this._stepN(+1));

    // Show confirm button
    document.getElementById('mh-confirm-n').style.display = '';
    document.getElementById('mh-confirm-n-label').textContent = s.n;
    document.getElementById('mh-switch-btn').style.display = 'none';
    document.getElementById('mh-stay-btn').style.display   = 'none';
    document.getElementById('mh-finish-btn').style.display = 'none';

    this._updatePrizeForN();
    this._updateEVTable();
    this._renderHint();
  },

  _stepN(delta) {
    const s = this._state;
    const newN = Math.min(s.nMax, Math.max(s.nMin, s.n + delta));
    if (newN === s.n) return;
    s.n = newN;
    document.getElementById('mh-n-val').textContent = newN;
    document.getElementById('mh-confirm-n-label').textContent = newN;
    document.getElementById('mh-n-minus').disabled = newN <= s.nMin;
    document.getElementById('mh-n-plus').disabled  = newN >= s.nMax;
    this._updatePrizeForN();
    this._updateEVTable();
    this._renderHint();
  },

  _prizeForN(n) {
    // Scale the raw prize (M - n) by S(M)
    const s = this._state;
    return +((s.mEntry.M - n) * s.mEntry.S).toFixed(2);
  },

  _evForN(n) {
    // E = P(win|switch) × prize = ((n-1)/n) × prize
    return +(((n - 1) / n) * this._prizeForN(n)).toFixed(2);
  },

  _updatePrizeForN() {
    const s = this._state;
    const prize = this._prizeForN(s.n);
    s.prize = prize;
    const prizeEl = document.getElementById('mh-prize-display');
    if (prizeEl) prizeEl.textContent = '$' + prize.toFixed(2);
  },

  _updateEVTable() {
    const s   = this._state;
    const el  = document.getElementById('mh-ev-table');
    if (!el) return;
    var html = '';
    for (var n = s.nMin; n <= s.nMax; n++) {
      var prize   = this._prizeForN(n);
      var isOpt   = n === s.nOpt;
      var isCur   = n === s.n;
      var optCls  = (isOpt && this._hintsEnabled) ? ' opt' : '';
      var bg      = isCur ? 'background:rgba(200,168,75,.08);border-radius:3px;' : '';
      html += '<div class="mh-ev-row" style="' + bg + '">' +
        '<span class="mh-ev-label">n=' + n + (isOpt && this._hintsEnabled ? ' ★ optimal' : '') + '</span>' +
        '<span class="mh-ev-val' + optCls + '">$' + prize.toFixed(2) + '</span>' +
        '</div>';
    }
    el.innerHTML = html;
  },

  _renderHint() {
    const s  = this._state;
    const el = document.getElementById('mh-hint-area');
    if (!el) return;
    if (!this._hintsEnabled) { el.innerHTML = ''; return; }
    const ev    = this._evForN(s.n);
    const evOpt = this._evForN(s.nOpt);
    const pSwitch = (((s.n - 1) / s.n) * 100).toFixed(1);
    el.innerHTML = `<div class="mh-hint">
      <strong>Hints on:</strong> With n=${s.n}, prize = $${this._prizeForN(s.n).toFixed(2)}.
      P(win|switch) = ${pSwitch}% → EV = <strong>$${ev.toFixed(2)}</strong>.
      Optimal n = <strong>${s.nOpt}</strong> (EV = $${evOpt.toFixed(2)}).
    </div>`;
  },

  // ── Phase 2: Confirm N, pick a door ─────────────────────────
  _confirmN() {
    const s = this._state;
    s.phase = 'pick-door';

    // Assign prize door randomly
    s.prizeDoor  = Math.floor(Math.random() * s.n);
    s.pickedDoor = null;
    s.openedDoors = [];

    const arena = document.getElementById('mh-arena');
    arena.innerHTML = `
      <div class="mh-phase-title">Pick a door</div>
      <div class="mh-phase-sub">${s.n} doors, one prize. Choose any door.</div>
      <div class="mh-doors" id="mh-doors-wrap"></div>
      <div id="mh-hint-area"></div>`;

    document.getElementById('mh-confirm-n').style.display = 'none';

    this._renderDoors();
    this._updateRightPanel();
  },

  // ── Phase 3: Reveal empty doors ──────────────────────────────
  _pickDoor(i) {
    const s = this._state;
    if (s.phase !== 'pick-door') return;
    s.pickedDoor = i;
    s.phase = 'reveal';

    // Host opens n-2 doors: all except picked and prize door
    const candidates = [];
    for (let d = 0; d < s.n; d++) {
      if (d !== s.pickedDoor && d !== s.prizeDoor) candidates.push(d);
    }
    // Shuffle and take n-2
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    s.openedDoors = candidates.slice(0, s.n - 2);

    // Update right panel
    const pickedEl = document.getElementById('mh-picked-display');
    const pickedSub = document.getElementById('mh-picked-sub');
    if (pickedEl) pickedEl.textContent = 'Door ' + (i + 1);
    if (pickedSub) pickedSub.textContent = 'your initial pick';

    // Re-render doors + show switch/stay
    this._renderDoors();

    const arena = document.getElementById('mh-arena');
    const sub = arena.querySelector('.mh-phase-sub');
    if (sub) {
      const opened = s.openedDoors.length;
      sub.textContent = opened === 1
        ? `The host opened 1 empty door. Stay with Door ${i + 1} or switch to the other closed door?`
        : `The host opened ${opened} empty doors. Stay with Door ${i + 1} or switch to the other closed door?`;
    }
    const title = arena.querySelector('.mh-phase-title');
    if (title) title.textContent = 'Stay or Switch?';

    document.getElementById('mh-switch-btn').style.display = '';
    document.getElementById('mh-stay-btn').style.display   = '';

    if (this._hintsEnabled) {
      const hintEl = document.getElementById('mh-hint-area');
      if (hintEl) {
        const pStay   = (1 / s.n * 100).toFixed(1);
        const pSwitch = ((s.n - 1) / s.n * 100).toFixed(1);
        hintEl.innerHTML = `<div class="mh-hint">
          <strong>Hints on:</strong>
          P(win | stay) = ${pStay}% &nbsp;·&nbsp;
          P(win | switch) = ${pSwitch}%.
          Switching gives <strong>${((s.n-1)/1).toFixed(0)}×</strong> better odds.
        </div>`;
      }
    }
    this._updateEVTable();
  },

  // ── Phase 4: Decision ────────────────────────────────────────
  _decide(decision) {
    const s = this._state;
    if (s.phase !== 'reveal') return;
    s.decision = decision;

    // Determine final door
    if (decision === 'stay') {
      s.finalDoor = s.pickedDoor;
    } else {
      // Switch to the one closed, non-picked door
      for (let d = 0; d < s.n; d++) {
        if (d !== s.pickedDoor && !s.openedDoors.includes(d)) {
          s.finalDoor = d;
          break;
        }
      }
    }

    s.won      = s.finalDoor === s.prizeDoor;
    s.earnings = s.won ? s.prize : 0;

    // Hide stay/switch buttons immediately
    document.getElementById('mh-switch-btn').style.display = 'none';
    document.getElementById('mh-stay-btn').style.display   = 'none';

    // Update arena message
    const sub = document.querySelector('.mh-phase-sub');
    if (sub) sub.textContent = decision === 'switch'
      ? 'Switched to Door ' + (s.finalDoor + 1) + '. Opening all doors...'
      : 'Staying with Door ' + (s.finalDoor + 1) + '. Opening all doors...';

    // ── Animated reveal ──────────────────────────────────────
    // Build list of doors to reveal in sequence (all except finalDoor)
    const toReveal = [];
    for (let d = 0; d < s.n; d++) {
      if (d !== s.finalDoor) toReveal.push(d);
    }
    // Shuffle reveal order for drama
    for (let i = toReveal.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [toReveal[i], toReveal[j]] = [toReveal[j], toReveal[i]];
    }

    // First mark final door with decision badge
    this._renderDoorsReveal([], decision);

    // Reveal doors one by one
    let step = 0;
    const revealNext = () => {
      if (step < toReveal.length) {
        const revealed = toReveal.slice(0, step + 1);
        this._renderDoorsReveal(revealed, decision);
        step++;
        setTimeout(revealNext, 320);
      } else {
        // All revealed — set phase and show full outcome
        s.phase = 'done';
        this._renderDoors();
        this._renderOutcome();
        this._shell.flashBalance(s.earnings);
        this._updateRightPanel();
        document.getElementById('mh-finish-btn').style.display = '';
      }
    };
    setTimeout(revealNext, 300);
  },

  // Intermediate render during reveal animation
  _renderDoorsReveal(revealedSoFar, decision) {
    const s    = this._state;
    const wrap = document.getElementById('mh-doors-wrap');
    if (!wrap) return;
    wrap.className = 'mh-doors ' + this._doorSizeClass(s.n);
    wrap.innerHTML = '';
    for (let i = 0; i < s.n; i++) {
      const isRevealed = revealedSoFar.includes(i);
      const isFinal    = i === s.finalDoor;
      const isPrize    = i === s.prizeDoor;
      const div        = document.createElement('div');
      div.className    = 'mh-door disabled';

      if (isFinal) div.classList.add('picked');

      let icon = '🚪';
      if (isRevealed) {
        icon = isPrize ? '🏆' : '✗';
        div.classList.add(isPrize ? 'winner' : 'opened');
      }

      div.innerHTML = '<div class="mh-door-icon">' + icon + '</div>' +
                      '<div class="mh-door-num">Door ' + (i + 1) + '</div>';

      if (isFinal) {
        const b = document.createElement('div');
        b.className   = 'mh-door-badge you';
        b.textContent = s.decision === 'switch' ? 'SWITCHED' : 'STAYED';
        div.appendChild(b);
      }
      wrap.appendChild(div);
    }
  },


  _doorSizeClass(n) {
    if (n >= 25) return 'xxs';
    if (n >= 15) return 'xs';
    if (n >= 8)  return 'sm';
    return '';
  },
  // ── Render doors ────────────────────────────────────────────
  _renderDoors() {
    const s   = this._state;
    const wrap = document.getElementById('mh-doors-wrap');
    if (!wrap) return;
    wrap.className = 'mh-doors ' + this._doorSizeClass(s.n);
    wrap.innerHTML = '';
    for (let i = 0; i < s.n; i++) {
      const isOpened = s.openedDoors.includes(i);
      const isPicked = i === s.pickedDoor;
      const isFinal  = i === s.finalDoor && s.phase === 'done';
      const isPrize  = i === s.prizeDoor && s.phase === 'done';
      const isSwitchTarget = s.phase === 'reveal' &&
        i !== s.pickedDoor && !isOpened;

      const div = document.createElement('div');
      div.className = 'mh-door';
      if (isOpened)        div.classList.add('opened');
      if (isPicked && !isFinal) div.classList.add('picked');
      if (isSwitchTarget)  div.classList.add('switch-target');
      if (isFinal && s.won)  div.classList.add('winner');
      if (isFinal && !s.won) div.classList.add('loser');

      const isClickable = s.phase === 'pick-door' && !isOpened;
      if (isClickable) {
        div.style.cursor = 'pointer';
        div.addEventListener('click', () => this._pickDoor(i));
      } else {
        div.classList.add('disabled');
      }

      // Icon
      let icon = '🚪';
      if (isOpened)         icon = '✗';
      if (isPrize)          icon = s.won ? '🏆' : '🏆';
      if (isFinal && !s.won) icon = '✗';

      div.innerHTML = `
        <div class="mh-door-icon">${icon}</div>
        <div class="mh-door-num">Door ${i + 1}</div>`;

      // Badges
      if (isPicked && s.phase !== 'done') {
        const b = document.createElement('div');
        b.className = 'mh-door-badge you';
        b.textContent = 'YOU';
        div.appendChild(b);
      }
      if (isSwitchTarget) {
        const b = document.createElement('div');
        b.className = 'mh-door-badge switch';
        b.textContent = 'SWITCH?';
        div.appendChild(b);
      }
      if (s.phase === 'done') {
        const b = document.createElement('div');
        b.className = 'mh-door-badge ' + (isPrize ? 'prize' : 'empty');
        b.textContent = isPrize ? 'PRIZE' : 'EMPTY';
        div.appendChild(b);
        if (i === s.finalDoor) {
          const b2 = document.createElement('div');
          b2.className = 'mh-door-badge you';
          b2.style.top = 'auto';
          b2.style.bottom = '-8px';
          b2.textContent = s.decision === 'switch' ? 'SWITCHED' : 'STAYED';
          div.appendChild(b2);
        }
      }

      wrap.appendChild(div);
    }
  },

  // ── Outcome display ──────────────────────────────────────────
  _renderOutcome() {
    const s     = this._state;
    const arena = document.getElementById('mh-arena');

    // Replace sub text with outcome
    const sub = arena.querySelector('.mh-phase-sub');
    if (sub) sub.remove();
    const title = arena.querySelector('.mh-phase-title');
    if (title) title.textContent = s.won ? 'You found the prize!' : 'No prize behind that door.';

    // Insert outcome elements before doors
    const doorsWrap = document.getElementById('mh-doors-wrap');

    const outcomeEl = document.createElement('div');
    outcomeEl.className = 'mh-outcome-big ' + (s.won ? 'win' : 'lose');
    outcomeEl.textContent = s.won ? '+$' + s.earnings.toFixed(2) : '$0.00';
    doorsWrap.before(outcomeEl);

    // Insight
    const pSwitch = +((s.n - 1) / s.n * 100).toFixed(1);
    const pStay   = +(1 / s.n * 100).toFixed(1);
    let insight = '';
    if (s.decision === 'switch' && s.won) {
      insight = `Switching paid off! With ${s.n} doors, switching wins ${pSwitch}% of the time. Staying only wins ${pStay}%. You made the mathematically correct call.`;
    } else if (s.decision === 'switch' && !s.won) {
      insight = `Bad luck — but switching was still the right strategy. With ${s.n} doors, switching wins ${pSwitch}% of the time vs ${pStay}% for staying. The math was on your side.`;
    } else if (s.decision === 'stay' && s.won) {
      insight = `You got lucky staying! But note: switching wins ${pSwitch}% of the time with ${s.n} doors, versus only ${pStay}% for staying. You beat the odds this time.`;
    } else {
      insight = `Staying rarely wins with many doors. Switching would have won ${pSwitch}% of the time here — ${Math.round(pSwitch / pStay)}× better odds than staying.`;
    }
    const insightEl = document.createElement('div');
    insightEl.className = 'mh-insight';
    insightEl.textContent = insight;
    doorsWrap.after(insightEl);
  },

  // ── Right panel ──────────────────────────────────────────────
  _updateRightPanel() {
    const s = this._state;
    const prizeEl = document.getElementById('mh-prize-display');
    if (prizeEl) prizeEl.textContent = '$' + this._prizeForN(s.n || s.nOpt).toFixed(2);
    this._updateEVTable();
  },

  // ── Finish ───────────────────────────────────────────────────
  _finish() {
    this._shell.onGameComplete();
  },

  // ── getResults ───────────────────────────────────────────────
  getResults() {
    const s = this._state;
    const optN = s.nOpt;
    const choseOptN = s.n === optN;
    const switched  = s.decision === 'switch';

    let title, profile, analysis;
    if (choseOptN && switched && s.won) {
      title = 'Perfect Strategy'; profile = 'The Bayesian Thinker';
      analysis = `Optimal doors (n=${s.n}) and switched — the mathematically dominant play. With ${s.n} doors you had a ${((s.n-1)/s.n*100).toFixed(0)}% chance of winning by switching, versus ${(1/s.n*100).toFixed(0)}% by staying.`;
    } else if (switched) {
      title = 'Correct Instinct'; profile = 'The Switcher';
      analysis = `You switched, which is always the right call in Monty Hall. P(win|switch) = ${((s.n-1)/s.n*100).toFixed(0)}% with ${s.n} doors. ${choseOptN ? 'You also chose the optimal number of doors.' : `The optimal door count was n=${optN}.`}`;
    } else {
      title = 'The Stayer'; profile = 'Intuition Over Math';
      analysis = `You stayed, which wins only ${(1/s.n*100).toFixed(0)}% of the time with ${s.n} doors. Switching would have won ${((s.n-1)/s.n*100).toFixed(0)}% of the time — Granberg & Brown (1995) found only 13% of people switch without instruction.`;
    }

    return {
      title, profile, analysis,
      balanceDelta: s.earnings,
      stats: [
        { val: String(s.n),         label: 'Doors Chosen' },
        { val: String(s.decision === 'switch' ? 'Switch' : 'Stay'), label: 'Decision' },
        { val: s.won ? 'Won' : 'Lost', label: 'Outcome' },
      ],
    };
  },

  // ── getSubmissionData ────────────────────────────────────────
  getSubmissionData() {
    const s   = this._state;
    const me  = s.mEntry;
    return {
      config: {
        M:             me.M,
        n_optimal:     me.nOpt,
        scalar_S:      +me.S.toFixed(4),
        min_doors:     this._CONFIG.MIN_DOORS,
        max_doors:     s.nMax,
      },
      payoffs: {
        prize_if_win:  +s.prize.toFixed(2),
        prize_if_lose: 0,
        ev_if_switch:  +this._evForN(s.n).toFixed(2),
        ev_if_stay:    +(s.prize / s.n).toFixed(2),
      },
      drawn_params: {
        prize_door:    s.prizeDoor,
        prize_value:   +s.prize.toFixed(2),
      },
      player_choices: {
        n_chosen:      s.n,
        chose_optimal_n: s.n === me.nOpt,
        initial_door:  s.pickedDoor,
        decision:      s.decision,
        final_door:    s.finalDoor,
        switched:      s.decision === 'switch',
      },
      outcome: {
        won:           s.won,
        earnings:      +s.earnings.toFixed(2),
      },
    };
  },

  destroy() {
    this._state = null;
    this._shell = null;
  },
};

GameRegistry.register(GameMontyHall);
