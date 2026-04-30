const GameDuel = {
  id:        'duel',
  name:      'The Duel',
  shortName: 'The Duel',
  category:  'theory',

  _CONFIG: {
    rounds:          10,
    hitProbStep:     0.10,
    hitPayoff:       20,
    missPayoff:     -10,
    shotPayoff:     -10,
    impatienceMin:   1.1,
    impatienceMax:   1.5,
    roundsPerSession:5,
  },

  _state:        null,
  _shell:        null,
  _hintsEnabled: false,
  _animId:       null,
  _bullets:      [],
  _canvas:       null,
  _ctx:          null,

  intro: {
    title: 'The Duel',
    desc:  'You and an opponent face off. Each round you can Shoot or Wait. The longer you wait, the more accurate your shot — but your opponent is doing the same calculation.',
    rules: [
      'Each round: choose Shoot or Wait simultaneously with your opponent',
      'Hit probability starts at 10% and rises by 10% each round',
      'Shoot and hit: +$20  |  Shoot and miss: -$10',
      'If your opponent shoots and hits you: -$10',
      'Both wait: cowboys step closer, accuracy increases',
      'Game ends when someone shoots, or after round 10',
    ]
  },

  mount(container, shellAPI, hintsEnabled) {
    this._hintsEnabled = !!hintsEnabled;
    this._shell        = shellAPI;
    this._bullets      = [];
    const cfg          = this._CONFIG;
    const impatience   = cfg.impatienceMin + Math.random() * (cfg.impatienceMax - cfg.impatienceMin);

    this._state = {
      round:              1,
      gameRound:          1,
      totalGames:         cfg.roundsPerSession,
      hitProb:            cfg.hitProbStep,
      gameOver:           false,
      impatience,
      history:            [],
      gameHistory:        [],
      totalEarnings:      0,
      animating:          false,
      waitingForOpponent: false,
      // cowboy positions: 0=far apart, 9=almost touching
      stepsTaken:         0,
      youDefeated:        false,
      oppDefeated:        false,
      duelLog:            [],   // per-duel records for getSubmissionData()
    };

    container.innerHTML = this._html();
    this._setupCanvas();
    this._bindEvents();
    this._startLoop();
    this._updateUI();
  },

  // ── SVG cowboy drawing helpers ─────────────────────────────────
  // Returns SVG string for a cowboy. type='hero'|'villain', pose='idle'|'shoot'|'defeated'
  // All drawn facing RIGHT. Villain is flipped via transform.
  _cowboySVG(type, pose) {
    const isHero    = type === 'hero';
    const coat      = isHero ? '#7A4A22' : '#2A4060';
    const coatD     = isHero ? '#5A3010' : '#182840';
    const pants     = isHero ? '#3A5080' : '#5A3A1A';
    const hatFill   = isHero ? '#3D2810' : '#1A1A1A';
    const bandFill  = isHero ? '#8B0000' : '#C8A030';
    const shirt     = isHero ? '#D4C090' : '#90A8C0';
    const bandana   = isHero ? '#8B0000' : '#1A2840';
    const skin      = '#E8B88A';
    const skinD     = '#C89060';
    const boot      = '#1A0E06';
    const gun       = '#2A2A2A';
    const gunGrip   = isHero ? '#4A3520' : '#C0B080';
    const spur      = '#888060';
    const star      = '#C8A030';

    // Arm/gun position based on pose
    // idle: arm at side. shoot: arm raised with gun pointed skyward. defeated: arm down, gun dropped
    const shootArm = pose === 'shoot';
    const defeated  = pose === 'defeated';

    let armPath, gunGroup;
    if (shootArm) {
      // Right arm raised — fluid path from shoulder up to hand
      armPath = `
        <path d="M26,148 C38,138 52,114 58,88 C61,76 59,66 56,62 C52,57 46,60 42,68 C36,82 30,112 27,138 Z" fill="${coat}"/>
        <path d="M50,92 C54,78 58,63 60,51 C62,43 64,38 66,35 C70,29 76,27 78,31 C80,35 78,43 74,53 C70,63 62,80 56,92 Z" fill="${coat}"/>
        <ellipse cx="66" cy="43" rx="12" ry="10" fill="${skin}"/>
      `;
      gunGroup = `
        <g transform="translate(66,31)">
          <rect x="-3" y="-52" width="7" height="52" rx="2.5" fill="${gun}"/>
          <rect x="-4" y="-54" width="9" height="6" rx="1.5" fill="#1A1A1A"/>
          <rect x="-5" y="-2" width="11" height="20" rx="2.5" fill="${gun}"/>
          <path d="M-5,5 Q-12,14 -5,24" stroke="#222" stroke-width="2.5" fill="none"/>
          <rect x="-5" y="18" width="12" height="22" rx="3" fill="${gunGrip}"/>
          <ellipse cx="0" cy="2" rx="7" ry="5" fill="#333"/>
          <rect x="4" y="-5" width="6" height="10" rx="2" fill="#1A1A1A"/>
          <rect x="-1" y="-54" width="2" height="5" rx="1" fill="#555"/>
        </g>
      `;
    } else if (defeated) {
      // Arm drooping, cowboy slumped
      armPath = `
        <path d="M26,148 C30,158 32,178 30,200 C29,210 24,215 20,216 C16,217 12,214 12,206 C12,196 18,172 22,155 Z" fill="${coat}"/>
        <ellipse cx="18" cy="212" rx="9" ry="10" fill="${skin}"/>
      `;
      gunGroup = '';
    } else {
      // Idle: arm at side
      armPath = `
        <path d="M26,148 C30,158 32,178 30,205 C29,215 24,220 20,221 C16,222 12,220 12,212 C12,200 18,175 22,158 Z" fill="${coat}"/>
        <ellipse cx="18" cy="217" rx="10" ry="11" fill="${skin}"/>
        <rect x="10" y="219" width="7" height="13" rx="3" fill="${skin}"/>
        <rect x="16" y="221" width="7" height="14" rx="3" fill="${skin}"/>
        <rect x="22" y="221" width="7" height="12" rx="3" fill="${skin}"/>
      `;
      gunGroup = '';
    }

    // Left arm always at side
    const leftArm = `
      <path d="M-26,148 C-38,156 -44,178 -42,205 C-41,215 -36,220 -30,221 C-24,222 -18,220 -16,212 C-14,200 -18,175 -22,158 Z" fill="${coat}"/>
      <ellipse cx="-30" cy="217" rx="10" ry="11" fill="${skin}"/>
      <rect x="-38" y="219" width="7" height="13" rx="3" fill="${skin}"/>
      <rect x="-32" y="221" width="7" height="14" rx="3" fill="${skin}"/>
      <rect x="-26" y="221" width="7" height="12" rx="3" fill="${skin}"/>
    `;

    // Head tilt based on defeat
    const headTransform = defeated ? 'rotate(20, 0, 90)' : '';
    // Eye expression
    const eyeL = defeated ? `<ellipse cx="-10" cy="80" rx="7" ry="3" fill="#FFFFF0"/><circle cx="-9" cy="81" r="3" fill="#2A1808"/>` :
                            `<ellipse cx="-10" cy="80" rx="7" ry="5" fill="#FFFFF0"/><circle cx="-9" cy="81" r="4" fill="#2A1808"/>`;
    const eyeR = defeated ? `<ellipse cx="10" cy="80" rx="7" ry="3" fill="#FFFFF0"/><circle cx="10" cy="81" r="3" fill="#2A1808"/>` :
                            `<ellipse cx="10" cy="80" rx="7" ry="5" fill="#FFFFF0"/><circle cx="10" cy="81" r="4" fill="#2A1808"/>`;
    const mouth = defeated
      ? `<path d="M-10,110 Q0,106 10,110" stroke="#8B5030" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
      : isHero
        ? `<path d="M-10,107 Q0,111 10,107" stroke="#8B5030" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
        : `<path d="M-10,107 Q-2,105 10,110" stroke="#7A3020" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;

    const badge = isHero ? `<polygon points="-22,162 -20,156 -18,162 -12,162 -17,166 -15,172 -20,168 -25,172 -23,166 -28,162" fill="${star}"/>` : '';
    const villainScar = !isHero ? `<line x1="-8" y1="95" x2="-12" y2="104" stroke="#C08060" stroke-width="1.5" opacity="0.5"/>` : '';
    const hatCrown = isHero
      ? `<rect x="-27" y="18" width="54" height="42" rx="7" fill="${hatFill}"/><rect x="-11" y="18" width="22" height="10" rx="3" fill="#2A1808"/>`
      : `<rect x="-26" y="12" width="52" height="48" rx="5" fill="${hatFill}"/><line x1="-10" y1="12" x2="-10" y2="32" stroke="#2A2A2A" stroke-width="2"/><line x1="10" y1="12" x2="10" y2="32" stroke="#2A2A2A" stroke-width="2"/>`;

    return `
      <ellipse cx="0" cy="362" rx="42" ry="8" fill="#A89068" opacity="0.45"/>
      <rect x="-28" y="318" width="22" height="46" rx="5" fill="${boot}"/>
      <rect x="6"   y="318" width="23" height="46" rx="5" fill="${boot}"/>
      <ellipse cx="-17" cy="362" rx="13" ry="6" fill="${boot}"/>
      <ellipse cx="18"  cy="362" rx="13" ry="6" fill="${boot}"/>
      <rect x="-30" y="343" width="8" height="10" rx="2" fill="${boot}" opacity="0.7"/>
      <rect x="22"  y="343" width="8" height="10" rx="2" fill="${boot}" opacity="0.7"/>
      <circle cx="-28" cy="354" r="5" fill="${spur}"/>
      <line x1="-34" y1="354" x2="-22" y2="354" stroke="${spur}" stroke-width="1.5"/>
      <circle cx="29" cy="354" r="5" fill="${spur}"/>
      <line x1="23" y1="354" x2="35" y2="354" stroke="${spur}" stroke-width="1.5"/>
      <rect x="-24" y="238" width="20" height="88" rx="7" fill="${pants}"/>
      <rect x="4"   y="238" width="20" height="88" rx="7" fill="${pants}"/>
      <rect x="-26" y="232" width="52" height="11" rx="3" fill="#2A1808"/>
      <rect x="-8"  y="234" width="16" height="7" rx="2" fill="${star}"/>
      <rect x="19"  y="239" width="11" height="22" rx="3" fill="${coatD}"/>
      <rect x="-28" y="138" width="56" height="100" rx="9" fill="${coat}"/>
      <polygon points="-28,138 -10,138 -16,182 -28,188" fill="${coatD}"/>
      <polygon points="28,138 10,138 16,182 28,188" fill="${coatD}"/>
      <rect x="-9" y="140" width="18" height="42" rx="3" fill="${shirt}"/>
      ${badge}
      <rect x="-28" y="218" width="23" height="20" rx="4" fill="${coat}"/>
      <rect x="5"   y="218" width="23" height="20" rx="4" fill="${coat}"/>
      ${leftArm}
      ${armPath}
      ${gunGroup}
      <rect x="-8" y="115" width="16" height="28" rx="5" fill="${skin}"/>
      <polygon points="-11,117 11,117 3,138 -3,138" fill="${bandana}"/>
      <polygon points="-5,132 5,132 1,146 -1,146" fill="${bandana}"/>
      <g transform="${headTransform}">
        <ellipse cx="0" cy="88" rx="32" ry="34" fill="${skin}"/>
        <ellipse cx="-31" cy="88" rx="8" ry="10" fill="${skin}"/>
        <ellipse cx="31"  cy="88" rx="8" ry="10" fill="${skin}"/>
        <ellipse cx="0"   cy="115" rx="20" ry="8" fill="${skin}"/>
        <path d="M-15,70 Q-8,65 -4,70" stroke="#5A3010" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <path d="M4,70 Q8,65 15,70"   stroke="#5A3010" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        ${eyeL}
        ${eyeR}
        <circle cx="-7" cy="79" r="1.5" fill="white"/>
        <circle cx="12" cy="79" r="1.5" fill="white"/>
        <ellipse cx="0" cy="92" rx="5" ry="4" fill="${skinD}"/>
        <circle cx="-3" cy="94" r="2" fill="${skinD}"/>
        <circle cx="3"  cy="94" r="2" fill="${skinD}"/>
        ${mouth}
        ${villainScar}
        <ellipse cx="0" cy="58" rx="43" ry="9" fill="${hatFill}"/>
        ${hatCrown}
        <rect x="-26" y="53" width="52" height="8" fill="${bandFill}"/>
      </g>
    `;
  },

  // ── HTML ───────────────────────────────────────────────────────
  _html() {
    return `<style>
      #duel-root{display:flex;height:100%;overflow:hidden;font-family:'DM Sans',sans-serif;}
      .duel-main{flex:1;display:flex;flex-direction:column;position:relative;overflow:hidden;background:var(--cream);}

      /* Arena fills most of left panel */
      .duel-arena-wrap{flex:1;position:relative;overflow:hidden;}
      #duel-arena-svg{width:100%;height:100%;}

      /* Probability bg text */
      #duel-prob-bg{
        position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        pointer-events:none;z-index:0;
      }
      #duel-prob-bg-text{
        font-family:'DM Mono',monospace;font-weight:700;
        color:#C0392B;opacity:0.13;line-height:1;
        transition:font-size .4s ease, opacity .3s ease;
        font-size:200px;
        user-select:none;
      }

      /* Status overlay in arena */
      #duel-arena-status{
        position:absolute;top:14px;left:0;right:0;
        text-align:center;z-index:5;pointer-events:none;
        font-family:'DM Mono',monospace;font-size:13px;color:var(--muted);
        letter-spacing:.04em;
      }
      #duel-arena-status.thinking{color:var(--gold);}

      /* Bullet canvas */
      #duel-bullet-canvas{
        position:absolute;inset:0;pointer-events:none;z-index:4;
      }

      /* Player name labels */
      .duel-name-you{
        position:absolute;bottom:8px;
        font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;
        text-transform:uppercase;color:var(--muted);
      }
      .duel-name-opp{
        position:absolute;bottom:8px;right:0;
        font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;
        text-transform:uppercase;color:var(--muted);
      }

      /* Action buttons row */
      .duel-actions{
        display:flex;gap:14px;padding:12px 20px;
        background:var(--surface);border-top:1px solid var(--border);
        flex-shrink:0;justify-content:center;
      }
      #duel-shoot{min-width:150px;height:50px;font-size:13px;}
      #duel-wait {min-width:150px;height:50px;font-size:13px;}

      /* Payoffs pinned at very bottom */
      .duel-payoffs{
        display:flex;gap:8px;padding:10px 16px;
        background:#1A1612;
        flex-shrink:0;justify-content:center;align-items:center;
        flex-wrap:wrap;
      }
      .duel-pf{
        font-family:'DM Mono',monospace;font-size:11px;
        padding:4px 10px;border-radius:2px;
        border:1px solid rgba(255,255,255,.12);
        color:rgba(245,240,232,.6);
      }
      .duel-pf.good{border-color:rgba(46,125,82,.4);color:#6EC994;}
      .duel-pf.bad {border-color:rgba(192,57,43,.35);color:#E8806A;}

      /* Outcome overlay */
      #duel-outcome{
        position:absolute;inset:0;z-index:20;
        background:rgba(245,240,232,.96);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:10px;opacity:0;pointer-events:none;transition:opacity .3s ease;
        text-align:center;padding:2rem;
      }
      #duel-outcome.show{opacity:1;pointer-events:auto;}
      .duel-out-title{font-family:'Playfair Display',serif;font-size:26px;font-weight:900;color:var(--ink);}
      .duel-out-sub{font-size:13px;color:var(--muted);max-width:360px;line-height:1.65;}
      .duel-out-earn{font-family:'DM Mono',monospace;font-size:20px;font-weight:500;padding:8px 20px;border-radius:4px;}
      .duel-out-earn.win {color:var(--green);background:rgba(46,125,82,.1);border:1px solid rgba(46,125,82,.2);}
      .duel-out-earn.lose{color:var(--red);  background:rgba(192,57,43,.1);border:1px solid rgba(192,57,43,.2);}
      .duel-out-earn.draw{color:var(--muted);background:rgba(26,22,18,.05);border:1px solid var(--border-solid);}
      .duel-out-theory{font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;border:1px solid var(--border-solid);padding:5px 14px;border-radius:2px;max-width:380px;line-height:1.6;}

      /* ── RIGHT PANEL ── */
      .duel-right{width:256px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;}
      .duel-panel-sec{padding:13px 15px;border-bottom:1px solid var(--border);}
      .duel-panel-lbl{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:7px;}
      .duel-stat-big{font-family:'DM Mono',monospace;font-size:26px;font-weight:500;color:var(--ink);}
      .duel-stat-sub{font-size:11px;color:var(--muted);margin-top:2px;}

      .duel-prob-ladder{display:flex;flex-direction:column;gap:4px;}
      .duel-ladder-row{display:flex;align-items:center;gap:7px;padding:2px 0;}
      .duel-ladder-rnd{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);min-width:26px;}
      .duel-ladder-bar-bg{flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;}
      .duel-ladder-bar-fill{height:100%;border-radius:3px;}
      .duel-ladder-pct{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);min-width:32px;text-align:right;}
      .duel-ladder-row.current .duel-ladder-rnd{color:var(--gold);font-weight:500;}
      .duel-ladder-row.current .duel-ladder-pct{color:var(--gold);font-weight:500;}

      .duel-hist-list{flex:1;overflow-y:auto;padding:8px 15px;}
      .duel-hist-item{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);animation:fadeUp .2s ease;}
      .duel-hist-game{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);}
      .duel-hist-res{font-family:'DM Mono',monospace;font-size:11px;font-weight:500;padding:2px 7px;border-radius:2px;}
      .duel-hist-res.win {background:rgba(46,125,82,.12);color:var(--green);}
      .duel-hist-res.lose{background:rgba(192,57,43,.12);color:var(--red);}
      .duel-hist-res.draw{background:rgba(26,22,18,.06);color:var(--muted);}

      .duel-game-dots{display:flex;gap:5px;align-items:center;margin-top:5px;}
      .duel-game-dot{width:8px;height:8px;border-radius:50%;background:var(--border-solid);transition:background .3s ease;}
      .duel-game-dot.win {background:var(--green);}
      .duel-game-dot.lose{background:var(--red);}
      .duel-game-dot.draw{background:var(--muted);}
      .duel-game-dot.current{background:var(--gold);transform:scale(1.3);}

      .thinking-dots span{animation:blink 1.2s ease-in-out infinite;opacity:0;}
      .thinking-dots span:nth-child(2){animation-delay:.2s;}
      .thinking-dots span:nth-child(3){animation-delay:.4s;}
      @keyframes blink{0%,80%,100%{opacity:0;}40%{opacity:1;}}
    </style>

    <div id="duel-root">
      <!-- LEFT: Arena + buttons + payoffs -->
      <div class="duel-main">

        <!-- Arena -->
        <div class="duel-arena-wrap" id="duel-arena-wrap">
          <!-- Big probability bg -->
          <div id="duel-prob-bg">
            <div id="duel-prob-bg-text">10%</div>
          </div>

          <!-- Status text -->
          <div id="duel-arena-status">Ready</div>

          <!-- Bullet canvas -->
          <canvas id="duel-bullet-canvas"></canvas>

          <!-- Cowboy SVG arena -->
          <svg id="duel-arena-svg" viewBox="0 0 600 380" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
            <!-- Ground -->
            <rect x="0" y="340" width="600" height="40" fill="#C8B48A"/>
            <rect x="0" y="338" width="600" height="4" fill="#B8A478"/>
            <line x1="30" y1="350" x2="160" y2="350" stroke="#B0A070" stroke-width="1" opacity="0.5"/>
            <line x1="440" y1="350" x2="570" y2="350" stroke="#B0A070" stroke-width="1" opacity="0.5"/>

            <!-- Hero cowboy (left, faces right) -->
            <g id="duel-hero-g">
              ${this._cowboySVG('hero','idle')}
            </g>

            <!-- Villain cowboy (right, faces left via flip) -->
            <g id="duel-villain-g">
              ${this._cowboySVG('villain','idle')}
            </g>

            <!-- Name labels inside SVG -->
            <text id="duel-svg-you"  x="0"   y="380" font-family="DM Mono,monospace" font-size="11" fill="#7A7268" letter-spacing="0.08em">YOU</text>
            <text id="duel-svg-opp"  x="600" y="380" font-family="DM Mono,monospace" font-size="11" fill="#7A7268" letter-spacing="0.08em" text-anchor="end">OPPONENT</text>
          </svg>
        </div>

        <!-- Action buttons -->
        <div class="duel-actions">
          <button class="btn btn-red"  id="duel-shoot" disabled>&#x1F52B; Shoot</button>
          <button class="btn btn-dark" id="duel-wait"  disabled>&#x23F3; Wait</button>
        </div>

        <!-- Payoffs bar at very bottom -->
        <div class="duel-payoffs">
          <div class="duel-pf good">Hit &#x2192; +$20</div>
          <div class="duel-pf bad">Miss &#x2192; -$10</div>
          <div class="duel-pf bad">Get shot &#x2192; -$10</div>
          <div class="duel-pf">Both wait &#x2192; +$0</div>
        </div>

        <!-- Outcome overlay (over the main panel) -->
        <div id="duel-outcome">
          <div class="duel-out-title" id="duel-out-title">Game Over</div>
          <div class="duel-out-sub"   id="duel-out-sub"></div>
          <div class="duel-out-earn"  id="duel-out-earn">+$0</div>
          <div class="duel-out-theory" id="duel-out-theory"></div>
        </div>
      </div>

      <!-- RIGHT PANEL -->
      <div class="duel-right">
        <div class="duel-panel-sec">
          <div class="duel-panel-lbl">Game</div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div class="duel-stat-big" id="duel-game-num">1</div>
            <div style="font-size:12px;color:var(--muted);" id="duel-game-of">of 5</div>
          </div>
          <div class="duel-game-dots" id="duel-game-dots"></div>
        </div>

        <div class="duel-panel-sec">
          <div class="duel-panel-lbl">Round This Game</div>
          <div class="duel-stat-big" id="duel-round-num">1</div>
          <div class="duel-stat-sub">of 10 max</div>
        </div>

        <div class="duel-panel-sec">
          <div class="duel-panel-lbl">Session Earnings</div>
          <div class="duel-stat-big" id="duel-total-earn" style="color:var(--green);">$0.00</div>
          <div class="duel-stat-sub">added to balance</div>
        </div>

        <div class="duel-panel-sec">
          <div class="duel-panel-lbl">Hit Probability Ladder</div>
          <div class="duel-prob-ladder" id="duel-ladder"></div>
        </div>

        <div class="duel-panel-sec" style="padding-bottom:7px;flex-shrink:0;">
          <div class="duel-panel-lbl">Game History</div>
        </div>
        <div class="duel-hist-list" id="duel-hist"></div>
      </div>
    </div>`;
  },

  // ── Canvas setup ───────────────────────────────────────────────
  _setupCanvas() {
    const wrap   = document.getElementById('duel-arena-wrap');
    const canvas = document.getElementById('duel-bullet-canvas');
    if (!canvas || !wrap) return;
    const resize = () => { canvas.width = wrap.clientWidth; canvas.height = wrap.clientHeight; };
    resize();
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
  },

  // ── Bullet animation loop ─────────────────────────────────────
  _startLoop() {
    const loop = () => {
      this._drawBullets();
      this._animId = requestAnimationFrame(loop);
    };
    this._animId = requestAnimationFrame(loop);
  },

  _drawBullets() {
    const ctx = this._ctx;
    if (!ctx || !this._canvas) return;
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    this._bullets = this._bullets.filter(b => b.t < 1.0);
    for (const b of this._bullets) {
      b.t += 0.022;
      const t  = b.t;
      const x  = b.x0 + (b.x1 - b.x0) * t;
      // Parabolic arc — positive = rises then falls
      const arc = b.hit ? -b.arcH * 4 * t * (1 - t) : -b.arcH * (1 - Math.pow(2*t-1, 2)) * (t < 0.7 ? 1 : (1-t)/0.3);
      const y   = b.y0 + (b.y1 - b.y0) * t + arc;
      // Fade out near end
      const alpha = t > 0.85 ? (1 - t) / 0.15 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      // Trail
      if (b.prevX !== undefined) {
        ctx.beginPath();
        ctx.moveTo(b.prevX, b.prevY);
        ctx.lineTo(x, y);
        ctx.strokeStyle = b.hit ? '#E8A020' : '#888';
        ctx.lineWidth   = 2.5;
        ctx.stroke();
      }
      // Bullet circle
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = b.hit ? '#C8A030' : '#666';
      ctx.fill();
      ctx.restore();
      b.prevX = x;
      b.prevY = y;
    }
  },

  // Fire a bullet animation across the screen
  _fireBullet(fromLeft, hit) {
    const wrap = document.getElementById('duel-arena-wrap');
    if (!wrap) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    // Approximate gun tip positions (fraction of width)
    const heroX   = W * 0.20;
    const villainX= W * 0.80;
    const gunY    = H * 0.22; // roughly where the raised gun is
    this._bullets.push({
      t:    0,
      x0:   fromLeft ? heroX    : villainX,
      y0:   gunY,
      x1:   fromLeft ? villainX : heroX,
      y1:   gunY,
      arcH: hit ? H * 0.18 : H * (0.08 + Math.random() * 0.12),
      hit,
    });
  },

  // ── Cowboy position update ────────────────────────────────────
  _updateCowboyPositions(heroX, villainX, heroPose, villainPose) {
    const heroG    = document.getElementById('duel-hero-g');
    const villainG = document.getElementById('duel-villain-g');
    if (heroG) {
      heroG.setAttribute('transform', `translate(${heroX}, 0)`);
      heroG.innerHTML = this._cowboySVG('hero', heroPose);
    }
    if (villainG) {
      // Villain faces LEFT — mirror with scale(-1,1) then translate
      villainG.setAttribute('transform', `translate(${villainX}, 0) scale(-1,1)`);
      villainG.innerHTML = this._cowboySVG('villain', villainPose);
    }
  },

  // ── Update UI ─────────────────────────────────────────────────
  _updateUI() {
    const s   = this._state;
    const cfg = this._CONFIG;

    // Probability background
    const pct    = Math.round(s.hitProb * 100);
    const probBg = document.getElementById('duel-prob-bg-text');
    if (probBg) {
      probBg.textContent = pct + '%';
      // Grows as probability rises: 180px at 10% → 340px at 100%
      const fs = 180 + (pct - 10) * 1.8;
      probBg.style.fontSize  = fs + 'px';
      probBg.style.opacity   = (0.08 + pct * 0.0012).toString();
    }

    // Cowboy positions — start far apart, step 30px closer each wait round
    const baseHeroX    = 100;
    const baseVillainX = 500;
    const step         = s.stepsTaken * 28;
    const heroX        = baseHeroX    + step;
    const villainX     = baseVillainX - step;

    this._updateCowboyPositions(heroX, villainX,
      s.youDefeated   ? 'defeated' : 'idle',
      s.oppDefeated   ? 'defeated' : 'idle'
    );

    // Hints: EV info — hidden unless hints on
    const statusEl = document.getElementById('duel-arena-status');
    if (statusEl && !s.animating && !s.gameOver) {
      if (this._hintsEnabled) {
        const ev = +(s.hitProb * cfg.hitPayoff + (1 - s.hitProb) * cfg.missPayoff).toFixed(2);
        statusEl.textContent = `Round ${s.round} \xb7 EV(shoot) = $${ev}`;
        statusEl.className   = 'duel-arena-status' + (ev > 0 ? '' : '');
      } else {
        statusEl.textContent = `Round ${s.round} \xb7 Your move`;
        statusEl.className   = 'duel-arena-status';
      }
    }

    // Buttons
    const canAct = !s.gameOver && !s.animating && !s.waitingForOpponent;
    const shootBtn = document.getElementById('duel-shoot');
    const waitBtn  = document.getElementById('duel-wait');
    if (shootBtn) shootBtn.disabled = !canAct;
    if (waitBtn)  waitBtn.disabled  = !canAct;

    // Right panel
    const gameNumEl = document.getElementById('duel-game-num');
    const gameOfEl  = document.getElementById('duel-game-of');
    const roundEl   = document.getElementById('duel-round-num');
    const earnEl    = document.getElementById('duel-total-earn');
    if (gameNumEl) gameNumEl.textContent = s.gameRound;
    if (gameOfEl)  gameOfEl.textContent  = 'of ' + s.totalGames;
    if (roundEl)   roundEl.textContent   = s.round;
    if (earnEl)    earnEl.textContent    = '$' + s.totalEarnings.toFixed(2);

    this._updateLadder();
    this._updateGameDots();
  },

  _updateLadder() {
    const s   = this._state;
    const cfg = this._CONFIG;
    const container = document.getElementById('duel-ladder');
    if (!container) return;
    let html = '';
    for (let r = 1; r <= cfg.rounds; r++) {
      const p   = +(r * cfg.hitProbStep).toFixed(2);
      const pct = Math.round(p * 100);
      const cls = r < s.round ? 'past' : r === s.round ? 'current' : 'future';
      const color = p <= 0.3 ? 'var(--green)' : p <= 0.6 ? '#D4860A' : 'var(--red)';
      const fillColor = cls === 'future' ? 'var(--border-solid)' : cls === 'past' ? 'var(--green)' : color;
      html += `<div class="duel-ladder-row ${cls}">
        <div class="duel-ladder-rnd">R${r}</div>
        <div class="duel-ladder-bar-bg"><div class="duel-ladder-bar-fill" style="width:${pct}%;background:${fillColor}"></div></div>
        <div class="duel-ladder-pct">${pct}%</div>
      </div>`;
    }
    container.innerHTML = html;
  },

  _updateGameDots() {
    const s = this._state;
    const container = document.getElementById('duel-game-dots');
    if (!container) return;
    let html = '';
    for (let g = 1; g <= s.totalGames; g++) {
      const outcome = s.gameHistory[g - 1];
      const cls = outcome === undefined
        ? (g === s.gameRound ? 'current' : '')
        : outcome > 0 ? 'win' : outcome < 0 ? 'lose' : 'draw';
      html += `<div class="duel-game-dot ${cls}"></div>`;
    }
    container.innerHTML = html;
  },

  // ── Events ────────────────────────────────────────────────────
  _bindEvents() {
    document.getElementById('duel-shoot').addEventListener('click', () => this._playerAction('shoot'));
    document.getElementById('duel-wait').addEventListener('click',  () => this._playerAction('wait'));
  },

  // ── Player action ─────────────────────────────────────────────
  async _playerAction(action) {
    const s = this._state;
    if (s.gameOver || s.animating || s.waitingForOpponent) return;
    s.animating = true;
    s.waitingForOpponent = true;
    document.getElementById('duel-shoot').disabled = true;
    document.getElementById('duel-wait').disabled  = true;

    const statusEl = document.getElementById('duel-arena-status');
    if (statusEl) {
      statusEl.innerHTML = `Opponent deciding <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>`;
      statusEl.className = 'duel-arena-status thinking';
    }

    await this._delay(700 + Math.random() * 900);

    const oppAction = this._opponentDecide();
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'duel-arena-status'; }

    await this._resolveRound(action, oppAction);
  },

  _opponentDecide() {
    const s = this._state;
    const nashQ     = Math.max(0, (30 * s.hitProb - 10) / 20);
    const adjustedQ = Math.min(1, nashQ * s.impatience);
    if (s.round <= 2) return 'wait';
    if (s.round === 3) return Math.random() < 0.08 * s.impatience ? 'shoot' : 'wait';
    return Math.random() < adjustedQ ? 'shoot' : 'wait';
  },

  // ── Resolve round ─────────────────────────────────────────────
  async _resolveRound(playerAction, oppAction) {
    const s   = this._state;
    const cfg = this._CONFIG;

    s.history.push({ round: s.round, hitProb: s.hitProb, playerAction, oppAction });

    // ── Both wait ──────────────────────────────────────────────
    if (playerAction === 'wait' && oppAction === 'wait') {
      s.stepsTaken++;  // cowboys step closer
      const statusEl = document.getElementById('duel-arena-status');
      if (statusEl) statusEl.textContent = 'Both waited \u2014 one step closer\u2026';

      if (s.round >= cfg.rounds) {
        await this._delay(600);
        await this._endGame(0, 'stalemate');
      } else {
        s.round++;
        s.hitProb   = +(s.hitProb + cfg.hitProbStep).toFixed(2);
        s.animating = false;
        s.waitingForOpponent = false;
        this._updateUI();
      }
      return;
    }

    // ── At least one shoots ────────────────────────────────────
    const playerHit = playerAction === 'shoot' && Math.random() < s.hitProb;
    const oppHit    = oppAction    === 'shoot' && Math.random() < s.hitProb;

    // Show shoot poses
    const heroX    = 100 + s.stepsTaken * 28;
    const villainX = 500 - s.stepsTaken * 28;
    if (playerAction === 'shoot') this._updateCowboyPositions(heroX, villainX, 'shoot', s.oppDefeated ? 'defeated' : oppAction === 'shoot' ? 'shoot' : 'idle');
    if (oppAction    === 'shoot') this._updateCowboyPositions(heroX, villainX, playerAction === 'shoot' ? 'shoot' : 'idle', 'shoot');

    await this._delay(300);

    // Fire bullet animations
    if (playerAction === 'shoot') this._fireBullet(true,  playerHit);
    if (oppAction    === 'shoot') this._fireBullet(false, oppHit);

    await this._delay(900);

    // Determine earnings and outcome
    let playerEarnings = 0;
    let title, sub, earnClass;

    if (playerAction === 'shoot' && oppAction === 'shoot') {
      if (playerHit && oppHit) {
        playerEarnings = cfg.hitPayoff + cfg.shotPayoff;
        title = 'Both shot \u2014 you both hit'; sub = `A rare simultaneous exchange. +$20 hit, -$10 hit. Net: +$10.`; earnClass = 'win';
        s.oppDefeated = true;
      } else if (playerHit) {
        playerEarnings = cfg.hitPayoff;
        title = 'Both shot \u2014 you hit!'; sub = `Your shot landed, theirs missed. +$20.`; earnClass = 'win';
        s.oppDefeated = true;
      } else if (oppHit) {
        playerEarnings = cfg.shotPayoff;
        title = 'Both shot \u2014 you got hit'; sub = `Their shot landed, yours missed. -$10.`; earnClass = 'lose';
        s.youDefeated = true;
      } else {
        playerEarnings = cfg.missPayoff;
        title = 'Both shot \u2014 both missed'; sub = `Both shots went wide. You pay the miss penalty: -$10.`; earnClass = 'lose';
      }
    } else if (playerAction === 'shoot') {
      if (playerHit) {
        playerEarnings = cfg.hitPayoff;
        title = 'You shot \u2014 and hit!'; sub = `At ${Math.round(s.hitProb*100)}%, your shot connected. +$20.`; earnClass = 'win';
        s.oppDefeated = true;
      } else {
        playerEarnings = cfg.missPayoff;
        title = 'You shot \u2014 and missed'; sub = `At ${Math.round(s.hitProb*100)}%, the shot went wide. -$10.`; earnClass = 'lose';
      }
    } else {
      if (oppHit) {
        playerEarnings = cfg.shotPayoff;
        title = 'Opponent shot \u2014 and hit you'; sub = `They fired at ${Math.round(s.hitProb*100)}% and connected. -$10.`; earnClass = 'lose';
        s.youDefeated = true;
      } else {
        playerEarnings = 0;
        title = 'Opponent shot \u2014 and missed'; sub = `They fired and missed. You earn $0 this round.`; earnClass = 'draw';
      }
    }

    // Update cowboy poses after resolution
    this._updateCowboyPositions(heroX, villainX,
      s.youDefeated ? 'defeated' : 'idle',
      s.oppDefeated ? 'defeated' : 'idle'
    );

    await this._delay(300);
    await this._endGame(playerEarnings, 'shot', title, sub, earnClass);
  },

  // ── End game ──────────────────────────────────────────────────
  async _endGame(earnings, reason, title, sub, earnClass) {
    const s   = this._state;
    const cfg = this._CONFIG;
    s.gameOver = true;
    s.totalEarnings = +(s.totalEarnings + earnings).toFixed(2);
    s.gameHistory.push(earnings);

    // Record per-duel data for submission
    const waitSeq = s.history.map(h =>
      h.playerAction === 'shoot' || h.oppAction === 'shoot' ? 'S' : 'W'
    ).join('');
    const lastH = s.history[s.history.length - 1] || {};
    s.duelLog.push({
      exitRound:    s.round,
      playerAction: lastH.playerAction || null,
      oppAction:    lastH.oppAction    || null,
      playerHit:    reason === 'stalemate' ? false : (lastH.playerAction === 'shoot' && earnings > 0 && !(lastH.oppAction === 'shoot')),
      oppHit:       reason === 'stalemate' ? false : (lastH.oppAction === 'shoot' && earnings < 0),
      earnings,
      waitSeq,
    });

    const earnEl = document.getElementById('duel-total-earn');
    if (earnEl) earnEl.textContent = '$' + s.totalEarnings.toFixed(2);

    const nashQ      = Math.max(0, (30 * s.hitProb - 10) / 20);
    const theoryNote = reason === 'stalemate'
      ? 'Stalemate \u2014 neither fired in 10 rounds. Nash predicts mixing from round 4 (p=40%).'
      : `Hit prob: ${Math.round(s.hitProb*100)}% \xb7 Nash mix: ${Math.round(nashQ*100)}% \xb7 EV(shoot): $${(s.hitProb*cfg.hitPayoff+(1-s.hitProb)*cfg.missPayoff).toFixed(2)}`;

    if (reason === 'stalemate') { title = 'Stalemate'; sub = 'Neither player fired in 10 rounds. $0 each.'; earnClass = 'draw'; }

    document.getElementById('duel-out-title').textContent   = title || 'Game Over';
    document.getElementById('duel-out-sub').textContent     = sub   || '';
    document.getElementById('duel-out-earn').textContent    = (earnings >= 0 ? '+' : '') + '$' + earnings.toFixed(2);
    document.getElementById('duel-out-earn').className      = 'duel-out-earn ' + (earnClass || 'draw');
    document.getElementById('duel-out-theory').textContent  = theoryNote;

    await this._delay(200);
    document.getElementById('duel-outcome').classList.add('show');
    await this._delay(500);
    this._shell.flashBalance(earnings);

    // Add history entry
    const list = document.getElementById('duel-hist');
    if (list) {
      const el = document.createElement('div');
      el.className = 'duel-hist-item';
      const res = earnClass || 'draw';
      const earn = (earnings >= 0 ? '+' : '') + '$' + earnings.toFixed(2);
      el.innerHTML = `<span class="duel-hist-game">Game ${s.gameRound}</span><span class="duel-hist-res ${res}">${earn}</span>`;
      list.insertBefore(el, list.firstChild);
    }

    await this._delay(3500);

    if (s.gameRound >= s.totalGames) {
      this._shell.onGameComplete();
    } else {
      this._startNextGame();
    }
  },

  _startNextGame() {
    const s   = this._state;
    const cfg = this._CONFIG;
    document.getElementById('duel-outcome').classList.remove('show');
    s.gameRound++;
    s.round        = 1;
    s.hitProb      = cfg.hitProbStep;
    s.gameOver     = false;
    s.animating    = false;
    s.waitingForOpponent = false;
    s.history      = [];
    s.stepsTaken   = 0;
    s.youDefeated  = false;
    s.oppDefeated  = false;
    // duelLog accumulates across all games in the session — do NOT reset
    s.impatience   = cfg.impatienceMin + Math.random() * (cfg.impatienceMax - cfg.impatienceMin);
    this._updateUI();
  },

  getResults() {
    const s   = this._state;
    const wins   = s.gameHistory.filter(e => e > 0).length;
    const losses = s.gameHistory.filter(e => e < 0).length;
    const draws  = s.gameHistory.filter(e => e === 0).length;
    const total  = s.totalEarnings;
    let title, profile, analysis;
    if (total >= 15) {
      title = 'Precision Duelist'; profile = 'The Patient Marksman';
      analysis = `You earned $${total.toFixed(2)} \u2014 the duelist's ideal. Waiting for high probability then acting decisively. Nash recommends mixing from round 4 (p=40%). Most real players shoot 1\u20132 rounds too early out of fear.`;
    } else if (total >= 0) {
      title = 'Steady Hand'; profile = 'The Calibrated Risk-Taker';
      analysis = `A balanced $${total.toFixed(2)} across ${s.totalGames} duels. The classic tension: wait for better odds, or shoot first. Most players cluster around rounds 4\u20135, where Nash mixing begins.`;
    } else if (losses > wins) {
      title = 'Trigger-Happy'; profile = 'The Impatient Shooter';
      analysis = `More losses than wins ($${total.toFixed(2)}). Shooting too early at low probabilities produces negative EV. Break-even is p=33% (round 4). Fear of being shot first drives most premature action.`;
    } else {
      title = 'Too Cautious'; profile = 'The Reluctant Duelist';
      analysis = `Waiting too long cedes initiative. The optimal strategy mixes shooting and waiting from round 4 onward \u2014 not pure waiting.`;
    }
    return {
      title, profile, analysis,
      balanceDelta: total,
      stats: [
        { val: '$' + total.toFixed(2),               label: 'Total Earnings' },
        { val: wins + 'W / ' + losses + 'L / ' + draws + 'D', label: 'W / L / Draw' },
        { val: String(s.totalGames),                 label: 'Duels Played' },
      ]
    };
  },

  getSubmissionData() {
    const s   = this._state;
    const cfg = this._CONFIG;
    const wins   = s.gameHistory.filter(e => e > 0).length;
    const losses = s.gameHistory.filter(e => e < 0).length;
    const draws  = s.gameHistory.filter(e => e === 0).length;
    const avgExitRound = s.duelLog.length > 0
      ? +(s.duelLog.reduce((a, d) => a + d.exitRound, 0) / s.duelLog.length).toFixed(2)
      : null;
    const duels = s.duelLog.map((d, i) => ({
      duel_index:    i + 1,
      exit_round:    d.exitRound,
      exit_prob:     +(d.exitRound * cfg.hitProbStep).toFixed(2),
      player_shot:   d.playerAction === 'shoot',
      opponent_shot: d.oppAction    === 'shoot',
      player_hit:    !!d.playerHit,
      opponent_hit:  !!d.oppHit,
      rounds_waited: d.exitRound - 1,
      earnings:      +d.earnings.toFixed(2),
      wait_sequence: d.waitSeq || '',
    }));
    return {
      // ── Game configuration (snapshot at time of play) ──────
      config: {
        max_rounds:          cfg.rounds,            // 10
        hit_prob_step:       cfg.hitProbStep,       // 0.10 per round
        hit_prob_start:      cfg.hitProbStep,       // 0.10 at round 1
        hit_prob_end:        1.0,                   // 1.00 at round 10
        duels_per_session:   cfg.roundsPerSession,  // 5
      },
      // ── Payoff structure ────────────────────────────────────
      payoffs: {
        hit_payoff:          cfg.hitPayoff,         // +$20
        miss_payoff:         cfg.missPayoff,        // -$10
        shot_payoff:         cfg.shotPayoff,        // -$10 (being hit)
        wait_payoff:         0,                     // $0 if both wait
        // Note: both shoot and both hit = hit_payoff + shot_payoff = +$10 net
        both_hit_net:        cfg.hitPayoff + cfg.shotPayoff,  // +$10
      },
      // ── Opponent model params ────────────────────────────────
      opponent_model: {
        type:                'crra_impatience_phase1',
        impatience_range:    [cfg.impatienceMin, cfg.impatienceMax],   // [1.1, 1.5]
        impatience_drawn:    +s.impatience.toFixed(3),  // this session's draw
        nash_break_even_round: 4,                   // round where EV(shoot) first > 0
      },
      // ── Summary ──────────────────────────────────────────────
      total_duels:          s.totalGames,
      wins, losses, draws,
      avg_exit_round:       avgExitRound,
      total_earnings:       +s.totalEarnings.toFixed(2),
      duels,
    };
  },

  destroy() {
    if (this._animId) cancelAnimationFrame(this._animId);
    this._bullets  = [];
    this._canvas   = null;
    this._ctx      = null;
    this._state    = null;
    this._shell    = null;
    this._animId   = null;
  },

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); },
};

GameRegistry.register(GameDuel);
