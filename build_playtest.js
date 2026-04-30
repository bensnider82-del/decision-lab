/* build_playtest.js — run with: node build_playtest.js
   Produces decision_lab_playtest.html — the combined single-file playtest.
   To add a new game: add its filename to gameFiles below, then re-run. */

const fs = require('fs');

function stripBlockComment(code) {
  const trimmed = code.trimStart();
  if (trimmed.startsWith('/*')) {
    const end = code.indexOf('*/');
    if (end > -1) return code.slice(end + 2).trimStart();
  }
  return code;
}

// ── Game pool — add new games here ───────────────────────────
const gameFiles = [
  'game_bart.js',
  'game_centipede.js',
  'game_duel.js',
  'game_dutch_auction.js',
  'game_commons.js',
];

// ── API endpoint — change to your Firebase URL when live ─────
const API_SUBMIT     = 'https://us-central1-decision-lab-1ff13.cloudfunctions.net/submitSession';
const API_LEADERBOARD= 'https://us-central1-decision-lab-1ff13.cloudfunctions.net/getLeaderboard';
// While testing locally: set to '' to skip actual submission

// ── Parse game files ─────────────────────────────────────────
const gameBodies = gameFiles.map(f => stripBlockComment(fs.readFileSync(f, 'utf8')));
let allOk = true;
gameBodies.forEach((b, i) => {
  try { new Function(b); console.log(gameFiles[i], 'OK'); }
  catch(e) { console.log(gameFiles[i], 'ERROR:', e.message); allOk = false; }
});
if (!allOk) { console.error('Fix parse errors first.'); process.exit(1); }

const gameScripts = gameBodies.map((body, i) =>
  `<!-- GAME MODULE: ${gameFiles[i].replace('game_','').replace('.js','').toUpperCase()} -->\n<script>\n${body}\n</script>`
).join('\n\n');

// ── DataCollector (inline) ───────────────────────────────────
const dataCollectorJS = `
function generateUUID(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16);});}
function r2(v){return Math.round(v*100)/100;}

const DataCollector=(()=>{
  let _sid,_results=[],_bal=100,_hints=false,_order=[],_running=100;
  return {
    startSession(hints){_sid=generateUUID();_results=[];_bal=100;_running=100;_hints=hints;_order=[];},
    recordGame(game,winnings){
      const idx=_results.length, start=_running, end=r2(_running+winnings);
      _running=end; _order.push(game.id);
      let params={};
      if(typeof game.getSubmissionData==='function') try{params=game.getSubmissionData();}catch(e){console.warn('getSubmissionData failed',game.id,e);}
      _results.push({result_id:_sid+'_'+game.id,session_id:_sid,game_type:game.id,game_index:idx,balance_at_start:start,winnings:r2(winnings),balance_at_end:end,game_params:params});
    },
    async submitSession(playerName,apiUrl){
      if(!_results.length) return{ok:false,error:'No games'};
      const payload={
        session:{session_id:_sid,player_name:playerName.trim(),hints_enabled:_hints,games_played:_results.length,starting_balance:_bal,final_balance:_running,game_order:_order,timestamp_client:new Date().toISOString(),timezone_offset:new Date().getTimezoneOffset(),game_version:'1.0.0'},
        game_results:_results
      };
      if(!apiUrl){console.log('[DataCollector] Dry-run payload:',JSON.stringify(payload,null,2));return{ok:true,dry:true,final_balance:_running};}
      try{
        const resp=await fetch(apiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const data=await resp.json();
        if(!resp.ok) return{ok:false,error:data.error,status:resp.status};
        return{ok:true,...data};
      }catch(e){return{ok:false,error:e.message};}
    },
    getFinalBalance(){return _running;},
    getSessionId(){return _sid;},
  };
})();
`;

// ── Phase system stub ────────────────────────────────────────
// When API is live, this fetches real opponent distributions.
// Phase 1 (< 50 submissions): returns null → game uses academic baseline.
// Phase 2 (50-500): returns blended distribution object.
// Phase 3 (> 500): returns primarily real data.
const phaseSystemJS = `
const PhaseSystem=(()=>{
  const PHASE_URL=''; // set to API_LEADERBOARD base when live
  const _cache={};
  return {
    async getOpponentData(gameType){
      if(_cache[gameType]) return _cache[gameType];
      if(!PHASE_URL) return null; // Phase 1: use academic baseline
      try{
        const resp=await fetch(PHASE_URL+'/opponent?game='+gameType);
        if(!resp.ok) return null;
        const data=await resp.json();
        _cache[gameType]=data;
        return data;
      }catch(e){return null;}
    }
  };
})();
`;

// ── CSS ──────────────────────────────────────────────────────
const css = `
:root{--cream:#F5F0E8;--ink:#1A1612;--gold:#C8A84B;--red:#C0392B;--green:#2E7D52;--muted:#7A7268;--surface:#FDFBF7;--border:rgba(26,22,18,0.12);--border-solid:#E0DDD8;}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:100%;height:100%;background:var(--cream);font-family:'DM Sans',sans-serif;color:var(--ink);overflow:hidden;}
#app{width:100%;height:100vh;position:relative;display:flex;align-items:center;justify-content:center;}
.screen{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:opacity .55s ease,transform .55s ease;}
.screen.hidden{opacity:0;pointer-events:none;transform:translateY(16px);}
.bg-grid{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(26,22,18,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(26,22,18,.04) 1px,transparent 1px);background-size:40px 40px;}
.bg-c{position:absolute;border-radius:50%;pointer-events:none;}
.bg-c1{width:580px;height:580px;top:-170px;right:-110px;border:1px solid rgba(200,168,75,.18);}
.bg-c2{width:400px;height:400px;top:-80px;right:-20px;border:1px solid rgba(200,168,75,.12);}
.bg-c3{width:680px;height:680px;bottom:-230px;left:-180px;border:1px solid rgba(26,22,18,.05);}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.3;}}
.dot-pulse{width:6px;height:6px;border-radius:50%;background:var(--gold);animation:pulse 2s ease-in-out infinite;}
.badge{display:inline-flex;align-items:center;gap:8px;padding:5px 14px;border:1px solid var(--gold);border-radius:2px;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);}
.btn{display:inline-flex;align-items:center;gap:10px;padding:14px 32px;border:none;border-radius:2px;cursor:pointer;font-family:'DM Mono',monospace;font-size:12px;letter-spacing:.1em;text-transform:uppercase;transition:transform .12s ease,background .18s ease;}
.btn:hover{transform:translateY(-2px);}
.btn:active{transform:scale(.97);}
.btn-dark{background:var(--ink);color:var(--cream);}
.btn-dark:hover{background:var(--gold);color:var(--ink);}
.btn-green{background:var(--green);color:#fff;}
.btn-green:hover{background:#236040;}
.btn:disabled{opacity:.38;cursor:not-allowed;transform:none!important;}
.btn-ghost{padding:10px 20px;border:1px solid var(--border-solid);border-radius:2px;background:transparent;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);transition:all .15s ease;}
.btn-ghost:hover{border-color:var(--gold);color:var(--gold);}
.hidden{display:none!important;}
#screen-start{flex-direction:column;overflow:hidden;}
.start-content{position:relative;z-index:1;text-align:center;padding:2rem;max-width:640px;width:100%;}
.start-title{font-family:'Playfair Display',serif;font-size:clamp(46px,7.5vw,68px);font-weight:900;line-height:1;letter-spacing:-.02em;color:var(--ink);margin-bottom:.4rem;animation:fadeUp .6s ease .1s both;}
.start-title em{font-style:italic;color:var(--gold);}
.start-sub{font-family:'Playfair Display',serif;font-size:clamp(13px,2.2vw,17px);color:var(--muted);margin-bottom:1.3rem;animation:fadeUp .6s ease .2s both;}
.mode-section{animation:fadeUp .6s ease .22s both;margin-bottom:1.1rem;}
.mode-label{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:7px;}
.mode-tabs{display:flex;gap:8px;justify-content:center;}
.mode-tab{padding:9px 20px;border-radius:2px;cursor:pointer;border:1px solid var(--border-solid);font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.07em;text-transform:uppercase;background:var(--surface);color:var(--muted);transition:all .15s ease;}
.mode-tab:hover{border-color:var(--gold);color:var(--gold);}
.mode-tab.active{background:var(--ink);color:var(--cream);border-color:var(--ink);}
.game-select-grid{display:flex;flex-direction:column;gap:5px;max-width:460px;margin:0 auto 1.1rem;}
.game-select-row{display:flex;align-items:center;gap:10px;padding:9px 13px;border-radius:3px;border:1px solid var(--border-solid);background:var(--surface);cursor:pointer;transition:all .15s ease;}
.game-select-row:hover{border-color:var(--gold);}
.game-select-row.selected{border-color:var(--ink);background:var(--ink);}
.game-select-row.selected .gs-name{color:var(--cream);}
.game-select-row.selected .gs-cat{color:rgba(245,240,232,.45);}
.gs-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.gs-name{flex:1;font-size:13px;color:var(--ink);font-weight:500;text-align:left;}
.gs-cat{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);}
.gs-dot.risky{background:var(--red);}
.gs-dot.theory{background:#1A5F8A;}
.gs-dot.probability{background:#6B3FA0;}
.pool-preview{background:var(--ink);border-radius:4px;padding:12px 16px;margin-bottom:1.1rem;animation:fadeUp .6s ease .27s both;}
.pool-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
.pool-tag{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);}
.pool-count{font-family:'DM Mono',monospace;font-size:11px;color:rgba(245,240,232,.4);}
.pool-games{display:flex;flex-wrap:wrap;gap:5px;}
.pool-game-tag{font-family:'DM Mono',monospace;font-size:10px;padding:3px 8px;border-radius:2px;border:1px solid rgba(245,240,232,.13);color:rgba(245,240,232,.65);}
.pool-game-tag.risky{border-color:rgba(192,57,43,.4);color:#E8806A;}
.pool-game-tag.theory{border-color:rgba(26,95,138,.4);color:#7BAFD4;}
.pool-game-tag.prob{border-color:rgba(107,63,160,.4);color:#B89DDD;}
.options-row{display:flex;gap:20px;justify-content:center;align-items:center;margin-bottom:1.1rem;animation:fadeUp .6s ease .32s both;}
.toggle-wrap{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;}
.toggle-label{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;}
.toggle{width:36px;height:20px;border-radius:10px;background:var(--border-solid);position:relative;transition:background .2s ease;flex-shrink:0;}
.toggle.on{background:var(--ink);}
.toggle-knob{width:14px;height:14px;border-radius:50%;background:#fff;position:absolute;top:3px;left:3px;transition:transform .2s ease;box-shadow:0 1px 3px rgba(0,0,0,.2);}
.toggle.on .toggle-knob{transform:translateX(16px);}
.play-btn-wrap{animation:fadeUp .6s ease .38s both;}
.play-arrow{font-size:16px;transition:transform .18s ease;}
.btn-dark:hover .play-arrow{transform:translateX(5px);}
#screen-game{flex-direction:column;overflow:hidden;}
.game-layout{width:100%;height:100vh;display:flex;flex-direction:column;}
.game-header{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;}
.header-logo{font-family:'Playfair Display',serif;font-size:16px;font-weight:700;color:var(--ink);}
.header-logo em{color:var(--gold);font-style:italic;}
.header-center{display:flex;flex-direction:column;align-items:center;}
.header-game-tag{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);margin-bottom:2px;}
.header-game-name{font-family:'Playfair Display',serif;font-size:15px;font-weight:700;color:var(--ink);}
.header-right{display:flex;align-items:center;gap:10px;}
.exit-btn{padding:6px 12px;border-radius:2px;border:1px solid var(--border-solid);background:transparent;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);transition:all .15s ease;}
.exit-btn:hover{border-color:var(--red);color:var(--red);}
.hints-chip{font-family:'DM Mono',monospace;font-size:10px;padding:4px 10px;border-radius:2px;border:1px solid var(--border-solid);color:var(--muted);}
.hints-chip.on{border-color:rgba(200,168,75,.4);color:var(--gold);background:rgba(200,168,75,.08);}
.balance-pill{display:flex;align-items:center;gap:8px;padding:7px 14px;background:var(--ink);border-radius:2px;}
.balance-label{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(245,240,232,.55);}
.balance-amount{font-family:'DM Mono',monospace;font-size:16px;font-weight:500;color:var(--cream);transition:color .35s ease;min-width:70px;text-align:right;}
.balance-amount.gain{color:#6EC994;}
.balance-amount.loss{color:#E8806A;}
.progress-row{display:flex;align-items:center;gap:8px;padding:9px 24px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;}
.prog-label{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
.prog-dots{display:flex;gap:6px;}
.prog-dot{width:8px;height:8px;border-radius:50%;background:var(--border-solid);transition:all .3s ease;}
.prog-dot.done{background:var(--green);}
.prog-dot.current{background:var(--gold);transform:scale(1.3);}
#game-mount{flex:1;overflow:hidden;position:relative;}
.game-intro-overlay{position:absolute;inset:0;z-index:20;background:rgba(245,240,232,.97);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;}
.intro-badge{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);padding:5px 14px;border-radius:2px;margin-bottom:1.4rem;}
.intro-title{font-family:'Playfair Display',serif;font-size:32px;font-weight:900;color:var(--ink);margin-bottom:.65rem;}
.intro-desc{font-size:14px;color:var(--muted);line-height:1.75;max-width:380px;margin-bottom:1.8rem;}
.intro-rules{display:flex;flex-direction:column;gap:10px;max-width:350px;margin-bottom:1.8rem;text-align:left;}
.rule-item{display:flex;align-items:flex-start;gap:12px;font-size:13px;color:var(--ink);line-height:1.6;}
.rule-num{font-family:'DM Mono',monospace;font-size:11px;color:var(--gold);min-width:20px;margin-top:1px;flex-shrink:0;}
#screen-results{flex-direction:column;overflow-y:auto;}
.results-content{text-align:center;padding:2rem;max-width:600px;width:100%;animation:fadeUp .5s ease both;}
.results-title{font-family:'Playfair Display',serif;font-size:40px;font-weight:900;color:var(--ink);line-height:1.05;margin-bottom:.4rem;}
.results-profile{font-family:'Playfair Display',serif;font-size:18px;font-style:italic;color:var(--gold);margin-bottom:1.4rem;}
.session-summary{background:var(--ink);border-radius:4px;padding:12px 16px;margin-bottom:1.2rem;text-align:left;}
.session-summary-title{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--gold);margin-bottom:8px;}
.session-game-rows{display:flex;flex-direction:column;gap:4px;}
.session-game-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.07);}
.session-game-row:last-child{border-bottom:none;}
.session-game-name{font-size:12px;color:rgba(245,240,232,.8);}
.session-game-cat{font-family:'DM Mono',monospace;font-size:9px;padding:2px 6px;border-radius:2px;}
.session-game-cat.risky{background:rgba(192,57,43,.2);color:#E8806A;}
.session-game-cat.theory{background:rgba(26,95,138,.2);color:#7BAFD4;}
.session-game-earn{font-family:'DM Mono',monospace;font-size:12px;font-weight:500;}
.session-game-earn.pos{color:#6EC994;}
.session-game-earn.neg{color:#E8806A;}
.session-game-earn.zero{color:rgba(245,240,232,.4);}
.results-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:4px;overflow:hidden;margin-bottom:1.2rem;}
.res-cell{background:var(--surface);padding:14px 8px;text-align:center;}
.res-cell-val{font-family:'DM Mono',monospace;font-size:20px;font-weight:500;color:var(--ink);margin-bottom:4px;}
.res-cell-label{font-size:11px;color:var(--muted);letter-spacing:.04em;}
.result-analysis{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px 18px;text-align:left;margin-bottom:1.2rem;}
.analysis-title{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}
.analysis-text{font-size:13px;color:var(--ink);line-height:1.75;}
.results-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}

/* ── LEADERBOARD SCREEN ── */
#screen-leaderboard{flex-direction:column;overflow-y:auto;}
.lb-content{text-align:center;padding:2rem;max-width:560px;width:100%;animation:fadeUp .5s ease both;}
.lb-title{font-family:'Playfair Display',serif;font-size:36px;font-weight:900;color:var(--ink);margin-bottom:.3rem;}
.lb-sub{font-size:14px;color:var(--muted);margin-bottom:1.4rem;}
.lb-balance-big{font-family:'DM Mono',monospace;font-size:42px;font-weight:500;color:var(--ink);margin-bottom:.3rem;}
.lb-percentile{font-size:14px;color:var(--muted);margin-bottom:6px;}
.lb-percentile strong{color:var(--ink);}
.lb-pct-bar-wrap{background:var(--border-solid);border-radius:3px;height:6px;overflow:hidden;max-width:360px;margin:0 auto 1.4rem;}
.lb-pct-bar{height:100%;border-radius:3px;background:var(--green);transition:width .8s ease;}
.lb-name-section{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:16px 18px;margin-bottom:1.2rem;text-align:left;}
.lb-name-label{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;}
.lb-name-inputs{display:flex;gap:10px;align-items:center;}
.lb-name-first{flex:1.6;padding:9px 12px;border:1px solid var(--border-solid);border-radius:3px;font-size:14px;background:var(--cream);color:var(--ink);font-family:'DM Sans',sans-serif;}
.lb-name-last{flex:.8;padding:9px 12px;border:1px solid var(--border-solid);border-radius:3px;font-size:14px;background:var(--cream);color:var(--ink);font-family:'DM Sans',sans-serif;}
.lb-name-first:focus,.lb-name-last:focus{outline:none;border-color:var(--gold);}
.lb-submit-btn{white-space:nowrap;}
.lb-submit-status{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);margin-top:6px;min-height:16px;}
.lb-table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden;margin-bottom:1.2rem;text-align:left;}
.lb-table-header{display:grid;grid-template-columns:36px 1fr 80px 70px;gap:8px;padding:8px 12px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border);}
.lb-row{display:grid;grid-template-columns:36px 1fr 80px 70px;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);align-items:center;transition:background .1s ease;}
.lb-row:last-child{border-bottom:none;}
.lb-row:hover{background:rgba(200,168,75,.04);}
.lb-row.lb-you{background:rgba(26,22,18,.04);border-left:3px solid var(--gold);}
.lb-rank{font-family:'DM Mono',monospace;font-size:12px;color:var(--muted);}
.lb-rank.top{color:var(--gold);font-weight:500;}
.lb-name-cell{font-size:13px;color:var(--ink);}
.lb-you-tag{font-family:'DM Mono',monospace;font-size:9px;padding:1px 6px;border-radius:2px;border:1px solid var(--border-solid);color:var(--muted);margin-left:6px;}
.lb-bal{font-family:'DM Mono',monospace;font-size:12px;color:var(--green);text-align:right;}
.lb-date{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);text-align:right;}
.lb-total-count{font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-align:center;padding:8px;}
`;

// ── Shell controller JS ──────────────────────────────────────
const shellJS = `
const API_SUBMIT      = '${API_SUBMIT}';
const API_LEADERBOARD = '${API_LEADERBOARD}';

const Shell=(()=>{
  let balance=100,sessionGames=[],gameIndex=0,sessionResults=[],mode='session';
  let selectedGame=null,hintsEnabled=false,_leaderboardData=null;

  const screens={start:document.getElementById('screen-start'),game:document.getElementById('screen-game'),results:document.getElementById('screen-results'),leaderboard:document.getElementById('screen-leaderboard')};
  function show(name){Object.entries(screens).forEach(([k,el])=>el.classList.toggle('hidden',k!==name));}

  function flashBalance(delta){
    balance=+(balance+delta).toFixed(2);
    const el=document.getElementById('balance-display');
    el.textContent='$'+balance.toFixed(2);
    const cls=delta>=0?'gain':'loss';
    el.classList.add(cls);
    setTimeout(()=>el.classList.remove(cls),700);
  }
  function resetBalance(){balance=100;const el=document.getElementById('balance-display');if(el)el.textContent='$100.00';}

  function populateStartScreen(){
    const pool=GameRegistry.getAll(),catCls={risky:'risky',theory:'theory',probability:'prob'};
    const pt=document.getElementById('pool-count-tag'),pl=document.getElementById('pool-games-list');
    if(pt)pt.textContent=pool.length+' game'+(pool.length!==1?'s':'')+' \xb7 plays '+GameRegistry.sessionSize();
    if(pl)pl.innerHTML=pool.map(g=>'<div class="pool-game-tag '+(catCls[g.category]||'')+'">'+g.name+'</div>').join('');
    const grid=document.getElementById('game-select-grid');
    if(grid){
      grid.innerHTML=pool.map(g=>{const dot=catCls[g.category]||'',sel=selectedGame&&selectedGame.id===g.id;return '<div class="game-select-row'+(sel?' selected':'')+'" data-id="'+g.id+'"><div class="gs-dot '+dot+'"></div><div class="gs-name">'+g.name+'</div><div class="gs-cat">'+g.category+'</div></div>';}).join('');
      grid.querySelectorAll('.game-select-row').forEach(function(row){row.addEventListener('click',function(){selectedGame=GameRegistry.getById(row.dataset.id);populateStartScreen();});});
    }
  }

  function renderDots(){
    const row=document.getElementById('progress-row'),dots=document.getElementById('prog-dots');
    if(!row)return;
    if(mode==='single'){row.style.display='none';return;}
    row.style.display='';
    if(dots)dots.innerHTML=sessionGames.map((_,i)=>'<div class="prog-dot'+(i<gameIndex?' done':i===gameIndex?' current':'')+'"></div>').join('');
  }

  function showIntro(game,tag,onStart){
    const mount=document.getElementById('game-mount'),overlay=document.createElement('div');
    overlay.className='game-intro-overlay';
    const rulesHTML=game.intro.rules.map((r,i)=>'<div class="rule-item"><div class="rule-num">'+String(i+1).padStart(2,'0')+'</div><div>'+r+'</div></div>').join('');
    overlay.innerHTML='<div class="intro-badge">'+tag+'</div><div class="intro-title">'+game.intro.title+'</div><div class="intro-desc">'+game.intro.desc+'</div><div class="intro-rules">'+rulesHTML+'</div><button class="btn btn-dark" id="intro-start-btn">Start \u2192</button>';
    mount.appendChild(overlay);
    document.getElementById('intro-start-btn').addEventListener('click',function(){overlay.remove();onStart();});
  }

  function updateHintsChip(){const chip=document.getElementById('hints-chip');if(!chip)return;chip.textContent=hintsEnabled?'Hints On':'Hints Off';chip.className='hints-chip'+(hintsEnabled?' on':'');}

  function loadGame(index){
    const game=sessionGames[index],catLabel={risky:'Risky',theory:'Game Theory',probability:'Probability'};
    document.getElementById('hdr-game-tag').textContent=mode==='single'?'Single Game':'Game '+(index+1)+' of '+sessionGames.length;
    document.getElementById('hdr-game-name').textContent=game.shortName;
    renderDots();
    document.getElementById('game-mount').innerHTML='';
    const shellAPI={
      onGameComplete:function(){
        const res=game.getResults();
        flashBalance(res.balanceDelta);
        sessionResults.push({game:game,balanceDelta:res.balanceDelta,title:res.title,profile:res.profile,analysis:res.analysis,stats:res.stats});
        // Record for data submission (session mode only)
        if(mode==='session') DataCollector.recordGame(game,res.balanceDelta);
        setTimeout(function(){game.destroy();gameIndex++;if(gameIndex<sessionGames.length)loadGame(gameIndex);else showFinalResults();},800);
      },
      getBalance:function(){return balance;},
      flashBalance:flashBalance,
    };
    const tag=mode==='single'?game.name:'Game '+(index+1)+' of '+sessionGames.length+' \xb7 '+(catLabel[game.category]||game.category);
    showIntro(game,tag,function(){game.mount(document.getElementById('game-mount'),shellAPI,hintsEnabled);});
  }

  function showFinalResults(){
    const totalDelta=sessionResults.reduce(function(s,r){return s+r.balanceDelta;},0);
    const catCls={risky:'risky',theory:'theory',probability:'prob'};
    const isSingle=mode==='single';
    const sumEl=document.getElementById('session-summary'),rowsEl=document.getElementById('session-game-rows');
    if(isSingle&&sumEl)sumEl.style.display='none';
    if(!isSingle&&sumEl)sumEl.style.display='';
    if(!isSingle&&rowsEl)rowsEl.innerHTML=sessionResults.map(function(r){const d=r.balanceDelta,earn=(d>=0?'+':'')+'$'+d.toFixed(2),eCls=d>0?'pos':d<0?'neg':'zero',cCls=catCls[r.game.category]||'';return '<div class="session-game-row"><span class="session-game-name">'+r.game.name+'</span><span class="session-game-cat '+cCls+'">'+r.game.category+'</span><span class="session-game-earn '+eCls+'">'+earn+'</span></div>';}).join('');
    const lastRes=sessionResults[sessionResults.length-1];
    const wins=sessionResults.filter(function(r){return r.balanceDelta>0;}).length;
    const losses=sessionResults.filter(function(r){return r.balanceDelta<0;}).length;
    document.getElementById('results-badge').textContent=isSingle?'Game Complete':'Session \xb7 '+sessionGames.length+' Games';
    document.getElementById('results-title').textContent=lastRes.title;
    document.getElementById('results-profile').textContent=lastRes.profile;
    document.getElementById('analysis-text').textContent=lastRes.analysis;
    function cell(v,l){return '<div class="res-cell"><div class="res-cell-val">'+v+'</div><div class="res-cell-label">'+l+'</div></div>';}
    const s1=lastRes.stats&&lastRes.stats[1]?lastRes.stats[1]:{val:'--',label:'Stat'};
    document.getElementById('results-grid').innerHTML=cell('$'+balance.toFixed(2),'Final Balance')+cell((totalDelta>=0?'+':'')+'$'+totalDelta.toFixed(2),isSingle?'Earned':'Net')+cell(isSingle?s1.val:wins+'W \xb7 '+losses+'L',isSingle?s1.label:'Won / Lost');
    show('results');
    // After session of 5, go to leaderboard
    if(!isSingle){setTimeout(function(){show('leaderboard');populateLeaderboard();},2200);}
  }

  // ── LEADERBOARD ─────────────────────────────────────────────
  function populateLeaderboard(){
    const el=document.getElementById('lb-balance-big');
    if(el)el.textContent='$'+balance.toFixed(2);
    // Percentile will update after submit
    document.getElementById('lb-pct-bar').style.width='50%';
    document.getElementById('lb-percentile').innerHTML='Submit your name to see your rank';
  }

  async function submitAndLoadLeaderboard(playerName){
    const statusEl=document.getElementById('lb-submit-status');
    if(statusEl)statusEl.textContent='Submitting...';
    const apiUrl=API_SUBMIT||'';
    const result=await DataCollector.submitSession(playerName,apiUrl);
    if(result.ok&&!result.dry){
      const pct=result.percentile||50;
      const total=result.total_players||1;
      document.getElementById('lb-percentile').innerHTML='You finished in the <strong>top '+pct+'%</strong> of '+total+' players';
      document.getElementById('lb-pct-bar').style.width=pct+'%';
      if(result.leaderboard) renderLeaderboard(result.leaderboard, DataCollector.getSessionId());
      if(statusEl)statusEl.textContent='Saved! \u2713';
    } else if(result.dry){
      if(statusEl)statusEl.textContent='(Test mode \u2014 not submitted to database)';
      document.getElementById('lb-percentile').innerHTML='Set API_SUBMIT in build_playtest.js to go live';
      loadLeaderboardFromAPI();
    } else {
      if(statusEl)statusEl.textContent='Error: '+(result.error||'Unknown');
    }
  }

  async function loadLeaderboardFromAPI(){
    if(!API_LEADERBOARD) return;
    try{
      const resp=await fetch(API_LEADERBOARD);
      if(!resp.ok) return;
      const data=await resp.json();
      renderLeaderboard(data.leaderboard||[],null);
    }catch(e){}
  }

  function renderLeaderboard(rows, mySessionId){
    const tbody=document.getElementById('lb-rows');
    if(!tbody) return;
    tbody.innerHTML=rows.map(function(r,i){
      const isYou=mySessionId&&r.session_id===mySessionId;
      const rankCls=i<3?'top':'';
      const d=r.date?new Date(r.date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—';
      return '<div class="lb-row'+(isYou?' lb-you':'')+'"><div class="lb-rank '+rankCls+'">'+r.rank+'</div><div class="lb-name-cell">'+r.name+(isYou?'<span class="lb-you-tag">you</span>':'')+'</div><div class="lb-bal">$'+r.balance.toFixed(2)+'</div><div class="lb-date">'+d+'</div></div>';
    }).join('');
    const countEl=document.getElementById('lb-total-count');
    if(countEl&&rows.length)countEl.textContent=rows.length+' shown of all sessions';
  }

  function startSession(){
    if(mode==='single'){if(!selectedGame){alert('Please select a game.');return;}sessionGames=[selectedGame];}
    else{sessionGames=GameRegistry.draw(GameRegistry.sessionSize());if(!sessionGames.length)return;}
    gameIndex=0;sessionResults=[];resetBalance();updateHintsChip();
    // Start data collection for session mode
    if(mode==='session') DataCollector.startSession(hintsEnabled);
    const sumEl=document.getElementById('session-summary');if(sumEl)sumEl.style.display=mode==='single'?'none':'';
    show('game');loadGame(0);
  }

  function init(){
    populateStartScreen();
    document.querySelectorAll('.mode-tab').forEach(function(tab){tab.addEventListener('click',function(){mode=tab.dataset.mode;document.querySelectorAll('.mode-tab').forEach(function(t){t.classList.remove('active');});tab.classList.add('active');document.getElementById('session-panel').classList.toggle('hidden',mode==='single');document.getElementById('single-panel').classList.toggle('hidden',mode==='session');});});
    document.getElementById('hints-toggle-wrap').addEventListener('click',function(){hintsEnabled=!hintsEnabled;document.getElementById('hints-toggle').classList.toggle('on',hintsEnabled);});
    document.getElementById('begin-btn').addEventListener('click',startSession);
    document.getElementById('exit-btn').addEventListener('click',function(){if(sessionGames[gameIndex]&&sessionGames[gameIndex].destroy)try{sessionGames[gameIndex].destroy();}catch(e){}resetBalance();populateStartScreen();show('start');});
    document.getElementById('play-again-btn').addEventListener('click',function(){resetBalance();if(mode==='single'){if(!selectedGame){show('start');return;}sessionGames=[selectedGame];}else{sessionGames=GameRegistry.draw(GameRegistry.sessionSize());}gameIndex=0;sessionResults=[];updateHintsChip();if(mode==='session')DataCollector.startSession(hintsEnabled);const sumEl=document.getElementById('session-summary');if(sumEl)sumEl.style.display=mode==='single'?'none':'';show('game');loadGame(0);});
    document.getElementById('back-btn').addEventListener('click',function(){populateStartScreen();show('start');});
    document.getElementById('lb-back-btn').addEventListener('click',function(){populateStartScreen();show('start');});
    document.getElementById('lb-play-again-btn').addEventListener('click',function(){startSession();});
    // Name submit
    document.getElementById('lb-submit-btn').addEventListener('click',function(){
      const first=document.getElementById('lb-first-name').value.trim();
      const last=document.getElementById('lb-last-name').value.trim();
      if(!first){document.getElementById('lb-first-name').focus();return;}
      const name=first+(last?' '+last[0].toUpperCase()+'.':'');
      document.getElementById('lb-submit-btn').disabled=true;
      submitAndLoadLeaderboard(name);
    });
    // Also load leaderboard when screen first shows (for display before submit)
    loadLeaderboardFromAPI();
  }
  return{init:init};
})();
Shell.init();
`;

// ── Full HTML ─────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Decision Lab</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div id="app">

<!-- START SCREEN -->
<div class="screen" id="screen-start">
  <div class="bg-grid"></div><div class="bg-c bg-c1"></div><div class="bg-c bg-c2"></div><div class="bg-c bg-c3"></div>
  <div class="start-content">
    <div class="badge" style="margin-bottom:1.2rem;animation:fadeUp .6s ease both;"><div class="dot-pulse"></div>Decision Lab</div>
    <div class="start-title">Decision<br><em>Lab</em></div>
    <div class="start-sub">Game Theory Playtest</div>
    <div class="mode-section">
      <div class="mode-label">Play Mode</div>
      <div class="mode-tabs">
        <div class="mode-tab active" data-mode="session">&#x1F3B2; Full Session (5 games)</div>
        <div class="mode-tab" data-mode="single">&#x1F3AF; Single Game</div>
      </div>
    </div>
    <div id="session-panel">
      <div class="pool-preview"><div class="pool-header"><div class="pool-tag">&#x25B6; Game Pool</div><div class="pool-count" id="pool-count-tag">&#x2014;</div></div><div class="pool-games" id="pool-games-list"></div></div>
    </div>
    <div id="single-panel" class="hidden">
      <div style="margin-bottom:.6rem;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);">Select a game</div>
      <div class="game-select-grid" id="game-select-grid"></div>
    </div>
    <div class="options-row">
      <div class="toggle-wrap" id="hints-toggle-wrap">
        <div class="toggle" id="hints-toggle"><div class="toggle-knob"></div></div>
        <div class="toggle-label">Hints</div>
      </div>
    </div>
    <div class="play-btn-wrap">
      <button class="btn btn-dark" id="begin-btn">Begin <span class="play-arrow">&#x2192;</span></button>
    </div>
  </div>
</div>

<!-- GAME SCREEN -->
<div class="screen hidden" id="screen-game">
  <div class="game-layout">
    <div class="game-header">
      <div class="header-logo">Decision <em>Lab</em></div>
      <div class="header-center"><div class="header-game-tag" id="hdr-game-tag">&#x2014;</div><div class="header-game-name" id="hdr-game-name">&#x2014;</div></div>
      <div class="header-right">
        <button class="exit-btn" id="exit-btn">&#x2715; Exit</button>
        <div class="hints-chip" id="hints-chip">Hints Off</div>
        <div class="balance-pill"><span class="balance-label">Balance</span><span class="balance-amount" id="balance-display">$100.00</span></div>
      </div>
    </div>
    <div class="progress-row" id="progress-row" style="display:none;">
      <span class="prog-label">Session</span><div class="prog-dots" id="prog-dots"></div>
    </div>
    <div id="game-mount"></div>
  </div>
</div>

<!-- RESULTS SCREEN (brief — session mode auto-advances to leaderboard) -->
<div class="screen hidden" id="screen-results">
  <div class="bg-grid"></div>
  <div class="results-content">
    <div class="badge" style="margin-bottom:1.2rem;" id="results-badge">Complete</div>
    <div class="results-title" id="results-title">Well Played</div>
    <div class="results-profile" id="results-profile">&#x2014;</div>
    <div class="session-summary" id="session-summary"><div class="session-summary-title">This Session</div><div class="session-game-rows" id="session-game-rows"></div></div>
    <div class="results-grid" id="results-grid"></div>
    <div class="result-analysis"><div class="analysis-title">Insight</div><div class="analysis-text" id="analysis-text">&#x2014;</div></div>
    <div class="results-actions">
      <button class="btn btn-dark" id="play-again-btn">Play Again &#x2192;</button>
      <button class="btn-ghost" id="back-btn">&#x2190; Menu</button>
    </div>
  </div>
</div>

<!-- LEADERBOARD SCREEN (session mode only, after 5 games) -->
<div class="screen hidden" id="screen-leaderboard">
  <div class="bg-grid"></div>
  <div class="lb-content">
    <div class="badge" style="margin-bottom:1rem;">Session Complete</div>
    <div class="lb-title">Your Result</div>
    <div class="lb-balance-big" id="lb-balance-big">$100.00</div>
    <div class="lb-percentile" id="lb-percentile">Loading...</div>
    <div class="lb-pct-bar-wrap"><div class="lb-pct-bar" id="lb-pct-bar" style="width:50%"></div></div>

    <div class="lb-name-section">
      <div class="lb-name-label">Enter your name for the leaderboard</div>
      <div class="lb-name-inputs">
        <input type="text" class="lb-name-first" id="lb-first-name" placeholder="First name" maxlength="20"/>
        <input type="text" class="lb-name-last"  id="lb-last-name"  placeholder="Last initial" maxlength="5"/>
        <button class="btn btn-dark lb-submit-btn" id="lb-submit-btn">Submit &#x2192;</button>
      </div>
      <div class="lb-submit-status" id="lb-submit-status"></div>
    </div>

    <div class="lb-table-wrap">
      <div class="lb-table-header"><span>#</span><span>Player</span><span style="text-align:right">Balance</span><span style="text-align:right">Date</span></div>
      <div id="lb-rows"><div style="padding:16px;text-align:center;font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);">Loading leaderboard...</div></div>
      <div class="lb-total-count" id="lb-total-count"></div>
    </div>

    <div class="results-actions">
      <button class="btn btn-dark" id="lb-play-again-btn">Play Again &#x2192;</button>
      <button class="btn-ghost" id="lb-back-btn">&#x2190; Menu</button>
    </div>
  </div>
</div>

</div>

<!-- GAME REGISTRY -->
<script>
const GameRegistry=(()=>{
  const _pool=[],MAX=5;
  return {
    register:function(g){if(!_pool.find(function(x){return x.id===g.id;}))_pool.push(g);},
    getAll:function(){return _pool.slice();},
    size:function(){return _pool.length;},
    sessionSize:function(){return Math.min(_pool.length,MAX);},
    getById:function(id){return _pool.find(function(g){return g.id===id;})||null;},
    draw:function(n){const arr=_pool.slice();for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));const t=arr[i];arr[i]=arr[j];arr[j]=t;}return arr.slice(0,Math.min(n,arr.length));},
  };
})();
</script>

<!-- DATA COLLECTOR -->
<script>
${dataCollectorJS}
</script>

<!-- PHASE SYSTEM -->
<script>
${phaseSystemJS}
</script>

${gameScripts}

<!-- SHELL CONTROLLER -->
<script>
${shellJS}
</script>
</body>
</html>`;

fs.writeFileSync('decision_lab_playtest.html', html);
console.log('\nWritten decision_lab_playtest.html (' + Math.round(html.length/1024) + 'KB)');

// Verify all scripts
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
let buildOk = true;
scripts.forEach(function(m, i) {
  try { new Function(m[1]); console.log('Script', i, 'OK'); }
  catch(e) { console.log('Script', i, 'ERROR:', e.message); buildOk = false; }
});
if (buildOk) console.log('\nAll', scripts.length, 'scripts clean. Ready to deploy.');
else { console.error('Build failed.'); process.exit(1); }
