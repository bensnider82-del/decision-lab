/* ============================================================
   DECISION LAB — GAME MODULE
   Game:     Dutch Auction (Descending Clock)
   ID:       dutch-auction
   Category: theory
   Status:   complete (Phase 1 — academic baseline)

   SETTING:
   Independent Private Values (IPV), Uniform[0, 100].
   N = 3 total bidders (player + 2 simulated opponents).
   Clock descends from 100 → 0. First to stop the clock wins
   and pays that price. Payoff = value - bid (if winner), 0 if lose.

   ACADEMIC BASELINE (Phase 1):
   ─────────────────────────────────────────────────────────────
   PRIMARY SOURCE: Cox, Smith & Walker (1982, 1983, 1988)
   "Theory and Individual Behavior of First-Price Auctions"
   Journal of Risk and Uncertainty 1(1): 61-99

   KEY FINDINGS ENCODED:
   1. OVERBIDDING IS UNIVERSAL: Real bidders consistently bid
      above the risk-neutral Nash equilibrium (RNNE).
      RNNE for N=3, Uniform[0,100]: bid = v * (N-1)/N = v * 2/3
      Observed bids average roughly 15-25% above RNNE.

   2. CRRA MODEL: Cox, Smith & Walker show bids are best
      explained by constant relative risk aversion (CRRA):
        b*(v) = v * (N-1) / (N - 1 + r)
      where r in (0,1) is the risk aversion parameter.
      Empirically estimated r ~ 0.5 (midpoint of their range).
      For N=3, r=0.5: b*(v) = v * 2/2.5 = 0.80v

   3. VALUE-DEPENDENT PATTERN: Overbidding strongest at high
      values; low-value bidders sometimes underbid RNNE.
      (Neugebauer & Selten 2006; Cox, Smith & Walker 1988)

   4. DUTCH NON-ISOMORPHISM: Dutch clock auctions produce
      systematically lower bids than sealed-bid first-price
      auctions, even with identical incentives. Clock-speed
      effect ~ 8% downward adjustment vs. sealed-bid.
      (Coppinger, Smith & Titus 1980; Cox, Smith & Walker 1983)

   OPPONENT MODEL IMPLEMENTATION:
   Each opponent draws r ~ Uniform(0.30, 0.70) at game start
   (individual heterogeneity in risk aversion, per CSW 1988).
   Opponent bid = v_opp * (N-1) / (N-1+r) * clock_discount
   clock_discount = 0.92 (Dutch non-isomorphism adjustment)
   Plus noise: N(0, sd=4) truncated to [0, v_opp]
   This produces the empirically observed spread and overbidding
   pattern without mechanical uniformity.

   GAME THEORY INSIGHT DELIVERED:
   - Nash equilibrium: bid = 2/3 of your value (risk-neutral)
   - Revealed: most people bid ~75-85% of value (risk-averse)
   - Lesson: bid shading is optimal, but HOW MUCH to shade
     depends on the number of competitors and your risk attitude
============================================================ */

const GameDutchAuction = {
  id:        'dutch-auction',
  name:      'The Dutch Auction',
  shortName: 'Dutch Auction',
  category:  'theory',

  // ── Config ─────────────────────────────────────────────────
  _CONFIG: {
    N:             3,       // total bidders including player
    valueMin:      0,
    valueMax:      100,
    clockMin:      0,
    clockMax:      100,
    clockSpeed:    50,      // ms per tick (clock drops 1 unit per tick)
    rounds:        5,       // rounds per session
    // CRRA baseline (CSW 1988)
    riskAversion:  { min: 0.30, max: 0.70 },
    clockDiscount: 0.92,    // Dutch non-isomorphism (Coppinger et al. 1980)
    noiseSD:       4,       // bid noise std dev
  },

  _state: null,
  _shell: null,
  _hintsEnabled: false,
  _clockInterval: null,

  // ── Intro ───────────────────────────────────────────────────
  intro: {
    title: 'The Dutch Auction',
    desc:  'The price starts high and falls. Stop the clock to place your bid — but if you wait too long, someone else might win first. You know your private value and that all other bidders draw from the same uniform distribution.',
    rules: [
      'You are assigned a private value (0–100) — your max willingness to pay',
      'The clock descends from 100 → 0. Stop it to bid at that price',
      'The first bidder to stop the clock wins and pays that price',
      'Payoff = your value minus your winning bid (profit if positive)',
      'If you don\'t stop in time, another bidder wins',
      'There are 3 total bidders — you and 2 simulated opponents',
    ]
  },

  // ── Mount ───────────────────────────────────────────────────
  mount(container, shellAPI, hintsEnabled) {
    this._hintsEnabled = !!hintsEnabled;
    this._shell = shellAPI;
    this._state = {
      round:         1,
      totalRounds:   this._CONFIG.rounds,
      value:         0,
      clockPrice:    this._CONFIG.clockMax,
      running:       false,
      won:           false,
      roundOver:     false,
      history:       [],
      totalEarnings: 0,
      opponentBids:  [],    // [{value, bid, r}] for each opponent this round
      animating:     false,
    };

    container.innerHTML = this._html();
    this._bindEvents();
    this._startRound();
  },

  // ── HTML ────────────────────────────────────────────────────
  _html() {
    return `
    <style>
      #dutch-root {
        display:flex; height:100%; overflow:hidden;
        font-family:'DM Sans',sans-serif;
      }

      /* ── MAIN AREA ── */
      .dutch-main {
        flex:1; display:flex; flex-direction:column;
        align-items:center; justify-content:center;
        padding:24px; gap:20px; position:relative;
        background:var(--cream);
      }

      /* ── BID PRICE (above clock) ── */
      .dutch-bid-display {
        text-align:center;
      }
      .dutch-bid-label {
        font-family:'DM Mono',monospace; font-size:10px;
        letter-spacing:.16em; text-transform:uppercase;
        color:var(--muted); margin-bottom:4px;
      }
      .dutch-bid-price {
        font-family:'Playfair Display',serif;
        font-size:clamp(56px,7vw,80px);
        font-weight:900; line-height:1;
        color:var(--ink); transition:color .15s ease;
      }
      .dutch-bid-price.danger { color:var(--red); }
      .dutch-bid-price.safe   { color:var(--green); }
      .dutch-bid-sub {
        font-family:'DM Mono',monospace; font-size:11px;
        color:var(--muted); margin-top:4px;
      }

      /* ── CLOCK RING ── */
      .dutch-clock-wrap {
        position:relative; width:200px; height:200px;
        display:flex; align-items:center; justify-content:center;
        flex-shrink:0;
      }
      .dutch-clock-svg {
        position:absolute; inset:0; transform:rotate(-90deg);
      }
      .clock-track {
        fill:none; stroke:var(--border-solid); stroke-width:10;
      }
      .clock-progress {
        fill:none; stroke-width:10;
        stroke-linecap:round;
        transition:stroke-dashoffset .05s linear, stroke .3s ease;
      }
      .dutch-clock-pct {
        font-family:'DM Mono',monospace; font-size:32px;
        font-weight:500; color:var(--ink);
        text-align:center; line-height:1;
      }
      .dutch-clock-sub {
        font-family:'DM Mono',monospace; font-size:10px;
        letter-spacing:.1em; text-transform:uppercase;
        color:var(--muted); text-align:center; margin-top:2px;
      }

      /* ── BID BUTTON ── */
      .dutch-bid-btn-wrap {
        display:flex; flex-direction:column; align-items:center; gap:8px;
      }
      #dutch-bid-btn {
        width:180px; height:60px; font-size:14px;
        letter-spacing:.12em;
        transition:transform .08s ease, background .15s ease, box-shadow .15s ease;
      }
      #dutch-bid-btn:not(:disabled):hover {
        transform:scale(1.04);
        box-shadow:0 6px 20px rgba(26,22,18,.18);
      }
      #dutch-bid-btn:not(:disabled):active { transform:scale(.97); }
      .dutch-bid-note {
        font-size:11px; color:var(--muted);
        font-family:'DM Mono',monospace; text-align:center;
      }

      /* ── PROFIT PREVIEW ── */
      .dutch-profit-preview {
        display:flex; align-items:center; gap:20px;
      }
      .dutch-pp-card {
        background:var(--surface); border:1px solid var(--border);
        border-radius:4px; padding:10px 16px; text-align:center;
        min-width:110px;
      }
      .dutch-pp-label {
        font-family:'DM Mono',monospace; font-size:9px;
        letter-spacing:.12em; text-transform:uppercase;
        color:var(--muted); margin-bottom:5px;
      }
      .dutch-pp-val {
        font-family:'DM Mono',monospace; font-size:17px;
        font-weight:500;
      }
      .dutch-pp-val.positive { color:var(--green); }
      .dutch-pp-val.negative { color:var(--red); }
      .dutch-pp-val.neutral  { color:var(--muted); }
      .dutch-pp-arrow { font-size:18px; color:var(--muted); }

      /* ── OUTCOME OVERLAY ── */
      #dutch-outcome {
        position:absolute; inset:0; z-index:20;
        background:rgba(245,240,232,.95);
        display:flex; flex-direction:column;
        align-items:center; justify-content:center;
        gap:12px; opacity:0; pointer-events:none;
        transition:opacity .3s ease; text-align:center; padding:2rem;
      }
      #dutch-outcome.show { opacity:1; pointer-events:auto; }
      .dutch-out-emoji { font-size:52px; }
      .dutch-out-title {
        font-family:'Playfair Display',serif;
        font-size:26px; font-weight:900; color:var(--ink);
      }
      .dutch-out-sub {
        font-size:13px; color:var(--muted);
        max-width:340px; line-height:1.65;
      }
      .dutch-out-earn {
        font-family:'DM Mono',monospace; font-size:20px;
        font-weight:500; padding:8px 20px; border-radius:4px;
      }
      .dutch-out-earn.win {
        color:var(--green);
        background:rgba(46,125,82,.1);
        border:1px solid rgba(46,125,82,.2);
      }
      .dutch-out-earn.lose {
        color:var(--muted);
        background:rgba(26,22,18,.06);
        border:1px solid var(--border-solid);
      }
      .dutch-out-theory {
        font-size:11px; color:var(--muted);
        font-family:'DM Mono',monospace;
        border:1px solid var(--border-solid);
        padding:5px 14px; border-radius:2px; max-width:340px;
        line-height:1.55; text-align:center;
      }

      /* ── RIGHT PANEL ── */
      .dutch-right {
        width:262px; flex-shrink:0;
        border-left:1px solid var(--border);
        background:var(--surface);
        display:flex; flex-direction:column; overflow:hidden;
      }
      .dutch-panel-sec {
        padding:14px 16px; border-bottom:1px solid var(--border);
      }
      .dutch-panel-lbl {
        font-family:'DM Mono',monospace; font-size:10px;
        letter-spacing:.12em; text-transform:uppercase;
        color:var(--muted); margin-bottom:8px;
      }
      .dutch-stat-big {
        font-family:'DM Mono',monospace; font-size:28px;
        font-weight:500; color:var(--ink);
      }
      .dutch-stat-sub { font-size:11px; color:var(--muted); margin-top:2px; }
      .dutch-value-bar-bg {
        height:6px; background:var(--border); border-radius:3px;
        overflow:hidden; margin-top:8px;
      }
      .dutch-value-bar-fill {
        height:100%; border-radius:3px; background:var(--gold);
        transition:width .4s ease;
      }

      /* Nash line in value bar */
      .dutch-value-bar-wrap {
        position:relative; margin-top:8px;
      }
      .dutch-nash-marker {
        position:absolute; top:-4px;
        width:2px; height:14px; background:var(--ink);
        border-radius:1px;
      }
      .dutch-nash-label {
        position:absolute; top:12px;
        font-family:'DM Mono',monospace; font-size:8px;
        color:var(--ink); white-space:nowrap;
        transform:translateX(-50%);
      }

      .dutch-hist-list { flex:1; overflow-y:auto; padding:8px 16px; }
      .dutch-hist-item {
        display:flex; justify-content:space-between; align-items:center;
        padding:6px 0; border-bottom:1px solid var(--border);
        animation:fadeUp .2s ease;
      }
      .dutch-hist-rnd  { font-family:'DM Mono',monospace; font-size:10px; color:var(--muted); }
      .dutch-hist-info { font-size:12px; color:var(--ink); }
      .dutch-hist-res  {
        font-family:'DM Mono',monospace; font-size:11px;
        font-weight:500; padding:2px 7px; border-radius:2px;
      }
      .dutch-hist-res.win  { background:rgba(46,125,82,.12); color:var(--green); }
      .dutch-hist-res.lose { background:rgba(26,22,18,.06);   color:var(--muted); }

      /* Round progress */
      .dutch-round-prog { height:3px; background:var(--border); border-radius:2px; overflow:hidden; margin-top:8px; }
      .dutch-round-fill { height:100%; background:var(--gold); border-radius:2px; transition:width .4s ease; }
    </style>

    <div id="dutch-root">
      <!-- MAIN -->
      <div class="dutch-main">

        <!-- Bid price (above clock) -->
        <div class="dutch-bid-display">
          <div class="dutch-bid-label">Current Bid Price</div>
          <div class="dutch-bid-price" id="dutch-price">100</div>
          <div class="dutch-bid-sub" id="dutch-price-sub">Waiting to start...</div>
        </div>

        <!-- Clock ring -->
        <div class="dutch-clock-wrap">
          <svg class="dutch-clock-svg" viewBox="0 0 200 200">
            <circle class="clock-track"    cx="100" cy="100" r="85"/>
            <circle class="clock-progress" cx="100" cy="100" r="85"
              id="dutch-clock-arc"
              stroke="#C8A84B"
              stroke-dasharray="534"
              stroke-dashoffset="0"/>
          </svg>
          <div>
            <div class="dutch-clock-pct" id="dutch-clock-pct">100%</div>
            <div class="dutch-clock-sub">elapsed</div>
          </div>
        </div>

        <!-- Bid button (below clock) -->
        <div class="dutch-bid-btn-wrap">
          <button class="btn btn-dark" id="dutch-bid-btn" disabled>Stop Clock — Bid</button>
          <div class="dutch-bid-note" id="dutch-bid-note">Start the round to begin</div>
        </div>

        <!-- Profit preview -->
        <div class="dutch-profit-preview">
          <div class="dutch-pp-card">
            <div class="dutch-pp-label">Your Value</div>
            <div class="dutch-pp-val neutral" id="dutch-pp-value">—</div>
          </div>
          <div class="dutch-pp-arrow">−</div>
          <div class="dutch-pp-card">
            <div class="dutch-pp-label">Bid Price</div>
            <div class="dutch-pp-val neutral" id="dutch-pp-bid">—</div>
          </div>
          <div class="dutch-pp-arrow">=</div>
          <div class="dutch-pp-card">
            <div class="dutch-pp-label">Your Profit</div>
            <div class="dutch-pp-val neutral" id="dutch-pp-profit">—</div>
          </div>
        </div>

        <!-- Outcome overlay -->
        <div id="dutch-outcome">
          <div class="dutch-out-emoji" id="dutch-out-emoji">🏆</div>
          <div class="dutch-out-title" id="dutch-out-title">You won!</div>
          <div class="dutch-out-sub"   id="dutch-out-sub"></div>
          <div class="dutch-out-earn"  id="dutch-out-earn">+$0.00</div>
          <div class="dutch-out-theory" id="dutch-out-theory"></div>
        </div>
      </div>

      <!-- RIGHT PANEL -->
      <div class="dutch-right">

        <div class="dutch-panel-sec">
          <div class="dutch-panel-lbl">Round</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div class="dutch-stat-big" id="dutch-round-num">1</div>
            <div style="font-size:12px;color:var(--muted);" id="dutch-round-of">of 5</div>
          </div>
          <div class="dutch-round-prog">
            <div class="dutch-round-fill" id="dutch-round-fill" style="width:20%"></div>
          </div>
        </div>

        <div class="dutch-panel-sec">
          <div class="dutch-panel-lbl">Your Private Value</div>
          <div class="dutch-stat-big" id="dutch-value-display" style="color:var(--gold);">—</div>
          <div class="dutch-stat-sub">drawn from Uniform[0, 100]</div>
          <!-- Value + Nash bar -->
          <div class="dutch-value-bar-wrap">
            <div class="dutch-value-bar-bg">
              <div class="dutch-value-bar-fill" id="dutch-value-bar" style="width:0%"></div>
            </div>
            <div class="dutch-nash-marker" id="dutch-nash-marker" style="left:0%"></div>
            <div class="dutch-nash-label"  id="dutch-nash-label">Nash</div>
          </div>
          <div class="dutch-stat-sub" style="margin-top:10px;" id="dutch-nash-info">Nash bid: — (2/3 of value)</div>
          <div id="dutch-nash-wrap"></div>
        </div>

        <div class="dutch-panel-sec">
          <div class="dutch-panel-lbl">Session Earnings</div>
          <div class="dutch-stat-big" id="dutch-total-earn" style="color:var(--green);">$0.00</div>
          <div class="dutch-stat-sub">added to your balance</div>
        </div>

        <div class="dutch-panel-sec" style="padding-bottom:8px;">
          <div class="dutch-panel-lbl">Round History</div>
        </div>
        <div class="dutch-hist-list" id="dutch-hist"></div>
      </div>
    </div>`;
  },

  // ── Events ──────────────────────────────────────────────────
  _bindEvents() {
    document.getElementById('dutch-bid-btn')
      .addEventListener('click', () => this._playerBid());
  },

  // ── Start a round ───────────────────────────────────────────
  _startRound() {
    const s   = this._state;
    const cfg = this._CONFIG;

    // Draw player value
    s.value      = Math.floor(Math.random() * (cfg.valueMax - cfg.valueMin + 1)) + cfg.valueMin;
    s.clockPrice = cfg.clockMax;
    s.running    = false;
    s.won        = false;
    s.roundOver  = false;
    s.animating  = false;

    // Draw opponent bids upfront (they bid as if sealed-bid at game start,
    // but we reveal their stopping point only when the clock reaches it)
    s.opponentBids = this._drawOpponentBids();

    // Update static UI
    this._updateRoundHeader();
    this._updateValuePanel();
    this._updateClockDisplay(cfg.clockMax);
    this._updateProfitPreview(cfg.clockMax);

    document.getElementById('dutch-outcome').classList.remove('show');
    document.getElementById('dutch-bid-btn').disabled = false;
    document.getElementById('dutch-bid-note').textContent =
      'Press to stop the clock and bid at that price';

    // Short delay then start clock
    setTimeout(() => this._runClock(), 600);
  },

  // ── Generate opponent bids ──────────────────────────────────
  // CRRA model: b*(v) = v * (N-1) / (N-1+r) * clockDiscount + noise
  _drawOpponentBids() {
    const cfg = this._CONFIG;
    const opponents = [];
    const N = cfg.N;

    for (let i = 0; i < N - 1; i++) {
      const v = Math.floor(Math.random() * (cfg.valueMax - cfg.valueMin + 1)) + cfg.valueMin;
      const r = cfg.riskAversion.min +
                Math.random() * (cfg.riskAversion.max - cfg.riskAversion.min);

      // CRRA bid formula (CSW 1988)
      const crraBid = v * (N - 1) / (N - 1 + r);

      // Dutch clock discount (Coppinger, Smith & Titus 1980)
      const discountedBid = crraBid * cfg.clockDiscount;

      // Add Gaussian noise, truncated to [0, v]
      const noise = this._gaussianNoise(0, cfg.noiseSD);
      const finalBid = Math.max(0, Math.min(v, Math.round(discountedBid + noise)));

      opponents.push({ value: v, bid: finalBid, r: +r.toFixed(2) });
    }

    return opponents;
  },

  // ── Run the clock ───────────────────────────────────────────
  _runClock() {
    const s   = this._state;
    const cfg = this._CONFIG;
    s.running = true;

    this._clockInterval = setInterval(() => {
      if (s.roundOver) { clearInterval(this._clockInterval); return; }

      s.clockPrice = Math.max(cfg.clockMin, s.clockPrice - 1);
      this._updateClockDisplay(s.clockPrice);
      this._updateProfitPreview(s.clockPrice);

      // Check if any opponent bids at this price
      const opponentWinner = s.opponentBids.find(o => o.bid === s.clockPrice);
      if (opponentWinner) {
        clearInterval(this._clockInterval);
        s.running = false;
        this._opponentWins(opponentWinner);
        return;
      }

      // Clock hits 0 — nobody bid
      if (s.clockPrice <= cfg.clockMin) {
        clearInterval(this._clockInterval);
        s.running = false;
        this._noBidOutcome();
      }
    }, cfg.clockSpeed);
  },

  // ── Player stops clock ──────────────────────────────────────
  _playerBid() {
    const s = this._state;
    if (s.roundOver || s.animating) return;
    if (!s.running && s.clockPrice === this._CONFIG.clockMax) {
      // Player bid before clock even started — treat as bid at 100
    }

    clearInterval(this._clockInterval);
    s.running   = false;
    s.roundOver = true;

    const bid    = s.clockPrice;
    const profit = Math.max(0, s.value - bid);
    // Player wins (they stopped clock first — no opponent had bid yet at this or higher price)
    // Check if opponent's bid is >= player's bid (opponent would have stopped before this)
    const beatByOpponent = s.opponentBids.find(o => o.bid >= bid);

    if (beatByOpponent) {
      // Opponent would have stopped at a higher price — opponent won
      this._opponentWins(beatByOpponent, true);
    } else {
      // Player wins
      this._playerWins(bid, profit);
    }
  },

  // ── Player wins ─────────────────────────────────────────────
  async _playerWins(bid, profit) {
    const s   = this._state;
    s.won     = true;
    s.animating = true;

    const cfg      = this._CONFIG;
    const N        = cfg.N;
    const nashBid  = Math.round(s.value * (N - 1) / N);
    const crraBid  = Math.round(s.value * (N - 1) / (N - 1 + 0.5) * cfg.clockDiscount);
    const deviation = bid - nashBid;
    const deviationLabel = deviation > 0
      ? `${deviation} above Nash`
      : deviation < 0
      ? `${Math.abs(deviation)} below Nash`
      : 'exactly at Nash';

    s.history.push({ round: s.round, won: true, value: s.value, bid, profit });
    s.totalEarnings = +(s.totalEarnings + profit).toFixed(2);

    document.getElementById('dutch-out-emoji').textContent = profit > 0 ? '🏆' : '😬';
    document.getElementById('dutch-out-title').textContent = profit > 0 ? 'You won!' : 'You won — at a loss';
    document.getElementById('dutch-out-sub').textContent =
      `You stopped the clock at ${bid} with a value of ${s.value}. ` +
      `Profit: $${profit.toFixed(2)}. Your bid was ${deviationLabel} equilibrium.`;
    document.getElementById('dutch-out-earn').textContent = `+$${profit.toFixed(2)}`;
    document.getElementById('dutch-out-earn').className =
      `dutch-out-earn ${profit > 0 ? 'win' : 'lose'}`;
    document.getElementById('dutch-out-theory').textContent =
      `Nash bid (risk-neutral, N=3): ${nashBid}  ·  ` +
      `CRRA bid (r=0.5, empirical): ${crraBid}  ·  Your bid: ${bid}`;

    this._addHistItem(s.round, s.value, bid, true, profit);
    document.getElementById('dutch-total-earn').textContent =
      '$' + s.totalEarnings.toFixed(2);

    await this._delay(200);
    document.getElementById('dutch-outcome').classList.add('show');
    await this._delay(600);
    this._shell.flashBalance(profit);
    document.getElementById('dutch-bid-btn').disabled = true;

    await this._delay(3500);
    this._nextRound();
  },

  // ── Opponent wins ───────────────────────────────────────────
  async _opponentWins(opponent, playerTriedToBid = false) {
    const s = this._state;
    s.roundOver = true;
    s.animating = true;

    s.history.push({ round: s.round, won: false, value: s.value, bid: null, profit: 0 });

    const cfg      = this._CONFIG;
    const N        = cfg.N;
    const nashBid  = Math.round(s.value * (N - 1) / N);

    document.getElementById('dutch-out-emoji').textContent = '🤦';
    document.getElementById('dutch-out-title').textContent = playerTriedToBid
      ? 'Too late — opponent bid higher'
      : 'Opponent stopped the clock first';
    document.getElementById('dutch-out-sub').textContent =
      `An opponent (value: ${opponent.value}) bid ${opponent.bid} and won. ` +
      `Your value was ${s.value} — your Nash optimal bid would have been ${nashBid}. ` +
      `You earn $0 this round.`;
    document.getElementById('dutch-out-earn').textContent = `$0.00`;
    document.getElementById('dutch-out-earn').className   = 'dutch-out-earn lose';
    document.getElementById('dutch-out-theory').textContent =
      `Nash bid for your value (N=3): ${nashBid}  ·  ` +
      `Opponent bid: ${opponent.bid} (value: ${opponent.value}, r: ${opponent.r})`;

    this._addHistItem(s.round, s.value, null, false, 0);
    document.getElementById('dutch-bid-btn').disabled = true;

    await this._delay(200);
    document.getElementById('dutch-outcome').classList.add('show');
    await this._delay(3500);
    this._nextRound();
  },

  // ── Nobody bids ─────────────────────────────────────────────
  async _noBidOutcome() {
    const s = this._state;
    s.roundOver = true;
    s.animating = true;

    s.history.push({ round: s.round, won: false, value: s.value, bid: null, profit: 0 });

    document.getElementById('dutch-out-emoji').textContent = '⌛';
    document.getElementById('dutch-out-title').textContent = 'Clock ran out';
    document.getElementById('dutch-out-sub').textContent =
      `Nobody placed a bid. Your value was ${s.value}. You earn $0 this round.`;
    document.getElementById('dutch-out-earn').textContent = `$0.00`;
    document.getElementById('dutch-out-earn').className   = 'dutch-out-earn lose';
    document.getElementById('dutch-out-theory').textContent =
      `This is extremely rare — it suggests all bidders had very low values relative to the clock floor.`;

    this._addHistItem(s.round, s.value, null, false, 0);
    document.getElementById('dutch-bid-btn').disabled = true;

    await this._delay(200);
    document.getElementById('dutch-outcome').classList.add('show');
    await this._delay(3000);
    this._nextRound();
  },

  // ── Next round ──────────────────────────────────────────────
  _nextRound() {
    const s = this._state;
    if (s.round >= s.totalRounds) {
      this._shell.onGameComplete();
      return;
    }
    s.round++;
    this._startRound();
  },

  // ── Clock display ───────────────────────────────────────────
  _updateClockDisplay(price) {
    const pct = price / this._CONFIG.clockMax;
    const circumference = 2 * Math.PI * 85; // r=85

    const priceEl = document.getElementById('dutch-price');
    const pctEl   = document.getElementById('dutch-clock-pct');
    const arcEl   = document.getElementById('dutch-clock-arc');
    const subEl   = document.getElementById('dutch-price-sub');

    if (!priceEl) return;
    priceEl.textContent = price;
    pctEl.textContent   = price + '%';

    // Colour transitions: gold → amber → red as price falls
    priceEl.classList.remove('danger', 'safe');
    if (price < 25)      priceEl.classList.add('danger');
    else if (price > 60) priceEl.classList.add('safe');

    // Arc: full at 100, empty at 0
    arcEl.style.strokeDashoffset = circumference * (1 - pct);
    arcEl.style.stroke = price > 60 ? '#C8A84B' : price > 25 ? '#D4860A' : '#C0392B';

    if (subEl) subEl.textContent = `Bid this price · ${price}% of max`;
  },

  // ── Profit preview ──────────────────────────────────────────
  _updateProfitPreview(price) {
    const s = this._state;
    const valueEl  = document.getElementById('dutch-pp-value');
    const bidEl    = document.getElementById('dutch-pp-bid');
    const profitEl = document.getElementById('dutch-pp-profit');
    if (!valueEl) return;

    const profit = s.value - price;
    valueEl.textContent  = s.value;
    valueEl.className    = 'dutch-pp-val neutral';
    bidEl.textContent    = price;
    bidEl.className      = 'dutch-pp-val neutral';
    profitEl.textContent = profit >= 0 ? `+${profit}` : profit;
    profitEl.className   = `dutch-pp-val ${profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral'}`;
  },

  // ── Round header ─────────────────────────────────────────────
  _updateRoundHeader() {
    const s = this._state;
    const el = document.getElementById('dutch-round-num');
    const of = document.getElementById('dutch-round-of');
    const fill = document.getElementById('dutch-round-fill');
    if (el)   el.textContent   = s.round;
    if (of)   of.textContent   = `of ${s.totalRounds}`;
    if (fill) fill.style.width = (s.round / s.totalRounds * 100) + '%';
  },

  // ── Value panel ──────────────────────────────────────────────
  _updateValuePanel() {
    const s   = this._state;
    const cfg = this._CONFIG;
    const N   = cfg.N;

    const nashBid = Math.round(s.value * (N - 1) / N);
    const nashPct = (nashBid / cfg.valueMax) * 100;

    const vd   = document.getElementById('dutch-value-display');
    const vb   = document.getElementById('dutch-value-bar');
    const nm   = document.getElementById('dutch-nash-marker');
    const nl   = document.getElementById('dutch-nash-label');
    const ni   = document.getElementById('dutch-nash-info');

    if (vd) vd.textContent = s.value;
    if (vb) vb.style.width = s.value + '%';
    if (nm) { nm.style.left = nashPct + '%'; nm.style.display = this._hintsEnabled ? '' : 'none'; }
    if (nl) { nl.style.left = nashPct + '%'; nl.textContent = `Nash ${nashBid}`; nl.style.display = this._hintsEnabled ? '' : 'none'; }
    if (ni) { ni.textContent = `Nash bid: ${nashBid} (2/3 of your value)`; ni.style.display = this._hintsEnabled ? '' : 'none'; }
  },

  // ── History ─────────────────────────────────────────────────
  _addHistItem(round, value, bid, won, profit) {
    const list = document.getElementById('dutch-hist');
    if (!list) return;
    const el = document.createElement('div');
    el.className = 'dutch-hist-item';
    el.innerHTML = `
      <span class="dutch-hist-rnd">R${round}</span>
      <span class="dutch-hist-info">v:${value} ${bid !== null ? '→ b:' + bid : '→ lost'}</span>
      <span class="dutch-hist-res ${won ? 'win' : 'lose'}">${won ? '+$' + profit.toFixed(2) : '$0'}</span>`;
    list.insertBefore(el, list.firstChild);
  },

  // ── getResults() ─────────────────────────────────────────────
  getResults() {
    const s   = this._state;
    const cfg = this._CONFIG;
    const N   = cfg.N;

    const wins    = s.history.filter(h => h.won);
    const winRate = wins.length / s.history.length;
    const total   = s.totalEarnings;

    // Average bid ratio: bid / value for winning rounds
    const avgBidRatio = wins.length > 0
      ? wins.reduce((acc, h) => acc + h.bid / h.value, 0) / wins.length
      : null;

    const nashRatio = (N - 1) / N;  // 0.667 for N=3
    const crraRatio = (N - 1) / (N - 1 + 0.5) * cfg.clockDiscount; // ~0.74

    let title, profile, analysis;

    if (avgBidRatio === null) {
      title    = 'Priced Out';
      profile  = 'The Unlucky Bidder';
      analysis = `You didn't win any rounds this session. The Dutch auction is unforgiving — opponents who stop the clock early leave patient bidders empty-handed. The Nash equilibrium bid for N=3 is 2/3 of your value. Consider whether your values were simply outmatched, or whether you waited too long.`;
    } else if (avgBidRatio < nashRatio - 0.05) {
      title    = 'The Underbidder';
      profile  = 'The Overly Patient Strategist';
      analysis = `Your average bid ratio was ${(avgBidRatio * 100).toFixed(0)}% of value — well below the Nash equilibrium of ${(nashRatio * 100).toFixed(0)}%. You were shading too aggressively. While underbidding increases your profit when you win, it also dramatically reduces your win rate. You left wins on the table.`;
    } else if (avgBidRatio > crraRatio + 0.08) {
      title    = 'The Eager Bidder';
      profile  = 'The Impatient Risk-Avoider';
      analysis = `Your average bid ratio was ${(avgBidRatio * 100).toFixed(0)}% of value — above even the empirically observed CRRA benchmark of ~${(crraRatio * 100).toFixed(0)}%. You stopped the clock early out of fear of being beaten. This guarantees wins but at the cost of profit per win. Fear of losing is the most common overbidding driver.`;
    } else {
      title    = 'Well Calibrated';
      profile  = 'The Strategic Shader';
      analysis = `Your average bid ratio of ${(avgBidRatio * 100).toFixed(0)}% sits between the risk-neutral Nash benchmark (${(nashRatio * 100).toFixed(0)}%) and the empirically observed CRRA overbidding level (~${(crraRatio * 100).toFixed(0)}%). You're shading optimally — balancing the probability of winning against profit per win. This is where the literature says sophisticated bidders land.`;
    }

    return {
      title, profile, analysis,
      balanceDelta: total,
      stats: [
        { val: '$' + total.toFixed(2),              label: 'Total Profit' },
        { val: `${wins.length}/${s.history.length}`, label: 'Rounds Won' },
        { val: avgBidRatio !== null
            ? (avgBidRatio * 100).toFixed(0) + '% of v'
            : '—',                                  label: 'Avg Bid Ratio' },
      ]
    };
  },

  // ── Destroy ───────────────────────────────────────────────────
  getSubmissionData() {
    const s = this._state, cfg = this._CONFIG, N = cfg.N;
    const rounds = s.history.map(h => ({
      round:      h.round,
      value:      h.value,
      bid:        h.bid,
      won:        h.won,
      profit:     +((h.won && h.bid != null ? h.value - h.bid : 0)).toFixed(2),
      nash_bid:   Math.round(h.value * (N-1) / N),
      bid_ratio:  h.bid != null ? +(h.bid / h.value).toFixed(3) : null,
      opp_bid:    h.oppBid   || null,
      opp_value:  h.oppValue || null,
    }));
    const winRounds = rounds.filter(r => r.won && r.bid != null);
    const avgBidRatio = winRounds.length > 0
      ? +(winRounds.reduce((a,r) => a + r.bid_ratio, 0) / winRounds.length).toFixed(3)
      : null;
    return {
      // ── Game configuration (snapshot at time of play) ──────
      config: {
        n_bidders:           N,                     // 3 (1 player + 2 simulated)
        value_min:           cfg.valueMin,          // 0
        value_max:           cfg.valueMax,          // 100
        clock_min:           cfg.clockMin,          // 0
        clock_max:           cfg.clockMax,          // 100
        clock_speed_ms:      cfg.clockSpeed,        // 50ms per tick — KEY for A/B testing
        rounds_per_session:  cfg.rounds,            // 5
        value_distribution:  'uniform',             // uniform[valueMin, valueMax]
      },
      // ── Payoff structure ────────────────────────────────────
      payoffs: {
        winner_payoff_formula: 'private_value - bid',
        loser_payoff:          0,
        nash_bid_formula:      'value × (N-1)/N',
        nash_bid_ratio:        +((N-1)/N).toFixed(3),   // 0.667 for N=3
        crra_bid_ratio_empirical: +((N-1)/(N-1+0.5) * cfg.clockDiscount).toFixed(3),
      },
      // ── Opponent model params ────────────────────────────────
      opponent_model: {
        type:                'crra_phase1',
        crra_r_min:          cfg.riskAversion.min,  // 0.30
        crra_r_max:          cfg.riskAversion.max,  // 0.70
        clock_discount:      cfg.clockDiscount,     // 0.92 (Dutch non-isomorphism)
        noise_sd:            cfg.noiseSD,            // 4
      },
      // ── Per-round data ──────────────────────────────────────
      rounds_played:         rounds.length,
      rounds,
      wins:                  winRounds.length,
      win_rate:              +(winRounds.length / rounds.length).toFixed(3),
      avg_bid_ratio:         avgBidRatio,
      total_earnings:        +s.totalEarnings.toFixed(2),
    };
  },

  destroy() {
    clearInterval(this._clockInterval);
    this._state = null;
    this._shell = null;
    this._clockInterval = null;
  },

  // ── Helpers ───────────────────────────────────────────────────
  _gaussianNoise(mean, sd) {
    const u1 = Math.random(), u2 = Math.random();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  },
  _delay(ms) { return new Promise(r => setTimeout(r, ms)); },
};

GameRegistry.register(GameDutchAuction);
