const GameCommons = {
  id:        'commons',
  name:      'Tragedy of the Commons',
  shortName: 'Fish Pond',
  category:  'theory',

  _CONFIG: {
    initialStock:  100,
    rounds:        3,
    tankW:         380,
    tankH:         240,
    fishR:         10,
    gravity:       0.25,
    damping:       0.62,
    threshold1:    Math.sqrt(2) - 1,
    threshold2:    1.0,
  },

  _state:    null,
  _shell:    null,
  _animId:   null,
  _fish:     [],
  _canvas:   null,
  _ctx:      null,
  _hintsEnabled: false,

  intro: {
    title: 'Tragedy of the Commons',
    desc:  'A shared pond starts with 100 fish. Each round you and an opponent simultaneously decide how much to harvest (0-50%). Fish left in the pond grow by factor (1+β).',
    rules: [
      'Each round: choose your harvest percentage (0-50% of current stock)',
      'Both harvests happen simultaneously — then remaining fish grow by (1+β)',
      'β is drawn randomly and shown at game start — higher means faster growth',
      'All three rounds require your decision',
      'Your total score = fish harvested across all three rounds (1 fish = $0.10)',
    ]
  },

  mount(container, shellAPI, hintsEnabled) {
    this._shell = shellAPI;
    this._hintsEnabled = !!hintsEnabled;
    const cfg = this._CONFIG;
    const beta = +Math.random().toFixed(3);
    this._state = {
      beta,
      nashR1: beta < cfg.threshold1 ? 0.5 : 0,
      nashR2: beta < cfg.threshold2 ? 0.5 : 0,
      stock:          cfg.initialStock,
      round:          1,
      totalHarvested: 0,
      history:        [],
      animating:      false,
    };
    container.innerHTML = this._html();
    this._setupCanvas();
    this._fish = [];
    this._spawnFish(cfg.initialStock);
    this._bindEvents();
    this._startPhysics();
    this._updateUI();
  },

  _html() {
    return `<style>
      #commons-root{display:flex;height:100%;overflow:hidden;font-family:'DM Sans',sans-serif;}
      .commons-main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px 18px;gap:11px;position:relative;background:var(--cream);overflow:hidden;}
      .tank-wrap{position:relative;border:3px solid #2A6A8A;border-top:none;border-radius:0 0 14px 14px;background:linear-gradient(180deg,#B8E4F5 0%,#7EC8E3 40%,#4AADCC 100%);overflow:hidden;box-shadow:inset 0 -4px 12px rgba(0,0,0,.15),0 4px 16px rgba(42,106,138,.25);}
      .tank-surface{height:10px;background:linear-gradient(180deg,rgba(255,255,255,.6) 0%,rgba(184,228,245,.8) 100%);border-bottom:2px solid rgba(255,255,255,.5);}
      #fish-canvas{display:block;}
      .tank-label{position:absolute;bottom:5px;right:8px;font-family:'DM Mono',monospace;font-size:10px;color:rgba(255,255,255,.7);letter-spacing:.06em;}
      .beta-row{display:flex;align-items:center;gap:14px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:8px 16px;width:100%;max-width:400px;}
      .beta-val{font-family:'DM Mono',monospace;font-size:26px;font-weight:500;color:var(--ink);min-width:56px;}
      .beta-divider{width:1px;height:28px;background:var(--border-solid);}
      .beta-info{flex:1;}
      .beta-lbl{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);margin-bottom:2px;}
      .beta-desc{font-size:12px;color:var(--ink);line-height:1.45;}
      .beta-nash{font-family:'DM Mono',monospace;font-size:10px;padding:3px 9px;border-radius:2px;background:rgba(200,168,75,.15);color:#8a6000;border:1px solid rgba(200,168,75,.3);white-space:nowrap;}
      .harvest-section{width:100%;max-width:400px;}
      .harvest-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;}
      .harvest-lbl{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);}
      .harvest-pct{font-family:'DM Mono',monospace;font-size:20px;font-weight:500;color:var(--ink);}
      .harvest-fish-count{font-size:11px;color:var(--muted);margin-top:1px;}
      input[type=range]#harvest-slider{-webkit-appearance:none;appearance:none;width:100%;height:8px;border-radius:4px;background:var(--border-solid);outline:none;cursor:pointer;margin-bottom:6px;}
      input[type=range]#harvest-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;border-radius:50%;background:var(--ink);cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.25);transition:background .15s ease;}
      input[type=range]#harvest-slider::-webkit-slider-thumb:hover{background:var(--gold);}
      .harvest-markers{display:flex;justify-content:space-between;font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);}
      .nash-hint{margin-top:5px;padding:5px 9px;border-radius:2px;font-size:11px;line-height:1.45;border:1px solid var(--border-solid);background:var(--surface);color:var(--muted);}
      .nash-hint.take{border-color:rgba(192,57,43,.3);background:rgba(192,57,43,.05);color:var(--red);}
      .nash-hint.wait{border-color:rgba(46,125,82,.3);background:rgba(46,125,82,.05);color:var(--green);}
      #commons-confirm{width:190px;height:46px;}
      .commons-status{font-size:12px;color:var(--muted);font-family:'DM Mono',monospace;text-align:center;min-height:16px;}
      #commons-outcome{position:absolute;inset:0;z-index:20;background:rgba(245,240,232,.96);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0;pointer-events:none;transition:opacity .35s ease;text-align:center;padding:2rem;}
      #commons-outcome.show{opacity:1;pointer-events:auto;}
      .commons-out-emoji{font-size:48px;}
      .commons-out-title{font-family:'Playfair Display',serif;font-size:24px;font-weight:900;color:var(--ink);}
      .commons-out-sub{font-size:13px;color:var(--muted);max-width:360px;line-height:1.6;}
      .commons-out-earn{font-family:'DM Mono',monospace;font-size:18px;font-weight:500;padding:7px 18px;border-radius:4px;color:var(--green);background:rgba(46,125,82,.1);border:1px solid rgba(46,125,82,.2);}
      .commons-out-theory{font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;border:1px solid var(--border-solid);padding:5px 12px;border-radius:2px;max-width:380px;line-height:1.6;text-align:center;}
      .commons-right{width:248px;flex-shrink:0;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;}
      .commons-panel-sec{padding:12px 14px;border-bottom:1px solid var(--border);}
      .commons-panel-lbl{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;}
      .commons-stat-big{font-family:'DM Mono',monospace;font-size:24px;font-weight:500;color:var(--ink);}
      .commons-stat-sub{font-size:11px;color:var(--muted);margin-top:1px;}
      .round-track{display:flex;flex-direction:column;gap:5px;}
      .round-row{display:flex;align-items:center;gap:7px;padding:5px 7px;border-radius:3px;border:1px solid var(--border);background:var(--cream);transition:all .3s ease;}
      .round-row.active{border-color:var(--gold);background:rgba(200,168,75,.08);}
      .round-row.done{border-color:rgba(46,125,82,.3);background:rgba(46,125,82,.05);}
      .round-num{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);min-width:22px;}
      .round-info{flex:1;font-size:11px;color:var(--ink);line-height:1.35;}
      .round-earn{font-family:'DM Mono',monospace;font-size:11px;font-weight:500;color:var(--green);}
      .commons-hist-list{flex:1;overflow-y:auto;padding:7px 14px;}
      .commons-hist-item{padding:6px 0;border-bottom:1px solid var(--border);font-size:11px;color:var(--ink);line-height:1.5;animation:fadeUp .2s ease;}
      .commons-hist-label{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);margin-bottom:1px;}
    </style>
    <div id="commons-root">
      <div class="commons-main">
        <div class="tank-wrap" id="tank-wrap">
          <div class="tank-surface"></div>
          <canvas id="fish-canvas"></canvas>
          <div class="tank-label" id="tank-label">100 fish</div>
        </div>
        <div class="beta-row">
          <div><div class="beta-lbl">Growth Rate β</div><div class="beta-val" id="beta-val">0.00</div></div>
          <div class="beta-divider"></div>
          <div class="beta-info"><div class="beta-lbl">Effect per round</div><div class="beta-desc" id="beta-desc">—</div></div>
          <div class="beta-nash" id="beta-nash" style="display:none;">—</div>
        </div>
        <div class="harvest-section">
          <div class="harvest-header">
            <div><div class="harvest-lbl">Your Harvest — Round <span id="harvest-round-num">1</span></div><div class="harvest-fish-count" id="harvest-fish-count">= 0 fish from 100</div></div>
            <div class="harvest-pct" id="harvest-pct">0%</div>
          </div>
          <input type="range" id="harvest-slider" min="0" max="50" value="0" step="1">
          <div class="harvest-markers"><span>0%</span><span>25%</span><span>50%</span></div>
          <div class="nash-hint" id="nash-hint" style="display:none;">—</div>
        </div>
        <button class="btn btn-dark" id="commons-confirm">Confirm Harvest →</button>
        <div class="commons-status" id="commons-status">Choose your harvest for Round 1</div>
        <div id="commons-outcome">
          <div class="commons-out-emoji" id="commons-out-emoji">🐟</div>
          <div class="commons-out-title" id="commons-out-title">Game Complete</div>
          <div class="commons-out-sub" id="commons-out-sub"></div>
          <div class="commons-out-earn" id="commons-out-earn">+0 fish</div>
          <div class="commons-out-theory" id="commons-out-theory"></div>
        </div>
      </div>
      <div class="commons-right">
        <div class="commons-panel-sec"><div class="commons-panel-lbl">Current Stock</div><div class="commons-stat-big" id="commons-stock">100</div><div class="commons-stat-sub">fish in the pond</div></div>
        <div class="commons-panel-sec"><div class="commons-panel-lbl">Your Total Harvest</div><div class="commons-stat-big" id="commons-total" style="color:var(--green);">0</div><div class="commons-stat-sub">fish collected</div></div>
        <div class="commons-panel-sec"><div class="commons-panel-lbl">Rounds</div>
          <div class="round-track">
            <div class="round-row active" id="rrow-1"><div class="round-num">R1</div><div class="round-info">Pending</div><div class="round-earn"></div></div>
            <div class="round-row" id="rrow-2"><div class="round-num">R2</div><div class="round-info">Pending</div><div class="round-earn"></div></div>
            <div class="round-row" id="rrow-3"><div class="round-num">R3</div><div class="round-info">Pending</div><div class="round-earn"></div></div>
          </div>
        </div>
        <div class="commons-panel-sec" style="padding-bottom:7px;"><div class="commons-panel-lbl">Round Log</div></div>
        <div class="commons-hist-list" id="commons-hist"></div>
      </div>
    </div>`;
  },

  _setupCanvas() {
    const cfg = this._CONFIG;
    const canvas = document.getElementById('fish-canvas');
    canvas.width = cfg.tankW; canvas.height = cfg.tankH;
    document.getElementById('tank-wrap').style.width = cfg.tankW + 'px';
    this._canvas = canvas; this._ctx = canvas.getContext('2d');
  },

  _spawnFish(count, fromTop = false) {
    const { tankW: W, tankH: H, fishR: r } = this._CONFIG;
    for (let i = 0; i < count; i++) {
      this._fish.push({
        x: r + Math.random()*(W-2*r), y: fromTop ? -r-Math.random()*50 : r+Math.random()*(H-2*r),
        vx: (Math.random()-0.5)*3, vy: fromTop ? Math.random()*2 : (Math.random()-0.5)*2,
        r, hue: 200+Math.floor(Math.random()*60),
        facing: Math.random()>0.5?1:-1, tailPhase: Math.random()*Math.PI*2, tailSpeed: 0.08+Math.random()*0.06,
      });
    }
  },

  _removeFish(count) { this._fish.splice(0, Math.min(count, this._fish.length)); },

  _physicsStep() {
    const { tankW: W, tankH: H, gravity: g, damping: d } = this._CONFIG;
    for (const f of this._fish) {
      f.vy += g; f.x += f.vx; f.y += f.vy;
      if (f.x-f.r<0)  { f.x=f.r;   f.vx= Math.abs(f.vx)*d; f.facing= 1; }
      if (f.x+f.r>W)  { f.x=W-f.r; f.vx=-Math.abs(f.vx)*d; f.facing=-1; }
      if (f.y-f.r<0)  { f.y=f.r;   f.vy= Math.abs(f.vy)*d; }
      if (f.y+f.r>H)  { f.y=H-f.r; f.vy=-Math.abs(f.vy)*d*0.7; f.vx*=0.98; }
      f.tailPhase += f.tailSpeed; if (f.tailPhase>Math.PI*2) f.tailPhase-=Math.PI*2;
      if (Math.random()<0.02){f.vx+=(Math.random()-0.5)*0.4;f.vy+=(Math.random()-0.5)*0.2;}
      const sp=Math.sqrt(f.vx*f.vx+f.vy*f.vy); if(sp>4){f.vx=f.vx/sp*4;f.vy=f.vy/sp*4;}
      if(Math.abs(f.vx)>0.1) f.facing=f.vx>0?1:-1;
    }
    for(let i=0;i<this._fish.length;i++) for(let j=i+1;j<this._fish.length;j++){
      const a=this._fish[i],b=this._fish[j];
      const dx=b.x-a.x,dy=b.y-a.y,dist=Math.sqrt(dx*dx+dy*dy),md=a.r+b.r;
      if(dist<md&&dist>0.001){
        const nx=dx/dist,ny=dy/dist,ov=(md-dist)/2;
        a.x-=nx*ov;a.y-=ny*ov;b.x+=nx*ov;b.y+=ny*ov;
        const rv=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
        if(rv<0){const im=rv*0.7;a.vx+=im*nx;a.vy+=im*ny;b.vx-=im*nx;b.vy-=im*ny;}
      }
    }
  },

  _drawFish(ctx, f) {
    const {x,y,r,hue,facing,tailPhase}=f, tail=Math.sin(tailPhase)*0.35;
    ctx.save(); ctx.translate(x,y); ctx.scale(facing,1);
    ctx.beginPath(); ctx.ellipse(0,0,r,r*0.6,0,0,Math.PI*2); ctx.fillStyle=`hsl(${hue},70%,55%)`; ctx.fill();
    ctx.beginPath(); ctx.ellipse(-r*0.1,r*0.08,r*0.55,r*0.28,0,0,Math.PI*2); ctx.fillStyle=`hsl(${hue},40%,80%)`; ctx.globalAlpha=0.5; ctx.fill(); ctx.globalAlpha=1;
    ctx.beginPath(); ctx.moveTo(-r*0.7,0); ctx.lineTo(-r*1.4,-r*0.55+tail*r); ctx.lineTo(-r*1.4,r*0.55+tail*r); ctx.closePath(); ctx.fillStyle=`hsl(${hue},65%,45%)`; ctx.fill();
    ctx.beginPath(); ctx.moveTo(-r*0.1,-r*0.6); ctx.quadraticCurveTo(r*0.3,-r*1.1,r*0.5,-r*0.6); ctx.closePath(); ctx.fillStyle=`hsl(${hue},60%,48%)`; ctx.fill();
    ctx.beginPath(); ctx.arc(r*0.45,-r*0.1,r*0.18,0,Math.PI*2); ctx.fillStyle='#1A1612'; ctx.fill();
    ctx.beginPath(); ctx.arc(r*0.5,-r*0.14,r*0.07,0,Math.PI*2); ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.fill();
    ctx.restore();
  },

  _startPhysics() {
    const loop=()=>{ this._physicsStep(); this._draw(); this._animId=requestAnimationFrame(loop); };
    this._animId=requestAnimationFrame(loop);
  },

  _draw() {
    const {tankW:W,tankH:H}=this._CONFIG, ctx=this._ctx;
    if(!ctx) return;
    ctx.clearRect(0,0,W,H);
    for(const f of this._fish) this._drawFish(ctx,f);
  },

  _bindEvents() {
    document.getElementById('harvest-slider').addEventListener('input', e => this._updateSliderUI(+e.target.value));
    document.getElementById('commons-confirm').addEventListener('click', () => this._confirmHarvest());
  },

  _updateUI() {
    const s=this._state, cfg=this._CONFIG, hints=this._hintsEnabled;
    const el=id=>document.getElementById(id);
    if(el('beta-val')) el('beta-val').textContent=s.beta.toFixed(3);
    if(el('beta-desc')) el('beta-desc').textContent=`Fish grow by ${Math.round(s.beta*100)}% each round after harvest.`;
    if(el('beta-nash')) {
      if(hints) {
        el('beta-nash').style.display='';
        const a=s.round===1?(s.beta<cfg.threshold1?'Take 50%':'Take 0%'):(s.beta<cfg.threshold2?'Take 50%':'Take 0%');
        el('beta-nash').textContent=`Nash R${s.round}: ${a}`;
      } else { el('beta-nash').style.display='none'; }
    }
    if(el('commons-stock')) el('commons-stock').textContent=Math.round(s.stock);
    if(el('commons-total')) el('commons-total').textContent=Math.round(s.totalHarvested);
    if(el('tank-label'))    el('tank-label').textContent=Math.round(s.stock)+' fish';
    if(el('harvest-round-num')) el('harvest-round-num').textContent=s.round;
    if(el('nash-hint')) el('nash-hint').style.display=hints?'':'none';
    this._updateRoundTracker();
    const sl=document.getElementById('harvest-slider');
    if(sl) this._updateSliderUI(+sl.value);
  },

  _updateSliderUI(pct) {
    const s=this._state,cfg=this._CONFIG,hints=this._hintsEnabled;
    const el=id=>document.getElementById(id);
    if(el('harvest-pct'))        el('harvest-pct').textContent=pct+'%';
    if(el('harvest-fish-count')) el('harvest-fish-count').textContent=`= ${Math.round(s.stock*pct/100)} fish from ${Math.round(s.stock)}`;
    const hintEl=el('nash-hint');
    if(hintEl&&hints){
      const nashPct=s.round===1?(s.beta<cfg.threshold1?50:0):(s.beta<cfg.threshold2?50:0);
      if(pct===nashPct){ hintEl.textContent=`✓ This matches the Nash equilibrium`; hintEl.className='nash-hint '+(nashPct===50?'take':'wait'); }
      else if(nashPct===50){ hintEl.textContent='Nash says: Take 50% — β < threshold'; hintEl.className='nash-hint take'; }
      else{ hintEl.textContent='Nash says: Take 0% — wait for growth'; hintEl.className='nash-hint wait'; }
    }
  },

  _updateRoundTracker() {
    const s=this._state;
    for(let r=1;r<=3;r++){
      const row=document.getElementById(`rrow-${r}`); if(!row) continue;
      const hist=s.history.find(h=>h.round===r);
      const infoEl=row.querySelector('.round-info'), earnEl=row.querySelector('.round-earn');
      row.className='round-row'+(r===s.round&&!s.animating?' active':'')+(hist?' done':'');
      if(hist){if(infoEl)infoEl.textContent=`You:${Math.round(hist.playerTake)} Opp:${Math.round(hist.oppTake)}`;if(earnEl)earnEl.textContent=`+${Math.round(hist.playerTake)}`;}
    }
  },

  async _confirmHarvest() {
    const s=this._state,cfg=this._CONFIG;
    if(s.animating) return;
    s.animating=true;
    const confirmBtn=document.getElementById('commons-confirm');
    if(confirmBtn) confirmBtn.disabled=true;
    const sl=document.getElementById('harvest-slider');
    const playerPct=+(sl?sl.value:0);
    const oppPct=this._opponentDecide();
    const playerTake=Math.round(s.stock*playerPct/100);
    const oppTake=Math.round(s.stock*oppPct/100);
    const remaining=Math.max(0,s.stock-playerTake-oppTake);
    const statusEl=document.getElementById('commons-status');
    if(statusEl) statusEl.textContent='Resolving...';
    this._removeFish(Math.min(playerTake+oppTake,this._fish.length));
    await this._delay(400);
    let newStock=remaining,grew=0;
    if(s.round<cfg.rounds){
      newStock=+(remaining*(1+s.beta)).toFixed(1);
      grew=Math.max(0,newStock-remaining);
      await this._delay(300);
      if(statusEl) statusEl.textContent=`Growing +${Math.round(grew)} fish...`;
      this._spawnFish(Math.round(grew),true);
      await this._delay(700);
    }
    s.history.push({round:s.round,stock:s.stock,playerTake,oppTake,growth:grew,newStock});
    s.totalHarvested=+(s.totalHarvested+playerTake).toFixed(1);
    s.stock=newStock;
    this._addHistItem(s.round,playerTake,oppTake,grew,newStock);
    const el=id=>document.getElementById(id);
    if(el('commons-stock')) el('commons-stock').textContent=Math.round(newStock);
    if(el('commons-total')) el('commons-total').textContent=Math.round(s.totalHarvested);
    if(el('tank-label'))    el('tank-label').textContent=Math.round(newStock)+' fish';
    this._updateRoundTracker();
    if(s.round>=cfg.rounds){ await this._delay(400); await this._showOutcome(); }
    else{
      s.round++; s.animating=false;
      if(sl) sl.value=0;
      if(statusEl) statusEl.textContent=`Choose your harvest for Round ${s.round}`;
      if(confirmBtn) confirmBtn.disabled=false;
      this._updateUI();
    }
  },

  // Phase 1 opponent — Ostrom, Gardner & Walker (1994); Keser & Gardner (1999)
  // Key findings:
  // 1. Average extraction ≈ Nash at group level, but huge individual variance
  // 2. Less than 5% play pure Nash (Keser & Gardner 1999)
  // 3. Higher regeneration rate → more cooperative behavior (Pavitt et al. 2005)
  // 4. Extraction follows a roughly normal dist centered ~25-35%, bounded [0,50]
  // 5. "Pulsing" — variance increases over rounds as players experiment
  _opponentDecide() {
    const beta=this._state.beta;
    // Base mean: 30% at low β, drops to ~15% at β=1 (cooperation increases with growth rate)
    const mean=0.30-0.15*beta;
    const sd=0.10+0.05*(1-beta); // more variance at low β
    let sample;
    do {
      const u1=Math.random(),u2=Math.random();
      const z=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
      sample=mean+sd*z;
    } while(sample<0||sample>0.50);
    return Math.round(sample*100);
  },

  async _showOutcome() {
    const s=this._state,cfg=this._CONFIG;
    const actual=s.totalHarvested;
    let ns=cfg.initialStock;
    const nt1=ns*s.nashR1; ns=(ns-2*nt1)*(1+s.beta);
    const nt2=ns*s.nashR2; ns=(ns-2*nt2)*(1+s.beta);
    const nashTotal=nt1+nt2+ns*0.5;
    const diff=actual-nashTotal;
    const diffLabel=Math.abs(diff)<2?'right at':diff>0?`${Math.round(diff)} above`:`${Math.round(Math.abs(diff))} below`;
    let emoji,title,sub;
    if(actual>=nashTotal*0.88){emoji='🎣';title='Optimal Harvester';sub=`You collected ${Math.round(actual)} fish — ${diffLabel} Nash optimal (${Math.round(nashTotal)}). With β=${s.beta.toFixed(3)}: Nash prescribes R1=${Math.round(s.nashR1*100)}%, R2=${Math.round(s.nashR2*100)}%, R3=50%.`;}
    else if(actual>=nashTotal*0.55){emoji='🐠';title='Decent Harvest';sub=`You collected ${Math.round(actual)} fish. Nash optimal was ${Math.round(nashTotal)} with β=${s.beta.toFixed(3)}. The equilibrium: R1=${Math.round(s.nashR1*100)}%, R2=${Math.round(s.nashR2*100)}%, R3=50%.`;}
    else{emoji='🐡';title='Below Optimal';sub=`${Math.round(actual)} fish vs Nash optimal ${Math.round(nashTotal)}. For β=${s.beta.toFixed(3)}: extract in round ${s.nashR1>0?'1':s.nashR2>0?'2':'3'}. Research shows most players under-extract when growth is high.`;}
    const theory=`β=${s.beta.toFixed(3)} · Nash: R1=${Math.round(s.nashR1*100)}%/R2=${Math.round(s.nashR2*100)}%/R3=50% · Thresholds: R1 √2−1≈0.414, R2=1.0 · Your: ${Math.round(actual)} · Nash: ${Math.round(nashTotal)}`;
    const el=id=>document.getElementById(id);
    el('commons-out-emoji').textContent=emoji; el('commons-out-title').textContent=title;
    el('commons-out-sub').textContent=sub; el('commons-out-earn').textContent=`+${Math.round(actual)} fish`;
    el('commons-out-theory').textContent=theory;
    await this._delay(200); el('commons-outcome').classList.add('show');
    await this._delay(600); this._shell.flashBalance(actual*0.10);
    await this._delay(3500); this._shell.onGameComplete();
  },

  _addHistItem(round,playerTake,oppTake,grew,newStock){
    const list=document.getElementById('commons-hist'); if(!list)return;
    const el=document.createElement('div'); el.className='commons-hist-item';
    el.innerHTML=`<div class="commons-hist-label">Round ${round}</div>You: ${Math.round(playerTake)} · Opp: ${Math.round(oppTake)}<br>${grew>0?`Grew +${Math.round(grew)} → `:''}Stock: ${Math.round(newStock)}`;
    list.insertBefore(el,list.firstChild);
  },

  getResults(){
    const s=this._state,actual=s.totalHarvested;
    const betaDesc=s.beta<0.414?'Extract early':s.beta<1?'Wait for R2':'Wait for R3';
    let title,profile,analysis;
    if(actual>=35){title='The Rational Harvester';profile='Optimal Resource Manager';analysis=`${Math.round(actual)} fish collected with β=${s.beta.toFixed(3)}. ${betaDesc} was the Nash prescription — you applied it well. Most lab subjects under-extract relative to Nash.`;}
    else if(actual>=20){title='The Conservationist';profile='Patient but Sub-Optimal';analysis=`${Math.round(actual)} fish collected. With β=${s.beta.toFixed(3)}, Nash prescribes R1=${Math.round(s.nashR1*100)}%/R2=${Math.round(s.nashR2*100)}%/R3=50%. Experimental research finds most players harvest ~25–35% per round regardless of β.`;}
    else{title='Empty Nets';profile='The Over-Trusting Cooperator';analysis=`Only ${Math.round(actual)} fish. Either the opponent extracted aggressively, or you under-harvested. For β=${s.beta.toFixed(3)}, the Nash extract round is ${s.nashR1>0?'1':s.nashR2>0?'2':'3'}.`;}
    return{title,profile,analysis,balanceDelta:+(actual*0.10).toFixed(2),stats:[
      {val:Math.round(actual)+' fish',label:'Total Harvested'},
      {val:'β = '+s.beta.toFixed(3),label:'Growth Rate'},
      {val:`${Math.round(s.nashR1*100)}%/${Math.round(s.nashR2*100)}%/50%`,label:'Nash R1/R2/R3'},
    ]};
  },

  getSubmissionData(){
    const s=this._state, cfg=this._CONFIG;
    const r1=s.history.find(h=>h.round===1)||{};
    const r2=s.history.find(h=>h.round===2)||{};
    const r3=s.history.find(h=>h.round===3)||{};
    const phr=(h)=>h.stock>0?+((h.playerTake||0)/h.stock).toFixed(3):0;
    const ohr=(h)=>h.stock>0?+((h.oppTake||0)/h.stock).toFixed(3):0;
    const followsNash=(actual,nash)=>nash===0?actual<0.05:actual>0.45;
    const ph1=phr(r1),ph2=phr(r2),ph3=phr(r3);
    return {
      // ── Game configuration (snapshot at time of play) ──────
      config: {
        initial_stock:      cfg.initialStock,       // 100 fish
        total_rounds:       cfg.rounds,             // 3
        max_harvest_pct:    cfg.maxHarvest,         // 0.50 (50% max per round)
        beta_distribution:  'uniform[0,1]',         // growth rate distribution
        threshold_r1:       +cfg.threshold1.toFixed(4),  // √2-1 ≈ 0.4142
        threshold_r2:       cfg.threshold2,         // 1.0
      },
      // ── Random parameters drawn for this game ───────────────
      drawn_params: {
        beta:               s.beta,                 // float [0,1] — the growth rate
        nash_r1:            s.nashR1,               // 0 or 0.5 (Nash prescription R1)
        nash_r2:            s.nashR2,               // 0 or 0.5 (Nash prescription R2)
        nash_r3:            0.5,                    // always 0.5 in R3
      },
      // ── Payoff structure ────────────────────────────────────
      payoffs: {
        payoff_per_fish:    0.10,                   // $0.10 per fish harvested
        growth_formula:     'remaining × (1 + beta)',
        max_possible_fish:  cfg.initialStock * Math.pow(1 + s.beta, 3), // theoretical max
      },
      // ── Opponent model params ────────────────────────────────
      opponent_model: {
        type:               'empirical_normal_phase1',
        mean_formula:       '0.30 - 0.15×beta',
        sd_formula:         '0.10 + 0.05×(1-beta)',
        mean_r1:            +(0.30-0.15*s.beta).toFixed(3),
        sd_r1:              +(0.10+0.05*(1-s.beta)).toFixed(3),
        bounds:             [0, 0.50],
        source:             'Ostrom, Gardner & Walker (1994); Keser & Gardner (1999)',
      },
      // ── Per-round player choices (as harvest %) ─────────────
      player_harvest_r1:    ph1,
      player_harvest_r2:    ph2,
      player_harvest_r3:    ph3,
      opp_harvest_r1:       ohr(r1),
      opp_harvest_r2:       ohr(r2),
      opp_harvest_r3:       ohr(r3),
      player_fish_r1:       Math.round(r1.playerTake||0),
      player_fish_r2:       Math.round(r2.playerTake||0),
      player_fish_r3:       Math.round(r3.playerTake||0),
      stock_r1_start:       Math.round(r1.stock||100),
      stock_r2_start:       Math.round(r2.stock||0),
      stock_r3_start:       Math.round(r3.stock||0),
      followed_nash_r1:     followsNash(ph1,s.nashR1),
      followed_nash_r2:     followsNash(ph2,s.nashR2),
      total_fish_harvested: +s.totalHarvested.toFixed(1),
      total_earnings:       +(s.totalHarvested*0.10).toFixed(2),
    };
  },

  destroy(){
    if(this._animId) cancelAnimationFrame(this._animId);
    this._fish=[];this._canvas=null;this._ctx=null;this._state=null;this._shell=null;this._animId=null;
  },
  _delay(ms){return new Promise(r=>setTimeout(r,ms));},
};

GameRegistry.register(GameCommons);
