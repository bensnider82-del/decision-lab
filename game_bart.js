/* ============================================================
   DECISION LAB — GAME MODULE
   Game:     BART (Balloon Analogue Risk Task)
   ID:       bart
   Category: risky
   Status:   complete

   HOW TO SLOT THIS INTO THE MAIN SHELL:
   1. Copy the entire contents of this file
   2. In decision_lab_shell.html, paste it inside a <script> block
      ABOVE the "SHELL CONTROLLER" script block
   3. The last line — GameRegistry.register(GameBART) — registers it
   4. Done. The shell picks it up automatically.

   CONTRACT:
   This module satisfies the GameModule contract defined in the shell.
   See the shell for the full spec. In summary, every game must expose:
     id, name, shortName, category, intro, mount(), getResults(), destroy()
============================================================ */

const GameBART = {
  id:        'bart',
  name:      'The Balloon Game',
  shortName: 'BART',
  category:  'risky',   // 'risky' | 'theory' | 'probability'

  // ── intro overlay content ──────────────────────────────────
  intro: {
    title: 'The Balloon Game',
    desc:  'Each pump earns you $0.05. But every balloon has a secret breaking point — pump too far and it pops, and you lose everything earned this round.',
    rules: [
      'Pump the balloon to earn $0.05 per pump',
      'Cash out any time to bank your round earnings',
      'If the balloon pops, you earn $0 for that round',
      'Play 10 rounds — total earnings are added to your balance',
    ]
  },

  // ── internal state (always reset in mount()) ───────────────
  _state: null,
  _shell: null,

  // ── mount(container, shellAPI) ─────────────────────────────
  // Renders the game into container. Called by shell after intro.
  mount(container, shellAPI, hintsEnabled) {
    this._shell = shellAPI;
    this._state = {
      round:         1,
      totalRounds:   10,
      pumps:         0,
      roundEarnings: 0,
      breakPoint:    0,
      popCount:      0,
      history:       [],    // { round, pumps, result:'pop'|'cash', earned }
      active:        false,
      animating:     false,
    };

    container.innerHTML = this._html();
    this._bind();
    this._newBreakPoint();
    this._state.active = true;
    this._updateUI();
  },

  // ── HTML template ──────────────────────────────────────────
  _html() {
    return `
    <style>
      #bart-root {
        display:flex; height:100%; overflow:hidden;
        font-family:'DM Sans',sans-serif;
      }
      .bart-left {
        flex:1; display:flex; flex-direction:column;
        align-items:center; justify-content:center;
        padding:20px; gap:22px; position:relative;
      }
      .balloon-stage {
        position:relative; width:280px; height:280px;
        display:flex; align-items:flex-end; justify-content:center;
      }
      .balloon-wrap {
        position:absolute; bottom:0;
        display:flex; flex-direction:column; align-items:center;
      }
      #bart-balloon {
        transition:transform .08s ease, opacity .2s ease;
        filter:drop-shadow(0 8px 22px rgba(192,57,43,.2));
        transform-origin:center bottom;
      }
      #bart-string {
        width:2px; height:40px;
        background:linear-gradient(to bottom,#888,#aaa);
        border-radius:1px; transition:height .08s ease;
      }
      .bart-btns { display:flex; gap:14px; }
      #bart-pump, #bart-cash { width:126px; height:50px; }

      .bart-right {
        width:262px; flex-shrink:0;
        border-left:1px solid var(--border);
        background:var(--surface);
        display:flex; flex-direction:column; overflow:hidden;
      }
      .panel-sec  { padding:16px 18px; border-bottom:1px solid var(--border); }
      .panel-lbl  {
        font-family:'DM Mono',monospace; font-size:10px;
        letter-spacing:.12em; text-transform:uppercase;
        color:var(--muted); margin-bottom:9px;
      }
      .panel-big  { font-family:'DM Mono',monospace; font-size:32px; font-weight:500; color:var(--ink); }
      .panel-big-green { color:var(--green); }
      .panel-sub  { font-size:11px; color:var(--muted); margin-top:2px; }
      .round-row  { display:flex; justify-content:space-between; align-items:center; margin-bottom:7px; }
      .round-of   { font-size:13px; color:var(--muted); }
      .prog-bar   { height:3px; background:var(--border); border-radius:2px; overflow:hidden; }
      .prog-fill  { height:100%; background:var(--gold); border-radius:2px; transition:width .4s ease; }
      .risk-bg    { height:8px; background:var(--border); border-radius:4px; overflow:hidden; }
      .risk-fill  { height:100%; border-radius:4px; transition:width .15s ease, background .3s ease; }
      .risk-lbls  { display:flex; justify-content:space-between; font-size:10px; color:var(--muted); font-family:'DM Mono',monospace; margin-top:5px; }
      .hist-list  { flex:1; overflow-y:auto; padding:8px 18px; }
      .hist-item  {
        display:flex; justify-content:space-between; align-items:center;
        padding:7px 0; border-bottom:1px solid var(--border);
        animation:fadeUp .25s ease;
      }
      .hist-rnd   { font-family:'DM Mono',monospace; font-size:10px; color:var(--muted); }
      .hist-pumps { font-size:12px; }
      .hist-res   { font-family:'DM Mono',monospace; font-size:11px; font-weight:500; padding:2px 7px; border-radius:2px; }
      .hist-res.win { background:rgba(46,125,82,.12); color:var(--green); }
      .hist-res.pop { background:rgba(192,57,43,.12); color:var(--red); }

      #bart-explode {
        position:absolute; inset:0; z-index:10;
        display:flex; flex-direction:column;
        align-items:center; justify-content:center; gap:10px;
        background:rgba(245,240,232,.65);
        opacity:0; pointer-events:none; transition:opacity .2s ease;
      }
      #bart-explode.show { opacity:1; }
      .explode-emoji { font-size:72px; animation:popBurst .4s cubic-bezier(.36,.07,.19,.97); }
      @keyframes popBurst {
        0%   { transform:scale(.4); opacity:0; }
        40%  { transform:scale(1.3); opacity:1; }
        70%  { transform:scale(.9); }
        100% { transform:scale(1); }
      }
      .explode-txt { font-family:'Playfair Display',serif; font-size:24px; font-weight:700; color:var(--red); }
      .explode-sub { font-size:12px; color:var(--muted); font-family:'DM Mono',monospace; }
      .cash-flash  { position:absolute; inset:0; background:rgba(46,125,82,.07); opacity:0; pointer-events:none; transition:opacity .18s ease; }
    </style>

    <div id="bart-root">
      <div class="bart-left">
        <div class="cash-flash" id="bart-flash"></div>
        <div class="balloon-stage">
          <div class="balloon-wrap">
            <svg id="bart-balloon" width="110" height="128" viewBox="0 0 110 128">
              <defs>
                <radialGradient id="bGrad" cx="37%" cy="33%" r="62%">
                  <stop offset="0%" stop-color="#E8806A"/>
                  <stop offset="100%" stop-color="#C0392B"/>
                </radialGradient>
              </defs>
              <ellipse cx="55" cy="58" rx="44" ry="50" fill="url(#bGrad)"/>
              <ellipse cx="41" cy="44" rx="13" ry="10" fill="rgba(255,255,255,0.24)"/>
              <polygon points="50,106 60,106 55,118" fill="#A0302A"/>
            </svg>
            <div id="bart-string"></div>
          </div>
        </div>
        <div class="bart-btns">
          <button class="btn btn-dark"  id="bart-pump">▲ Pump</button>
          <button class="btn btn-green" id="bart-cash" disabled>$ Cash Out</button>
        </div>
        <div id="bart-explode">
          <div class="explode-emoji">💥</div>
          <div class="explode-txt">POP!</div>
          <div class="explode-sub" id="bart-explode-sub">Lost $0.00</div>
        </div>
      </div>

      <div class="bart-right">
        <div class="panel-sec">
          <div class="panel-lbl">Round</div>
          <div class="round-row">
            <div class="panel-big" id="bart-round-num">1</div>
            <div class="round-of">of 10</div>
          </div>
          <div class="prog-bar"><div class="prog-fill" id="bart-prog" style="width:10%"></div></div>
        </div>
        <div class="panel-sec">
          <div class="panel-lbl">At Risk This Round</div>
          <div class="panel-big panel-big-green" id="bart-earn">$0.00</div>
          <div class="panel-sub">lost if balloon pops</div>
        </div>
        <div class="panel-sec">
          <div class="panel-lbl">Pumps This Round</div>
          <div class="panel-big" id="bart-pumps">0</div>
          <div class="panel-sub">× $0.05 per pump</div>
        </div>
        <div class="panel-sec">
          <div class="panel-lbl">Risk Level</div>
          <div class="risk-bg"><div class="risk-fill" id="bart-risk" style="width:0%"></div></div>
          <div class="risk-lbls"><span>Safe</span><span>Danger</span></div>
        </div>
        <div class="panel-sec" style="padding-bottom:8px;">
          <div class="panel-lbl">Round History</div>
        </div>
        <div class="hist-list" id="bart-hist"></div>
      </div>
    </div>`;
  },

  // ── event binding ──────────────────────────────────────────
  _bind() {
    document.getElementById('bart-pump').addEventListener('click', () => this._pump());
    document.getElementById('bart-cash').addEventListener('click', () => this._cashOut());
  },

  // ── game logic ─────────────────────────────────────────────
  _newBreakPoint() {
    this._state.breakPoint = Math.floor(Math.random() * 64) + 1;
  },

  _updateUI() {
    const s = this._state;
    document.getElementById('bart-round-num').textContent = s.round;
    document.getElementById('bart-prog').style.width = (s.round / s.totalRounds * 100) + '%';
    document.getElementById('bart-pumps').textContent = s.pumps;
    document.getElementById('bart-earn').textContent  = '$' + s.roundEarnings.toFixed(2);

    const pct = Math.min((s.pumps / 40) * 100, 100);
    const bar = document.getElementById('bart-risk');
    bar.style.width = pct + '%';
    bar.style.background = pct < 40 ? 'var(--green)' : pct < 70 ? 'var(--gold)' : 'var(--red)';

    const scale = Math.min(1 + (s.pumps / 40) * 1.5, 2.8);
    document.getElementById('bart-balloon').style.transform = `scale(${scale})`;
    document.getElementById('bart-string').style.height = (40 + s.pumps * 1.3) + 'px';
    document.getElementById('bart-cash').disabled = s.pumps === 0;
  },

  _pump() {
    const s = this._state;
    if (!s.active || s.animating) return;
    s.pumps++;
    s.roundEarnings = +(s.pumps * 0.05).toFixed(2);
    if (s.pumps >= s.breakPoint) { this._triggerPop(); return; }
    this._updateUI();
  },

  async _triggerPop() {
    const s = this._state;
    s.animating = true; s.active = false;
    document.getElementById('bart-pump').disabled = true;
    document.getElementById('bart-cash').disabled = true;

    document.getElementById('bart-explode-sub').textContent = `Lost $${s.roundEarnings.toFixed(2)} this round`;
    document.getElementById('bart-explode').classList.add('show');
    document.getElementById('bart-balloon').style.opacity = '0';
    document.getElementById('bart-string').style.opacity  = '0';

    s.popCount++;
    s.history.push({ round: s.round, pumps: s.pumps, result: 'pop', earned: 0, breakpoint: s.breakPoint });
    this._addHistItem(s.round, s.pumps, 'pop', 0);

    await this._delay(1700);
    document.getElementById('bart-explode').classList.remove('show');
    await this._delay(280);
    this._nextRound();
  },

  async _cashOut() {
    const s = this._state;
    if (!s.active || s.pumps === 0 || s.animating) return;
    s.animating = true; s.active = false;

    const earned = s.roundEarnings;
    s.history.push({ round: s.round, pumps: s.pumps, result: 'cash', earned, breakpoint: s.breakPoint });
    this._addHistItem(s.round, s.pumps, 'cash', earned);

    const flash = document.getElementById('bart-flash');
    flash.style.opacity = '1';
    await this._delay(180);
    flash.style.opacity = '0';

    this._shell.flashBalance(earned);
    await this._delay(650);
    this._nextRound();
  },

  _addHistItem(round, pumps, result, earned) {
    const list = document.getElementById('bart-hist');
    const el = document.createElement('div');
    el.className = 'hist-item';
    el.innerHTML = `
      <span class="hist-rnd">R${round}</span>
      <span class="hist-pumps">${pumps} pumps</span>
      <span class="hist-res ${result === 'pop' ? 'pop' : 'win'}">
        ${result === 'pop' ? '💥 POP' : '+$' + earned.toFixed(2)}
      </span>`;
    list.insertBefore(el, list.firstChild);
  },

  _nextRound() {
    const s = this._state;
    if (s.round >= s.totalRounds) {
      this._shell.onGameComplete();
      return;
    }
    s.round++;
    s.pumps = 0; s.roundEarnings = 0;
    s.animating = false; s.active = true;
    this._newBreakPoint();

    document.getElementById('bart-balloon').style.opacity   = '1';
    document.getElementById('bart-balloon').style.transform = 'scale(1)';
    document.getElementById('bart-string').style.opacity    = '1';
    document.getElementById('bart-string').style.height     = '40px';
    document.getElementById('bart-pump').disabled = false;
    this._updateUI();
  },

  // ── getResults() — called by shell after game ends ─────────
  getResults() {
    const s = this._state;
    const avgPumps   = Math.round(s.history.reduce((a, r) => a + r.pumps, 0) / s.history.length);
    const popRate    = s.popCount / s.totalRounds;
    const totalEarned = s.history.reduce((a, r) => a + r.earned, 0);

    let title, profile, analysis;
    if (popRate >= 0.7) {
      title    = 'High Roller';
      profile  = 'The Fearless Risk-Seeker';
      analysis = `You popped ${s.popCount} of 10 balloons — a hallmark of risk-seeking behaviour. You systematically overweighted expected value relative to variance. The empirically optimal BART strategy averages 25–32 pumps per balloon.`;
    } else if (popRate <= 0.2 && avgPumps < 15) {
      title    = 'Playing It Safe';
      profile  = 'The Loss-Averse Strategist';
      analysis = `With only ${s.popCount} pops and ${avgPumps} pumps on average, you cashed out early and often. Loss aversion — weighting losses more heavily than equivalent gains — is at work here. You left expected earnings on the table.`;
    } else {
      title    = 'Well Calibrated';
      profile  = 'The Rational Risk-Balancer';
      analysis = `With ${s.popCount} pops and ${avgPumps} pumps per balloon on average, your behaviour tracks close to the theoretically optimal BART strategy. You intuitively balance expected value against variance.`;
    }

    return {
      title,
      profile,
      analysis,
      balanceDelta: totalEarned,
      stats: [
        { val: '$' + totalEarned.toFixed(2), label: 'BART Earnings' },
        { val: String(s.popCount),            label: 'Balloons Popped' },
        { val: String(avgPumps),              label: 'Avg. Pumps' },
      ]
    };
  },

  // ── destroy() — called by shell on unmount ─────────────────
  getSubmissionData() {
    const s = this._state;
    const pumpsArr    = s.history.map(r => r.pumps);
    const poppedArr   = s.history.map(r => r.result === 'pop');
    const bpArr       = s.history.map(r => r.breakpoint);   // now always present
    const earnedArr   = s.history.map(r => r.earned);
    const totalPumps  = pumpsArr.reduce((a, b) => a + b, 0);
    const avgPumps    = +(totalPumps / pumpsArr.length).toFixed(2);
    const popRate     = +(s.popCount / s.totalRounds).toFixed(3);
    const nonPopped   = s.history.filter(r => r.result !== 'pop');
    const adjAvg      = nonPopped.length > 0
      ? +(nonPopped.reduce((a, r) => a + r.pumps, 0) / nonPopped.length).toFixed(2) : 0;
    const totalEarned = +s.history.reduce((a, r) => a + r.earned, 0).toFixed(2);
    let riskProfile = 'calibrated';
    if (popRate >= 0.7)                  riskProfile = 'risk_seeker';
    if (popRate <= 0.2 && avgPumps < 15) riskProfile = 'loss_averse';
    return {
      // ── Game configuration (snapshot at time of play) ──────
      config: {
        total_rounds:       s.totalRounds,          // 10
        earnings_per_pump:  0.05,                   // $0.05 per pump
        breakpoint_min:     1,                      // uniform draw min
        breakpoint_max:     64,                     // uniform draw max — key for A/B testing
      },
      // ── Payoff structure ────────────────────────────────────
      payoffs: {
        pop_payoff:         0,                      // always $0 on pop
        cashout_payoff:     'pumps × $0.05',        // formula
      },
      // ── Per-round data ──────────────────────────────────────
      rounds_played:       pumpsArr.length,
      pumps_per_round:     pumpsArr,
      result_per_round:    s.history.map(r => r.result),  // 'pop' | 'cash'
      earned_per_round:    earnedArr,
      breakpoint_per_round: bpArr,                 // the actual hidden breakpoint each round
      // ── Summary stats ───────────────────────────────────────
      avg_pumps:           avgPumps,
      pop_rate:            popRate,
      adjusted_avg_pumps:  adjAvg,                 // standard BART metric (non-popped only)
      total_earnings:      totalEarned,
      risk_profile:        riskProfile,
    };
  },

  destroy() {
    this._state = null;
    this._shell = null;
  },

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); },
};

// Register with the shell — this is the only line that touches global scope
GameRegistry.register(GameBART);
