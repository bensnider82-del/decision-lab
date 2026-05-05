/* ============================================================
   DECISION LAB — GAME MODULE
   Game:     High Card
   ID:       high_card
   Category: risky

   MECHANICS:
   - Player starts each round with $10 added to their running pot
   - A card is dealt face-up as the "current card"
   - HIT: next card revealed. If strictly higher → pot doubles.
     If equal → push (keep pot, draw again). If lower → BUST,
     lose entire accumulated pot (back to $0).
   - STAY: bank the pot and move to next round
   - Bust loses EVERYTHING banked across all rounds
   - Unlimited hits per round
   - Card values: 2–10 face value, J=11, Q=12, K=13, A=1
   - Full 52-card deck, shuffled, depletes across rounds
   - New deck shuffled when fewer than 2 cards remain
   - ACADEMIC NOTE: Optimal stopping theory (Ferguson 1989).
     The expected value of hitting drops as high cards are removed.
     With a full deck, E[next card] = 7. If current card > 7,
     probability of higher next card < 50%, so staying is better.
============================================================ */

const GameHighCard = {
  id:        'high_card',
  name:      'High Card',
  shortName: 'High Card',
  category:  'risky',

  _CONFIG: {
    rounds:        5,
    bonusPerRound: 10,     // $10 added at start of each round
    rankValues:    { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':1 },
    suits:         ['♠','♥','♦','♣'],
    ranks:         ['A','2','3','4','5','6','7','8','9','10','J','Q','K'],
    redSuits:      ['♥','♦'],
  },

  _state: null,
  _shell: null,
  _hintsEnabled: false,

  intro: {
    title: 'High Card',
    desc:  'You\'re dealt a card each round. Hit to reveal the next card and double your pot — but if it\'s lower, you lose everything. Stay to keep what you have.',
    rules: [
      'Each round starts with +$10 added to your pot (even after a bust)',
      'You are dealt a starting card — decide to Hit or Stay',
      'Hit: next card revealed. Higher = pot doubles. Equal = push, draw again. Lower = BUST',
      'Bust means you lose your ENTIRE pot, including all previous rounds',
      'Stay: bank your pot and move to the next round',
      'Card values: 2–10 face value · J=11 · Q=12 · K=13 · A=1 (low)',
    ]
  },

  mount(container, shellAPI, hintsEnabled) {
    this._hintsEnabled = !!hintsEnabled;
    this._shell        = shellAPI;

    const cfg = this._CONFIG;
    let deck = this._buildDeck();

    this._state = {
      round:         1,
      totalRounds:   cfg.rounds,
      pot:           0,          // running pot (survives rounds, resets on bust)
      roundHistory:  [],         // [{round, startPot, earned, endPot, outcome, moves}]
      totalEarnings: 0,          // final pot when game ends (only set at game end)
      deck,
      currentCard:   null,
      phase:         'dealing',  // 'dealing' | 'betting' | 'result' | 'bust'
      moves:         [],         // this round's hit/stay sequence [{card, result}]
      pushes:        0,          // pushes this round (for display)
    };

    container.innerHTML = this._html();
    this._bindEvents();
    this._startRound();
  },

  _buildDeck() {
    const cfg = this._CONFIG;
    const deck = [];
    for (const s of cfg.suits) for (const r of cfg.ranks) deck.push({ r, s });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  },

  _drawCard() {
    const s = this._state;
    if (s.deck.length < 2) s.deck = this._buildDeck();
    return s.deck.pop();
  },

  _cardVal(card) {
    return this._CONFIG.rankValues[card.r];
  },

  _isRed(card) {
    return this._CONFIG.redSuits.includes(card.s);
  },

  _cardHTML(card, size = 'normal') {
    const big = size === 'big';
    const rSz = big ? '38px' : '26px';
    const sSz = big ? '26px' : '18px';
    const col = this._isRed(card) ? '#C0392B' : 'var(--ink)';
    return `<span style="font-size:${rSz};font-weight:500;color:${col};">${card.r}</span>`
         + `<span style="font-size:${sSz};color:${col};">${card.s}</span>`;
  },

  _html() {
    return `<style>
      #hc-root{display:flex;height:100%;overflow:hidden;font-family:'DM Sans',sans-serif;}
      .hc-main{flex:1;display:flex;flex-direction:column;background:var(--cream);overflow:hidden;}
      .hc-arena{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1rem 2rem;gap:.6rem;overflow:hidden;}

      /* cards */
      .hc-cards-row{display:flex;gap:40px;align-items:center;justify-content:center;}
      .hc-card-wrap{display:flex;flex-direction:column;align-items:center;gap:8px;}
      .hc-card-lbl{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
      .hc-card{width:100px;height:144px;background:var(--surface);border:1px solid var(--border-solid);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;box-shadow:0 2px 8px rgba(0,0,0,.06);}
      .hc-card.back{background:var(--border);border-color:var(--border-solid);color:var(--muted);font-size:13px;box-shadow:none;}
      .hc-card.push{border-color:var(--gold);box-shadow:0 0 0 2px rgba(200,168,75,.2);}
      .hc-card.win{border-color:var(--green);box-shadow:0 0 0 2px rgba(46,125,82,.2);}
      .hc-card.bust-card{border-color:var(--red);box-shadow:0 0 0 2px rgba(192,57,43,.2);}

      /* card value legend */
      .hc-legend{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:400px;}
      .hc-legend-chip{font-family:'DM Mono',monospace;font-size:10px;padding:3px 8px;border-radius:2px;border:1px solid var(--border-solid);color:var(--muted);}
      .hc-legend-chip.highlight{border-color:var(--gold);color:var(--gold);}

      /* move tape */
      .hc-tape{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center;min-height:28px;max-width:480px;}
      .hc-move{font-family:'DM Mono',monospace;font-size:11px;padding:3px 8px;border-radius:2px;}
      .hc-move.hit-win{background:rgba(46,125,82,.1);color:var(--green);border:1px solid rgba(46,125,82,.2);}
      .hc-move.hit-push{background:rgba(200,168,75,.08);color:var(--gold);border:1px solid rgba(200,168,75,.25);}
      .hc-move.hit-bust{background:rgba(192,57,43,.1);color:var(--red);border:1px solid rgba(192,57,43,.2);}
      .hc-move.stay{background:rgba(26,22,18,.06);color:var(--muted);border:1px solid var(--border-solid);}
      .hc-move-arrow{color:var(--border-solid);font-size:12px;}

      /* status */
      .hc-status{font-family:'DM Mono',monospace;font-size:13px;color:var(--muted);text-align:center;min-height:22px;}
      .hc-status.win{color:var(--green);}
      .hc-status.bust{color:var(--red);}
      .hc-status.gold{color:var(--gold);}

      /* hint box */
      .hc-hint{background:rgba(200,168,75,.07);border:1px solid rgba(200,168,75,.25);border-radius:4px;padding:8px 14px;font-size:12px;color:var(--muted);text-align:center;max-width:380px;line-height:1.6;}
      .hc-hint strong{color:var(--gold);}

      /* actions */
      .hc-actions{padding:12px 20px;border-top:1px solid var(--border);background:var(--surface);display:flex;gap:12px;justify-content:center;flex-shrink:0;}

      /* right panel */
      .hc-right{width:236px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;}
      .hc-panel-sec{padding:13px 15px;border-bottom:1px solid var(--border);flex-shrink:0;}
      .hc-panel-lbl{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:5px;}
      .hc-stat-big{font-family:'DM Mono',monospace;font-size:26px;font-weight:500;color:var(--ink);}
      .hc-stat-sub{font-size:11px;color:var(--muted);margin-top:2px;}
      .hc-round-dots{display:flex;gap:5px;margin-top:6px;}
      .hc-dot{width:8px;height:8px;border-radius:50%;background:var(--border-solid);transition:all .3s ease;}
      .hc-dot.done{background:var(--green);}
      .hc-dot.bust{background:var(--red);}
      .hc-dot.current{background:var(--gold);transform:scale(1.3);}
      .hc-hist-list{flex:1;overflow-y:auto;}
      .hc-hist-item{padding:9px 15px;border-bottom:1px solid var(--border);font-size:12px;}
      .hc-hist-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;}
      .hc-hist-round{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);}
      .hc-hist-earn{font-family:'DM Mono',monospace;font-size:11px;font-weight:500;}
      .hc-hist-earn.pos{color:var(--green);}
      .hc-hist-earn.neg{color:var(--red);}
      .hc-hist-detail{font-size:11px;color:var(--muted);}
      .hc-deck-bar{height:4px;background:var(--border-solid);border-radius:2px;margin-top:6px;overflow:hidden;}
      .hc-deck-fill{height:100%;background:var(--gold);border-radius:2px;transition:width .3s ease;}
    </style>

    <div id="hc-root">
      <div class="hc-main">
        <div class="hc-arena">

          <!-- Cards -->
          <div class="hc-cards-row">
            <div class="hc-card-wrap">
              <div class="hc-card" id="hc-cur-card" style="justify-content:center;"></div>
            </div>
            <div class="hc-card-wrap">
              <div class="hc-card back" id="hc-nxt-card">?</div>
            </div>
          </div>

          <!-- Compact value reference — single line -->
          <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.06em;">
            A=1 &nbsp;·&nbsp; 2–10 face &nbsp;·&nbsp; J=11 &nbsp;·&nbsp; Q=12 &nbsp;·&nbsp; K=13
          </div>

          <!-- Move tape -->
          <div class="hc-tape" id="hc-tape"></div>

          <!-- Status -->
          <div class="hc-status" id="hc-status">Deciding...</div>

          <!-- Hints -->
          <div id="hc-hint-area"></div>

        </div>

        <!-- Action buttons -->
        <div class="hc-actions">
          <button class="btn btn-red"  id="hc-hit-btn"  disabled>&#x1F3B4; Hit</button>
          <button class="btn btn-dark" id="hc-stay-btn" disabled>&#x2713; Stay — keep $<span id="hc-stay-amt">0</span></button>
          <button class="btn btn-dark" id="hc-next-btn" style="display:none;">Next Round &#x2192;</button>
          <button class="btn btn-dark" id="hc-finish-btn" style="display:none;">Finish &#x2192;</button>
        </div>
      </div>

      <!-- Right panel -->
      <div class="hc-right">
        <div class="hc-panel-sec">
          <div class="hc-panel-lbl">Round</div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div class="hc-stat-big" id="hc-round-num">1</div>
            <div style="font-size:12px;color:var(--muted);" id="hc-round-of">of 5</div>
          </div>
          <div class="hc-round-dots" id="hc-round-dots"></div>
        </div>

        <div class="hc-panel-sec">
          <div class="hc-panel-lbl">Your Pot</div>
          <div class="hc-stat-big" id="hc-pot-big" style="color:var(--green);">$0.00</div>
          <div class="hc-stat-sub" id="hc-pot-sub">+$10 bonus at round start</div>
          <div class="hc-deck-bar"><div class="hc-deck-fill" id="hc-deck-fill" style="width:100%"></div></div>
          <div style="font-size:10px;color:var(--muted);margin-top:3px;" id="hc-deck-lbl">52 cards in deck</div>
        </div>

        <div class="hc-panel-sec">
          <div class="hc-panel-lbl">This Round</div>
          <div style="font-size:13px;color:var(--muted);" id="hc-round-detail">—</div>
        </div>

        <div class="hc-panel-sec" style="padding-bottom:7px;flex-shrink:0;">
          <div class="hc-panel-lbl">Round History</div>
        </div>
        <div class="hc-hist-list" id="hc-hist-list">
          <div style="padding:12px 15px;font-size:11px;color:var(--muted);">No rounds completed yet</div>
        </div>
      </div>
    </div>`;
  },

  _bindEvents() {
    document.getElementById('hc-hit-btn').addEventListener('click',    () => this._hit());
    document.getElementById('hc-stay-btn').addEventListener('click',   () => this._stay());
    document.getElementById('hc-next-btn').addEventListener('click',   () => this._nextRound());
    document.getElementById('hc-finish-btn').addEventListener('click', () => this._finish());
  },

  _startRound() {
    const s   = this._state;
    const cfg = this._CONFIG;

    // Add $10 bonus
    s.pot    = +(s.pot + cfg.bonusPerRound).toFixed(2);
    s.moves  = [];
    s.pushes = 0;
    s.phase  = 'betting';

    // Deal starting card
    s.currentCard = this._drawCard();

    // Update UI
    this._renderCurrentCard(s.currentCard);
    this._resetNextCard();
    this._renderTape();
    this._updateRightPanel();
    this._updateHint();

    this._setStatus(`Round ${s.round} — you received +$10. Current card: ${s.currentCard.r}${s.currentCard.s} (value ${this._cardVal(s.currentCard)})`, '');

    // Buttons
    this._setButtons('betting');

    document.getElementById('hc-stay-amt').textContent = s.pot.toFixed(2);
  },

  _hit() {
    const s = this._state;
    if (s.phase !== 'betting') return;

    const next = this._drawCard();
    const cur  = s.currentCard;
    const curV = this._cardVal(cur);
    const nxtV = this._cardVal(next);

    // Show next card
    const nxtEl = document.getElementById('hc-nxt-card');
    nxtEl.className = 'hc-card';
    nxtEl.innerHTML = this._cardHTML(next, 'normal');

    this._updateDeckDisplay();

    if (nxtV > curV) {
      // WIN — double pot
      s.pot = +(s.pot * 2).toFixed(2);
      s.currentCard = next;
      s.moves.push({ card: next, result: 'win', val: nxtV, prevVal: curV });
      nxtEl.classList.add('win');

      this._setStatus(`${next.r}${next.s} (${nxtV}) — doubled · Pot: $${s.pot.toFixed(2)}`, 'win');
      document.getElementById('hc-stay-amt').textContent = s.pot.toFixed(2);

      setTimeout(() => {
        this._renderCurrentCard(next);
        this._resetNextCard();
        this._renderTape();
        this._updateRightPanel();
        this._updateHint();
      }, 600);

    } else if (nxtV === curV) {
      // PUSH — keep pot, draw again
      s.pushes++;
      s.currentCard = next;
      s.moves.push({ card: next, result: 'push', val: nxtV, prevVal: curV });
      nxtEl.classList.add('push');

      this._setStatus(`${next.r}${next.s} (${nxtV}) — push · Draw again`, 'gold');

      setTimeout(() => {
        this._renderCurrentCard(next);
        this._resetNextCard();
        this._renderTape();
        this._updateRightPanel();
        this._updateHint();
      }, 600);

    } else {
      // BUST — lose everything
      s.moves.push({ card: next, result: 'bust', val: nxtV, prevVal: curV });
      nxtEl.classList.add('bust-card');
      s.phase = 'bust';

      this._setStatus(`${next.r}${next.s} (${nxtV}) — BUST · Pot lost`, 'bust');
      this._renderTape();

      const lostPot = s.pot;
      s.pot = 0;
      this._addHistoryItem(s.round, lostPot, 0, 'bust', s.moves);
      this._updateRightPanel();

      const isLast = s.round >= s.totalRounds;
      this._setButtons('bust', isLast);
    }
  },

  _stay() {
    const s = this._state;
    if (s.phase !== 'betting') return;

    s.moves.push({ card: null, result: 'stay' });
    s.phase = 'stayed';

    const earned = s.pot;
    this._setStatus(`Stayed at $${earned.toFixed(2)}. Pot banked.`, 'win');
    this._renderTape();
    this._addHistoryItem(s.round, earned, earned, 'stay', s.moves);
    this._updateRightPanel();

    const isLast = s.round >= s.totalRounds;
    this._setButtons('stayed', isLast);
  },

  _nextRound() {
    const s = this._state;
    s.round++;
    this._startRound();
  },

  _finish() {
    this._shell.onGameComplete();
  },

  _setButtons(phase, isLast) {
    const hitBtn    = document.getElementById('hc-hit-btn');
    const stayBtn   = document.getElementById('hc-stay-btn');
    const nextBtn   = document.getElementById('hc-next-btn');
    const finishBtn = document.getElementById('hc-finish-btn');

    hitBtn.style.display    = 'inline-flex';
    stayBtn.style.display   = 'inline-flex';
    nextBtn.style.display   = 'none';
    finishBtn.style.display = 'none';

    if (phase === 'betting') {
      hitBtn.disabled  = false;
      stayBtn.disabled = false;
    } else {
      hitBtn.style.display  = 'none';
      stayBtn.style.display = 'none';
      if (isLast) {
        finishBtn.style.display = 'inline-flex';
      } else {
        nextBtn.style.display = 'inline-flex';
      }
    }
  },

  _renderCurrentCard(card) {
    const el = document.getElementById('hc-cur-card');
    el.className = 'hc-card';
    el.innerHTML = this._cardHTML(card, 'big');
  },

  _resetNextCard() {
    const el = document.getElementById('hc-nxt-card');
    el.className = 'hc-card back';
    el.innerHTML = '?';
  },

  _renderTape() {
    const s   = this._state;
    const el  = document.getElementById('hc-tape');
    if (!el) return;
    el.innerHTML = s.moves.map(m => {
      if (m.result === 'stay')  return `<div class="hc-move stay">Stay</div>`;
      if (m.result === 'win')   return `<div class="hc-move hit-win">${m.card.r}${m.card.s} ↑×2</div>`;
      if (m.result === 'push')  return `<div class="hc-move hit-push">${m.card.r}${m.card.s} = push</div>`;
      if (m.result === 'bust')  return `<div class="hc-move hit-bust">${m.card.r}${m.card.s} BUST</div>`;
      return '';
    }).join('<div class="hc-move-arrow">→</div>');
  },

  _setStatus(text, type) {
    const el = document.getElementById('hc-status');
    if (!el) return;
    el.textContent = text;
    el.className   = 'hc-status' + (type ? ' ' + type : '');
  },

  _updateHint() {
    const s   = this._state;
    const el  = document.getElementById('hc-hint-area');
    if (!el || !this._hintsEnabled) return;
    const curVal = this._cardVal(s.currentCard);
    const remaining = s.deck.length;
    const cfg = this._CONFIG;

    // Count cards strictly higher than current in remaining deck
    const higherCount = s.deck.filter(c => cfg.rankValues[c.r] > curVal).length;
    const pctHigher   = +(higherCount / remaining * 100).toFixed(1);
    const ev          = +((pctHigher/100 * s.pot * 2) + ((1-pctHigher/100) * 0) - s.pot).toFixed(2);

    el.innerHTML = `<div class="hc-hint">
      <strong>Hints on:</strong> Current card = ${curVal}. In the remaining ${remaining} cards,
      <strong>${higherCount}</strong> are higher (${pctHigher}%).
      EV(hit) = ${ev >= 0 ? '+' : ''}$${ev.toFixed(2)} vs EV(stay) = $0.
    </div>`;
  },

  _updateRightPanel() {
    const s   = this._state;
    const cfg = this._CONFIG;

    // Round number
    document.getElementById('hc-round-num').textContent = s.round;
    document.getElementById('hc-round-of').textContent  = 'of ' + s.totalRounds;

    // Pot
    const potEl = document.getElementById('hc-pot-big');
    if (potEl) {
      potEl.textContent  = '$' + s.pot.toFixed(2);
      potEl.style.color  = s.pot > 0 ? 'var(--green)' : 'var(--red)';
    }

    // Round detail
    const detEl = document.getElementById('hc-round-detail');
    if (detEl && s.currentCard) {
      const curVal = this._cardVal(s.currentCard);
      detEl.textContent = `Card: ${s.currentCard.r}${s.currentCard.s} (${curVal}) · Hits: ${s.moves.filter(m=>m.result!=='stay').length} · Pushes: ${s.pushes}`;
    }

    // Deck display
    this._updateDeckDisplay();

    // Round dots
    const dotsEl = document.getElementById('hc-round-dots');
    if (dotsEl) {
      dotsEl.innerHTML = Array.from({ length: s.totalRounds }, (_, i) => {
        const h = s.roundHistory[i];
        const cls = h === undefined
          ? (i === s.round - 1 ? 'current' : '')
          : h.outcome === 'bust' ? 'bust' : 'done';
        return `<div class="hc-dot ${cls}"></div>`;
      }).join('');
    }
  },

  _updateDeckDisplay() {
    const s = this._state;
    const remaining = s.deck.length;
    const fillEl    = document.getElementById('hc-deck-fill');
    const lblEl     = document.getElementById('hc-deck-lbl');
    if (fillEl) fillEl.style.width = (remaining / 52 * 100) + '%';
    if (lblEl)  lblEl.textContent  = remaining + ' cards left in deck';
  },

  _addHistoryItem(round, startPot, endPot, outcome, moves) {
    const s   = this._state;
    const h   = document.getElementById('hc-hist-list');
    if (!h) return;

    // Remove placeholder
    const placeholder = h.querySelector('div[style]');
    if (placeholder) h.innerHTML = '';

    // Save to state
    s.roundHistory.push({ round, startPot, endPot, outcome, moves: [...moves] });

    const item = document.createElement('div');
    item.className = 'hc-hist-item';
    const earnStr  = outcome === 'bust' ? 'Bust — $0' : '+$' + endPot.toFixed(2);
    const earnCls  = outcome === 'bust' ? 'neg' : 'pos';
    const moveStr  = moves.filter(m => m.result !== 'stay').length + ' hit(s)' + (outcome === 'bust' ? ', busted' : ', stayed');
    item.innerHTML = `
      <div class="hc-hist-row">
        <span class="hc-hist-round">Round ${round}</span>
        <span class="hc-hist-earn ${earnCls}">${earnStr}</span>
      </div>
      <div class="hc-hist-detail">${moveStr} · started $${startPot.toFixed(2)}</div>`;
    h.insertBefore(item, h.firstChild);
  },

  getResults() {
    const s   = this._state;
    const cfg = this._CONFIG;

    const finalPot = s.pot;
    const busts    = s.roundHistory.filter(r => r.outcome === 'bust').length;
    const stays    = s.roundHistory.filter(r => r.outcome === 'stay').length;
    const totalBonus = cfg.rounds * cfg.bonusPerRound;

    let title, profile, analysis;
    if (finalPot >= 150) {
      title    = 'High Roller'; profile = 'The Fearless Risk-Taker';
      analysis = `Ended with $${finalPot.toFixed(2)} — aggressive hitting that paid off. Optimal stopping theory says stay when current card value > 7 (expected value of deck). You pushed well beyond that and won.`;
    } else if (finalPot >= 60) {
      title    = 'Calculated Risk'; profile = 'The Patient Duelist';
      analysis = `$${finalPot.toFixed(2)} final pot. ${busts} bust(s) along the way. The break-even threshold for hitting is P(higher) > 50%, which occurs when current card < 7. Solid calibration.`;
    } else if (busts >= 2) {
      title    = 'Boom and Bust'; profile = 'The Gambler';
      analysis = `${busts} busts total. Busting wipes all accumulated earnings — the asymmetric downside is the core tension. Each bust reset you to $0, costing ${busts * cfg.bonusPerRound}+ in accumulated pot.`;
    } else {
      title    = 'Conservative Player'; profile = 'The Sure Thing';
      analysis = `$${finalPot.toFixed(2)} — minimal risk taken. Staying early preserves the pot but foregoes compounding. With each double, the expected loss on a bust grows, making staying increasingly rational at higher pots.`;
    }

    return {
      title, profile, analysis,
      balanceDelta: finalPot,
      stats: [
        { val: '$' + finalPot.toFixed(2), label: 'Final Pot' },
        { val: busts + 'B · ' + stays + 'S',  label: 'Busts · Stays' },
        { val: String(cfg.rounds),         label: 'Rounds Played' },
      ]
    };
  },

  getSubmissionData() {
    const s   = this._state;
    const cfg = this._CONFIG;
    return {
      config: {
        rounds:          cfg.rounds,
        bonus_per_round: cfg.bonusPerRound,
        equal_is_push:   true,
        ace_value:       1,
      },
      payoffs: {
        win_formula:  'pot × 2',
        bust_payoff:  0,
        stay_payoff:  'current pot',
        push_result:  'draw again, no change to pot',
      },
      rounds:         s.roundHistory.map(r => ({
        round:     r.round,
        start_pot: r.startPot,
        end_pot:   r.endPot,
        outcome:   r.outcome,
        hits:      r.moves.filter(m => m.result !== 'stay').length,
        pushes:    r.moves.filter(m => m.result === 'push').length,
        move_sequence: r.moves.map(m => m.result).join(','),
      })),
      final_pot:      +s.pot.toFixed(2),
      total_busts:    s.roundHistory.filter(r => r.outcome === 'bust').length,
      total_stays:    s.roundHistory.filter(r => r.outcome === 'stay').length,
    };
  },

  destroy() {
    this._state = null;
    this._shell = null;
  },

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); },
};

GameRegistry.register(GameHighCard);
