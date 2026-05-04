/* ============================================================
   DECISION LAB — GAME MODULE
   Game:     Beauty Contest (p-Beauty Contest / Keynesian Beauty Contest)
   ID:       beauty_contest
   Category: theory
   Status:   complete (Phase 1 — seed data; Phase 2 — real player history)

   SETTING:
   Players guess a number 0–100. The winner is closest to 2/3 of
   the average of all recent entries. This is updated each round
   using a rolling window of the last 10 entries (player + seed).

   ACADEMIC BASELINE (Phase 1 — seed data):
   ─────────────────────────────────────────────────────────────
   PRIMARY SOURCES:
   Nagel (1995) "Unraveling in Guessing Games: An Experimental Study"
   American Economic Review 85(5): 1313-1326.
   Ho, Camerer & Weigelt (1998) "Iterated Dominance and Iterated
   Best Response in Experimental p-Beauty Contests"

   KEY FINDINGS ENCODED:
   1. LEVEL-k REASONING: Most players use 1–2 levels of iterated
      thinking. Level-0: random (uniform 0–100, mean 50).
      Level-1: 2/3 × 50 = 33. Level-2: 2/3 × 33 = 22.
      Seed data reflects this empirical distribution.
   2. CONVERGENCE: Repeated play drives guesses toward Nash (0),
      but convergence is slow and rarely complete.
   3. NASH EQUILIBRIUM: 0 (iterated dominance of all values > 0).

   PHASE 2 — REAL PLAYER DATA:
   Rolling window uses last 10 actual submissions from Firestore.
   Fetched via PhaseSystem.getOpponentData('beauty_contest').
   Until 50 real submissions exist, seed data fills the window.
============================================================ */

const GameBeautyContest = {
  id:        'beauty_contest',
  name:      'Beauty Contest',
  shortName: 'Beauty Contest',
  category:  'theory',

  // ── Config ─────────────────────────────────────────────────
  _CONFIG: {
    rounds:           1,
    minGuess:         0,
    maxGuess:         100,
    maxPayoff:        20,    // perfect guess earns +$20 per round
    historySize:      10,    // rolling window of past entries
    fraction:         2/3,   // the "2/3 of average" fraction
  },

  // ── Seed data (Nagel 1995 distribution, Level-k empirical) ─
  _SEED_DATA: [21,28,27,38,30,18,39,71,34,20,26,83,26,12,32,35,23,24,87,28,
               20,39,6,37,31,34,23,26,25,10,21,37,23,35,22,27,13,19,30,28,
               31,18,35,16,15,31,29,2,60,25,16,21,30,11,19,21,38,1,38,2,
               18,30,18,46,27,17,14,25,14,95,33,97,25,26,15,17,30,25,30,47,
               20,32,16,60,2,26,18,73,12,0,36,37,16,14,2,23,31,15,29,42],

  _state:        null,
  _shell:        null,
  _hintsEnabled: false,

  // ── Intro ───────────────────────────────────────────────────
  intro: {
    title: 'Beauty Contest',
    desc:  'Everyone guesses a number from 0 to 100. The winner is whoever is closest to 2/3 of the average of all recent entries. What do you think other players will guess?',
    rules: [
      'Guess a number between 0 and 100',
      'The target is 2/3 of the average of the last 10 entries',
      'The closer your guess to the target, the higher your payoff',
      'Perfect guess = +$20. Further away = less. 50+ away = $0',
      'After each round, your guess enters the history for future players',
      'Nash equilibrium: everyone guesses 0 (but does anyone?)',
    ]
  },

  // ── Mount ───────────────────────────────────────────────────
  mount(container, shellAPI, hintsEnabled) {
    this._hintsEnabled = !!hintsEnabled;
    this._shell        = shellAPI;

    // Build rolling history: last 10 from seed
    const history = this._SEED_DATA.slice(-this._CONFIG.historySize).slice();

    this._state = {
      round:         1,
      totalRounds:   this._CONFIG.rounds,
      history,          // rolling window of last 10 entries
      totalEarnings: 0,
      roundHistory:  [], // [{round, guess, avg, target, distance, payoff}]
      phase:         'input',  // 'input' | 'result'
    };

    container.innerHTML = this._html();
    this._bindEvents();
    this._updateRightPanel();
  },

  // ── HTML ────────────────────────────────────────────────────
  _html() {
    return `<style>
      #bc-root{display:flex;height:100%;overflow:hidden;font-family:'DM Sans',sans-serif;}

      /* ── LEFT MAIN ── */
      .bc-main{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--cream);position:relative;}
      .bc-arena{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.5rem 2rem;gap:1.2rem;overflow:hidden;}

      /* ── Input phase ── */
      .bc-question{font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:var(--ink);text-align:center;max-width:440px;line-height:1.4;}
      .bc-sub{font-size:13px;color:var(--muted);text-align:center;max-width:380px;line-height:1.6;}
      .bc-input-wrap{display:flex;flex-direction:column;align-items:center;gap:14px;}
      .bc-number-input{width:120px;padding:16px;font-size:28px;font-family:'DM Mono',monospace;font-weight:500;text-align:center;border:2px solid var(--border-solid);border-radius:4px;background:var(--surface);color:var(--ink);outline:none;transition:border-color .2s;}
      .bc-number-input:focus{border-color:var(--gold);}
      .bc-range-hint{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.1em;}

      /* ── Nash hint (hints mode) ── */
      .bc-hint-box{background:rgba(200,168,75,.08);border:1px solid rgba(200,168,75,.3);border-radius:4px;padding:10px 16px;max-width:380px;font-size:12px;color:var(--muted);text-align:center;line-height:1.6;}
      .bc-hint-box strong{color:var(--gold);}

      /* ── History chart ── */
      .bc-chart-section{width:100%;max-width:520px;}
      .bc-chart-label{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}
      .bc-chart-wrap{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px 12px 28px;position:relative;height:120px;overflow:visible;}
      .bc-bars{display:flex;align-items:flex-end;justify-content:space-around;height:100%;gap:4px;position:relative;z-index:1;}
      .bc-bar{flex:1;background:var(--border-solid);border-radius:2px 2px 0 0;position:relative;transition:height .5s ease,background .3s ease;min-height:2px;}
      .bc-bar.player{background:var(--gold);}
      .bc-bar.highlighted{background:rgba(200,168,75,.4);}
      .bc-bar-val{position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);white-space:nowrap;}
      .bc-target-line{position:absolute;left:12px;right:12px;height:0;border-top:2px solid var(--red);opacity:.7;pointer-events:none;z-index:10;}
      .bc-target-label{position:absolute;right:14px;font-family:'DM Mono',monospace;font-size:9px;color:var(--red);white-space:nowrap;z-index:10;}
      .bc-avg-line{position:absolute;left:12px;right:12px;height:0;border-top:2px dashed var(--gold);opacity:.9;pointer-events:none;z-index:10;}
      .bc-avg-label{position:absolute;left:14px;font-family:'DM Mono',monospace;font-size:9px;color:var(--gold);white-space:nowrap;z-index:10;}

      /* ── Result phase ── */
      #bc-result-area{display:none;}
      .bc-result-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:4px;overflow:hidden;max-width:420px;width:100%;}
      .bc-res-cell{background:var(--surface);padding:12px 8px;text-align:center;}
      .bc-res-val{font-family:'DM Mono',monospace;font-size:18px;font-weight:500;color:var(--ink);display:block;margin-bottom:3px;}
      .bc-res-lbl{font-size:10px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;}
      .bc-earn-display{font-family:'DM Mono',monospace;font-size:28px;font-weight:500;padding:10px 24px;border-radius:4px;}
      .bc-earn-display.win{color:var(--green);background:rgba(46,125,82,.08);border:1px solid rgba(46,125,82,.2);}
      .bc-earn-display.lose{color:var(--muted);background:rgba(26,22,18,.04);border:1px solid var(--border-solid);}
      .bc-insight{font-size:12px;color:var(--muted);text-align:center;max-width:380px;line-height:1.65;font-style:italic;}

      /* ── Actions ── */
      .bc-actions{padding:12px 20px;border-top:1px solid var(--border);background:var(--surface);display:flex;gap:12px;justify-content:center;flex-shrink:0;}

      /* ── RIGHT PANEL ── */
      .bc-right{width:236px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;}
      .bc-panel-sec{padding:13px 15px;border-bottom:1px solid var(--border);flex-shrink:0;}
      .bc-panel-lbl{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;}
      .bc-stat-big{font-family:'DM Mono',monospace;font-size:26px;font-weight:500;color:var(--ink);}
      .bc-stat-sub{font-size:11px;color:var(--muted);margin-top:2px;}
      .bc-round-dots{display:flex;gap:5px;margin-top:6px;}
      .bc-dot{width:8px;height:8px;border-radius:50%;background:var(--border-solid);transition:all .3s ease;}
      .bc-dot.done{background:var(--green);}
      .bc-dot.current{background:var(--gold);transform:scale(1.3);}

      /* ── Round history list ── */
      .bc-hist-list{flex:1;overflow-y:auto;padding:0;}
      .bc-hist-item{padding:9px 15px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:2px;}
      .bc-hist-row{display:flex;justify-content:space-between;align-items:center;}
      .bc-hist-round{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);}
      .bc-hist-guess{font-family:'DM Mono',monospace;font-size:11px;color:var(--ink);}
      .bc-hist-earn{font-family:'DM Mono',monospace;font-size:11px;font-weight:500;}
      .bc-hist-earn.pos{color:var(--green);}
      .bc-hist-earn.zero{color:var(--muted);}
      .bc-hist-target{font-size:10px;color:var(--muted);}

      @keyframes fadeUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}
    </style>

    <div id="bc-root">
      <!-- LEFT MAIN -->
      <div class="bc-main">
        <div class="bc-arena">

          <!-- Input phase -->
          <div id="bc-input-area">
            <div class="bc-question">What number will be 2/3 of the average of recent entries?</div>
            <div class="bc-sub" id="bc-sub-text">The last 10 entries determine the target. Pick a number between 0 and 100.</div>

            <div id="bc-hint-area"></div>

            <div class="bc-input-wrap">
              <input type="number" class="bc-number-input" id="bc-guess-input"
                min="0" max="100" placeholder="0–100" autocomplete="off"/>
              <div class="bc-range-hint">Enter 0 – 100</div>
            </div>


          </div>

          <!-- Result phase -->
          <div id="bc-result-area">
            <div class="bc-result-grid" id="bc-result-grid"></div>
            <div class="bc-earn-display" id="bc-earn-display">+$0.00</div>
            <div class="bc-insight" id="bc-insight"></div>

            <!-- Updated chart with player bar highlighted -->
            <div class="bc-chart-section">
              <div class="bc-chart-label">Your guess vs. the market</div>
              <div class="bc-chart-wrap" id="bc-result-chart-wrap">
                <div id="bc-result-target-line" class="bc-target-line"></div>
                <div id="bc-result-target-label" class="bc-target-label"></div>
                <div id="bc-result-avg-line" class="bc-avg-line"></div>
                <div id="bc-result-avg-label" class="bc-avg-label"></div>
                <div class="bc-bars" id="bc-result-bars"></div>
              </div>
            </div>
          </div>

        </div>

        <!-- Action buttons -->
        <div class="bc-actions">
          <button class="btn btn-dark" id="bc-submit-btn">Submit Guess &rarr;</button>
          <button class="btn btn-dark" id="bc-next-btn" style="display:none;">Finish &rarr;</button>
        </div>
      </div>

      <!-- RIGHT PANEL -->
      <div class="bc-right">
        <div class="bc-panel-sec">
          <div class="bc-panel-lbl">Round</div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div class="bc-stat-big" id="bc-round-num">1</div>
            <div style="font-size:12px;color:var(--muted);" id="bc-round-of">of 5</div>
          </div>
          <div class="bc-round-dots" id="bc-round-dots"></div>
        </div>

        <div class="bc-panel-sec">
          <div class="bc-panel-lbl">Session Earnings</div>
          <div class="bc-stat-big" id="bc-total-earn" style="color:var(--green);">$0.00</div>
          <div class="bc-stat-sub">added to balance</div>
        </div>

        <div class="bc-panel-sec">
          <div class="bc-panel-lbl">Current Target</div>
          <div class="bc-stat-big" id="bc-current-target">—</div>
          <div class="bc-stat-sub">2/3 × avg of last 10</div>
        </div>

        <div class="bc-panel-sec" style="padding-bottom:7px;">
          <div class="bc-panel-lbl">Round History</div>
        </div>
        <div class="bc-hist-list" id="bc-hist-list"></div>
      </div>
    </div>`;
  },

  // ── Bind events ─────────────────────────────────────────────
  _bindEvents() {
    let _submitting = false;
    document.getElementById('bc-submit-btn').addEventListener('click', () => {
      if (_submitting) return; _submitting = true;
      this._submitGuess();
    });
    document.getElementById('bc-next-btn').addEventListener('click', () => this._nextRound());
    const input = document.getElementById('bc-guess-input');
    if (input) input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (!_submitting){ _submitting = true; this._submitGuess(); } }
    });
  },

  // ── Render history chart ─────────────────────────────────────
  _renderHistory(highlightLast = false, targetVal = null, playerBarIndex = null, resultMode = false) {
    const s   = this._state;
    const cfg = this._CONFIG;
    const data = s.history.slice(-cfg.historySize);
    const maxVal = 100;

    const barsId   = resultMode ? 'bc-result-bars'        : 'bc-bars';
    const wrapId   = resultMode ? 'bc-result-chart-wrap'  : 'bc-chart-wrap';
    const tlineId  = resultMode ? 'bc-result-target-line' : 'bc-target-line';
    const tlabelId = resultMode ? 'bc-result-target-label': 'bc-target-label';

    const barsEl   = document.getElementById(barsId);
    const wrapEl   = document.getElementById(wrapId);
    const tlineEl  = document.getElementById(tlineId);
    const tlabelEl = document.getElementById(tlabelId);
    if (!barsEl || !wrapEl) return;

    barsEl.innerHTML = '';
    data.forEach((val, i) => {
      const bar = document.createElement('div');
      bar.className = 'bc-bar';
      if (i === playerBarIndex) bar.classList.add('player');
      const pct = (val / maxVal) * 100;
      bar.style.height = '0%';
      const lbl = document.createElement('div');
      lbl.className = 'bc-bar-val';
      lbl.textContent = val;
      bar.appendChild(lbl);
      barsEl.appendChild(bar);
      setTimeout(() => { bar.style.height = pct + '%'; }, 30 + i * 30);
    });

    // Target line — use fixed inner height (120px wrap - 40px padding = 80px usable)
    if (targetVal !== null && tlineEl && tlabelEl) {
      const pct      = targetVal / maxVal;
      const innerH   = 80;
      const fromBot  = pct * innerH;
      tlineEl.style.display  = 'block';
      tlineEl.style.bottom   = (12 + fromBot) + 'px';
      tlineEl.style.top      = 'auto';
      tlabelEl.style.display = 'block';
      tlabelEl.style.bottom  = (16 + fromBot) + 'px';
      tlabelEl.style.top     = 'auto';
      tlabelEl.textContent   = '2/3 target: ' + targetVal.toFixed(1);
    }

    // Average line (dotted gold) — always show in result mode
    if (resultMode) {
      const avg       = data.reduce((a, b) => a + b, 0) / data.length;
      const avgLineEl = document.getElementById('bc-result-avg-line');
      const avgLblEl  = document.getElementById('bc-result-avg-label');
      if (avgLineEl && avgLblEl) {
        const pct     = avg / maxVal;
        const innerH  = 80;
        const fromBot = pct * innerH;
        avgLineEl.style.display = 'block';
        avgLineEl.style.bottom  = (12 + fromBot) + 'px';
        avgLineEl.style.top     = 'auto';
        avgLblEl.style.display  = 'block';
        avgLblEl.style.bottom   = (16 + fromBot) + 'px';
        avgLblEl.style.top      = 'auto';
        avgLblEl.textContent    = 'avg: ' + avg.toFixed(1);
      }
    }
  },

  // ── Update right panel ───────────────────────────────────────
  _updateRightPanel() {
    const s   = this._state;
    const cfg = this._CONFIG;

    // Round number
    const roundEl = document.getElementById('bc-round-num');
    const roundOf = document.getElementById('bc-round-of');
    if (roundEl) roundEl.textContent = s.round;
    if (roundOf) roundOf.textContent = 'of ' + s.totalRounds;

    // Dots
    const dotsEl = document.getElementById('bc-round-dots');
    if (dotsEl) {
      dotsEl.innerHTML = Array.from({ length: s.totalRounds }, (_, i) => {
        const cls = i < s.round - 1 ? 'done' : i === s.round - 1 ? 'current' : '';
        return `<div class="bc-dot ${cls}"></div>`;
      }).join('');
    }

    // Earnings
    const earnEl = document.getElementById('bc-total-earn');
    if (earnEl) earnEl.textContent = '$' + s.totalEarnings.toFixed(2);

    // Current target (before player guesses)
    const avg    = s.history.reduce((a, b) => a + b, 0) / s.history.length;
    const target = avg * cfg.fraction;
    const targetEl = document.getElementById('bc-current-target');
    if (targetEl) targetEl.textContent = target.toFixed(1);

    // Hints
    if (this._hintsEnabled) {
      const nashEl = document.getElementById('bc-hint-area');
      if (nashEl) {
        const lvl1 = (50 * cfg.fraction).toFixed(1);
        const lvl2 = (50 * cfg.fraction * cfg.fraction).toFixed(1);
        nashEl.innerHTML = `<div class="bc-hint-box">
          <strong>Hints on:</strong> Current target = <strong>${target.toFixed(1)}</strong>.
          Nash equilibrium = 0. Level-1 thinking → ~${lvl1}. Level-2 → ~${lvl2}.
        </div>`;
      }
    }
  },

  // ── Submit guess ─────────────────────────────────────────────
  _submitGuess() {
    const s   = this._state;
    const cfg = this._CONFIG;
    if (s.phase !== 'input') return;

    const input = document.getElementById('bc-guess-input');
    const val   = parseFloat(input?.value);
    if (isNaN(val) || val < cfg.minGuess || val > cfg.maxGuess) {
      if (input) { input.style.borderColor = 'var(--red)'; setTimeout(() => { input.style.borderColor = ''; }, 800); }
      return;
    }
    const guess = Math.round(val);

    // Compute result
    const avg      = s.history.reduce((a, b) => a + b, 0) / s.history.length;
    const target   = avg * cfg.fraction;
    const distance = Math.abs(target - guess);
    const payoff   = +(Math.max(0, cfg.maxPayoff * (1 - distance / 50))).toFixed(2);

    // Update history — player's guess enters rolling window
    const playerBarIndex = s.history.length; // will be last bar
    s.history.push(guess);
    if (s.history.length > cfg.historySize) s.history.shift();

    s.totalEarnings = +(s.totalEarnings + payoff).toFixed(2);
    s.roundHistory.push({ round: s.round, guess, avg: +avg.toFixed(2), target: +target.toFixed(2), distance: +distance.toFixed(2), payoff });
    s.phase = 'result';

    // Switch UI
    document.getElementById('bc-input-area').style.display  = 'none';
    document.getElementById('bc-result-area').style.display = 'flex';
    document.getElementById('bc-result-area').style.flexDirection = 'column';
    document.getElementById('bc-result-area').style.alignItems = 'center';
    document.getElementById('bc-result-area').style.gap = '1.2rem';
    document.getElementById('bc-submit-btn').style.display  = 'none';
    document.getElementById('bc-next-btn').style.display    = '';

    // Result grid
    const cell = (v, l) => `<div class="bc-res-cell"><span class="bc-res-val">${v}</span><span class="bc-res-lbl">${l}</span></div>`;
    document.getElementById('bc-result-grid').innerHTML =
      cell(avg.toFixed(1), 'Market Avg') +
      cell(target.toFixed(1), '2/3 Target') +
      cell(guess, 'Your Guess');

    // Earnings display
    const earnEl = document.getElementById('bc-earn-display');
    if (earnEl) {
      earnEl.textContent = (payoff > 0 ? '+' : '') + '$' + payoff.toFixed(2);
      earnEl.className   = 'bc-earn-display ' + (payoff > 0 ? 'win' : 'lose');
    }

    // Insight
    const insightEl = document.getElementById('bc-insight');
    if (insightEl) {
      let insight = '';
      if (distance < 1)       insight = 'Almost perfect! You anticipated the market with remarkable precision.';
      else if (distance < 5)  insight = `Very close — only ${distance.toFixed(1)} away from the target. Strong level-k reasoning.`;
      else if (distance < 15) insight = `${distance.toFixed(1)} away. The target was ${target.toFixed(1)}. Most players are Level-1 or Level-2 thinkers.`;
      else if (guess > target) insight = `You guessed too high by ${distance.toFixed(1)}. Most players underestimate how much others iterate down.`;
      else                     insight = `You guessed too low by ${distance.toFixed(1)}. The market average was higher than typical.`;
      insightEl.textContent = insight;
    }

    // Render result chart with player bar highlighted and target line
    this._renderHistory(true, target, cfg.historySize - 1, true);

    // Flash balance & update panel
    this._shell.flashBalance(payoff);
    this._updateRightPanel();
    this._addHistoryItem(s.round, guess, target, payoff);
  },

  // ── Add history item to right panel ─────────────────────────
  _addHistoryItem(round, guess, target, payoff) {
    const list = document.getElementById('bc-hist-list');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'bc-hist-item';
    item.style.animation = 'fadeUp .2s ease';
    const earnCls = payoff > 0 ? 'pos' : 'zero';
    item.innerHTML = `
      <div class="bc-hist-row">
        <span class="bc-hist-round">Round ${round}</span>
        <span class="bc-hist-earn ${earnCls}">${payoff > 0 ? '+' : ''}$${payoff.toFixed(2)}</span>
      </div>
      <div class="bc-hist-row">
        <span class="bc-hist-target">Guess: ${guess} · Target: ${target.toFixed(1)}</span>
        <span class="bc-hist-guess"></span>
      </div>`;
    list.insertBefore(item, list.firstChild);
  },

  // ── Next round ───────────────────────────────────────────────
  _nextRound() {
    const s = this._state;
    if (s.round >= s.totalRounds) {
      this._shell.onGameComplete();
      return;
    }
    s.round++;
    s.phase = 'input';

    // Reset UI
    document.getElementById('bc-input-area').style.display  = '';
    document.getElementById('bc-result-area').style.display = 'none';
    document.getElementById('bc-submit-btn').style.display  = '';
    document.getElementById('bc-next-btn').style.display    = 'none';
    const input = document.getElementById('bc-guess-input');
    if (input) { input.value = ''; input.focus(); }

    this._updateRightPanel();
  },

  // ── getResults ───────────────────────────────────────────────
  getResults() {
    const s   = this._state;
    const total = s.totalEarnings;
    const avgDist = s.roundHistory.length
      ? +(s.roundHistory.reduce((a, r) => a + r.distance, 0) / s.roundHistory.length).toFixed(2)
      : 0;
    const bestRound = s.roundHistory.reduce((b, r) => r.payoff > b.payoff ? r : b, s.roundHistory[0] || {payoff:0});
    let title, profile, analysis;
    if (avgDist < 5) {
      title = 'Market Oracle'; profile = 'The Strategic Thinker';
      analysis = `You finished ${avgDist.toFixed(1)} away from the target on average — top-tier level-k reasoning. Nagel (1995) found most players stop at Level 1 (guess ~33) or Level 2 (guess ~22). You consistently anticipated where the market would converge.`;
    } else if (avgDist < 15) {
      title = 'Calibrated Guesser'; profile = 'The Level-2 Reasoner';
      analysis = `Average distance of ${avgDist.toFixed(1)} — solid iterated thinking. You applied the 2/3 logic correctly but the market surprised you in some rounds. This is the median performance in experimental studies.`;
    } else if (total > 0) {
      title = 'Intuitive Player'; profile = 'The Level-1 Thinker';
      analysis = `You earned $${total.toFixed(2)} despite some wide misses. Most first-time players guess around 33 (Level-1: 2/3 of 50). The Nash equilibrium is 0, but markets rarely reach it in a single session.`;
    } else {
      title = 'Contrarian'; profile = 'The Level-0 Guesser';
      analysis = `Guessing near 50–100 means you expected others to guess randomly. In practice, most players already do one iteration (guess ~33), so the target is usually 18–25. Repeated play drives it lower.`;
    }
    return {
      title, profile, analysis,
      balanceDelta: total,
      stats: [
        { val: '$' + total.toFixed(2), label: 'Total Earnings' },
        { val: avgDist.toFixed(1),     label: 'Avg Distance' },
        { val: String(s.totalRounds),  label: 'Rounds Played' },
      ]
    };
  },

  // ── getSubmissionData ────────────────────────────────────────
  getSubmissionData() {
    const s   = this._state;
    const cfg = this._CONFIG;
    return {
      config: {
        rounds:        cfg.rounds,
        fraction:      cfg.fraction,
        history_size:  cfg.historySize,
        max_payoff:    cfg.maxPayoff,
        data_source:   'seed_phase1',   // will change to 'real_phase2' when live player data used
      },
      payoffs: {
        perfect_guess:  cfg.maxPayoff,
        payoff_formula: 'max(0, maxPayoff × (1 - distance/50))',
        zero_threshold: 50,             // distance >= 50 → $0
      },
      opponent_model: {
        type:   'nagel_1995_empirical',
        source: 'Nagel (1995) AER — Level-k distribution from lab experiments',
        seed_n: this._SEED_DATA.length,
      },
      rounds:           s.roundHistory.map(r => ({
        round:    r.round,
        guess:    r.guess,
        avg:      r.avg,
        target:   r.target,
        distance: r.distance,
        payoff:   r.payoff,
      })),
      avg_distance:     s.roundHistory.length
        ? +(s.roundHistory.reduce((a, r) => a + r.distance, 0) / s.roundHistory.length).toFixed(2)
        : null,
      total_earnings:   +s.totalEarnings.toFixed(2),
    };
  },

  // ── Destroy ──────────────────────────────────────────────────
  destroy() {
    this._state = null;
    this._shell = null;
  },

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); },
};

GameRegistry.register(GameBeautyContest);
