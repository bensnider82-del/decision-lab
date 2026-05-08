const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const VALID_GAMES    = ['centipede', 'bart', 'duel', 'dutch_auction', 'dutch-auction', 'commons', 'beauty_contest', 'high_card'];
const REQUIRED_GAMES = 5;
const MAX_BALANCE    = 500;
const MIN_BALANCE    = 0;
const MAX_NAME_LEN   = 40;

exports.submitSession = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { session, game_results } = req.body;

    // 1. Validate session
    const sessionErr = validateSession(session);
    if (sessionErr) {
      console.warn('[Submit] Session validation failed:', sessionErr);
      return res.status(400).json({ error: sessionErr });
    }

    // 2. Validate game results
    if (!Array.isArray(game_results) || game_results.length !== REQUIRED_GAMES) {
      return res.status(400).json({ error: `Expected ${REQUIRED_GAMES} game results, got ${game_results?.length ?? 0}` });
    }
    for (const gr of game_results) {
      const grErr = validateGameResult(gr, session.session_id);
      if (grErr) {
        console.warn('[Submit] Game result validation failed:', grErr, gr);
        return res.status(400).json({ error: grErr });
      }
    }

    // 3. Verify balance arithmetic
    const computedFinal = game_results.reduce((bal, gr) => {
      return Math.round((bal + gr.winnings) * 100) / 100;
    }, 100);
    if (Math.abs(computedFinal - session.final_balance) > 0.05) {
      return res.status(400).json({
        error: `Balance mismatch: computed ${computedFinal}, claimed ${session.final_balance}`
      });
    }

    // 4. Rate limiting — IP + player_id
    const playerId = session.player_id || 'anonymous';
    const clientIP = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const ipKey    = 'ip_' + clientIP.replace(/[^a-z0-9]/gi, '_');
    const pidKey   = 'pid_' + playerId;

    const [ipDoc, pidDoc] = await Promise.all([
      db.collection('_rate_limits').doc(ipKey).get(),
      db.collection('_rate_limits').doc(pidKey).get(),
    ]);

    const now = Date.now();
    if (ipDoc.exists && now - ipDoc.data().last_ms < 15000) {
      return res.status(429).json({ error: 'Too many requests.' });
    }
    if (pidDoc.exists && now - pidDoc.data().last_ms < 30000) {
      return res.status(429).json({ error: 'Please wait before submitting again.' });
    }

    // 5. Write to Firestore (batch — atomic)
    const batch      = db.batch();
    const serverTime = admin.firestore.FieldValue.serverTimestamp();

    // Session document
    // Flag test sessions — never included in opponent data
    const isTest = /test/i.test(session.player_name);

    const sessionDoc = db.collection('sessions').doc(session.session_id);
    batch.set(sessionDoc, {
      ...session,
      timestamp:            serverTime,
      player_id:            playerId,
      server_final_balance: computedFinal,
      is_test:              isTest,
    });

    // Five game_result documents
    for (const gr of game_results) {
      const grDoc = db.collection('game_results').doc(gr.result_id);
      batch.set(grDoc, {
        ...gr,
        session_id: session.session_id,
        player_id:  playerId,
        timestamp:  serverTime,
      });
    }

    // Rate limit records
    batch.set(db.collection('_rate_limits').doc(ipKey),  { last_ms: now });
    batch.set(db.collection('_rate_limits').doc(pidKey), { last_ms: now });

    await batch.commit();
    console.log('[Submit] Session written:', session.session_id);

    // 6. Return leaderboard
    const top100 = await db.collection('sessions')
      .orderBy('server_final_balance', 'desc')
      .limit(100)
      .get();

    const leaderboard = top100.docs.map((doc, i) => ({
      rank:       i + 1,
      name:       doc.data().player_name,
      balance:    doc.data().server_final_balance,
      session_id: doc.id,
      date:       doc.data().timestamp?.toDate()?.toISOString() || doc.data().timestamp_client || null,
    }));

    const allScores  = await db.collection('sessions').orderBy('server_final_balance', 'desc').get();
    const totalSessions = allScores.size;
    const rank       = allScores.docs.findIndex(d => d.id === session.session_id) + 1;
    // percentile = % of players this session beat (rank 1 of 6 beats 83%, rank 6 of 6 beats 0%)
    const percentile = totalSessions > 1
      ? Math.round(((totalSessions - rank) / totalSessions) * 100)
      : 100;

    return res.status(200).json({
      ok: true,
      session_id:    session.session_id,
      final_balance: computedFinal,
      percentile,
      total_players: totalSessions,
      leaderboard,
    });

  } catch (err) {
    console.error('[Submit] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

exports.getLeaderboard = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const top100 = await db.collection('sessions')
      .orderBy('server_final_balance', 'desc')
      .limit(100)
      .get();

    const leaderboard = top100.docs.map((doc, i) => ({
      rank:    i + 1,
      name:    doc.data().player_name,
      balance: doc.data().server_final_balance,
      date:    doc.data().timestamp?.toDate()?.toISOString() || doc.data().timestamp_client || null,
    }));

    const total = (await db.collection('sessions').count().get()).data().count;

    return res.status(200).json({ leaderboard, total_sessions: total });
  } catch (err) {
    console.error('[Leaderboard] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

function validateSession(s) {
  if (!s || typeof s !== 'object')                      return 'Missing session object';
  if (!s.session_id || typeof s.session_id !== 'string') return 'Missing session_id';
  if (s.session_id.length > 60)                        return 'session_id too long';
  if (!s.player_name || typeof s.player_name !== 'string') return 'Missing player_name';
  if (s.player_name.trim().length === 0)               return 'player_name is empty';
  if (s.player_name.length > MAX_NAME_LEN)             return 'player_name too long';
  if (s.games_played !== 5)                            return 'games_played must be 5';
  if (typeof s.final_balance !== 'number')             return 'final_balance must be a number';
  if (s.final_balance < MIN_BALANCE)                   return `final_balance below minimum`;
  if (s.final_balance > MAX_BALANCE)                   return `final_balance above maximum`;
  if (typeof s.hints_enabled !== 'boolean')            return 'hints_enabled must be boolean';
  if (!Array.isArray(s.game_order))                    return 'game_order must be an array';
  if (s.game_order.length !== 5)                       return 'game_order must have 5 entries';
  for (const g of s.game_order) {
    if (!VALID_GAMES.includes(g))                      return `Unknown game type: ${g}`;
  }
  // Demographics optional — validate shape if present
  if (s.demographics !== null && s.demographics !== undefined) {
    const d = s.demographics;
    if (typeof d !== 'object')                         return 'demographics must be an object';
    if (d.age !== null && d.age !== undefined) {
      if (typeof d.age !== 'number' || d.age < 10 || d.age > 100) return 'demographics.age out of range';
    }
    const validGenders   = ['male','female','nonbinary','other',null,undefined,''];
    const validWork      = ['employed','student','game_theory_student','unemployed','other',null,undefined,''];
    const validEducation = ['high_school','some_college','bachelors','masters','phd','other',null,undefined,''];
    if (!validGenders.includes(d.gender))      return 'demographics.gender invalid';
    if (!validWork.includes(d.work))           return 'demographics.work invalid';
    if (!validEducation.includes(d.education)) return 'demographics.education invalid';
  }
  return null;
}

function validateGameResult(gr, sessionId) {
  if (!gr || typeof gr !== 'object')                   return 'Missing game result object';
  if (!gr.result_id)                                   return 'Missing result_id';
  if (!gr.result_id.startsWith(sessionId))             return 'result_id does not match session_id';
  if (!VALID_GAMES.includes(gr.game_type))             return `Unknown game_type: ${gr.game_type}`;
  if (typeof gr.game_index !== 'number')               return 'game_index must be a number';
  if (gr.game_index < 0 || gr.game_index > 4)         return 'game_index out of range';
  if (typeof gr.balance_at_start !== 'number')         return 'balance_at_start must be a number';
  if (typeof gr.winnings !== 'number')                 return 'winnings must be a number';
  if (gr.winnings < -200 || gr.winnings > 200)         return `winnings out of plausible range`;
  if (typeof gr.game_params !== 'object')              return 'game_params must be an object';
  return null;
}


/* ============================================================
   OPPONENT DATA ENDPOINT
   GET /getOpponentData?game=centipede&player_id=xxx
   Returns phase info + real player distributions
   Excludes: test users, the requesting player themselves
============================================================ */
exports.getOpponentData = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const gameType = req.query.game;
  const playerId = req.query.player_id || null;

  if (!VALID_GAMES.includes(gameType)) {
    return res.status(400).json({ error: 'Unknown game type' });
  }

  try {
    // Count real (non-test) sessions for this game type
    const allQuery = await db.collection('game_results')
      .where('game_type', '==', gameType)
      .get();

    // Filter: exclude test users and the player themselves
    const realDocs = allQuery.docs.filter(d => {
      if (d.data().is_test)   return false;   // tagged as test
      if (playerId && d.data().player_id === playerId) return false; // own data
      return true;
    });

    const realCount = realDocs.length;

    // Phase thresholds
    const PHASE2_THRESHOLD = 50;
    const PHASE3_THRESHOLD = 500;
    let phase, blendWeight;
    if (realCount < PHASE2_THRESHOLD) {
      phase = 1; blendWeight = 0;
    } else if (realCount < PHASE3_THRESHOLD) {
      phase = 2;
      blendWeight = (realCount - PHASE2_THRESHOLD) / (PHASE3_THRESHOLD - PHASE2_THRESHOLD);
    } else {
      phase = 3; blendWeight = 0.95;
    }

    // Extract game_params from real sessions (sample up to 100)
    const sample = realDocs.slice(-100).map(d => d.data().game_params || {});

    return res.status(200).json({
      game_type:        gameType,
      phase,
      blend_weight:     +blendWeight.toFixed(3),
      real_count:       realCount,
      phase2_threshold: PHASE2_THRESHOLD,
      phase3_threshold: PHASE3_THRESHOLD,
      next_threshold:   phase === 1 ? PHASE2_THRESHOLD : phase === 2 ? PHASE3_THRESHOLD : null,
      needed_for_next:  phase === 1 ? PHASE2_THRESHOLD - realCount : phase === 2 ? PHASE3_THRESHOLD - realCount : 0,
      sample,
    });
  } catch (err) {
    console.error('[OpponentData] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ============================================================
   DEV STATS ENDPOINT
   GET /getDevStats
   Returns aggregate stats across all games for the dev panel
============================================================ */
exports.getDevStats = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const PHASE2_THRESHOLD = 50;
  const PHASE3_THRESHOLD = 500;

  try {
    // Total sessions
    const allSessions = await db.collection('sessions').get();
    const realSessions = allSessions.docs.filter(d => !d.data().is_test);
    const testSessions = allSessions.docs.filter(d => d.data().is_test);

    // Per-game breakdown
    const gameTypes = ['centipede','bart','duel','dutch_auction','dutch-auction','commons','beauty_contest','high_card'];
    const gameStats = {};

    const allResults = await db.collection('game_results').get();
    for (const gt of gameTypes) {
      const real = allResults.docs.filter(d => d.data().game_type === gt && !d.data().is_test);
      const count = real.length;
      let phase = 1, blendWeight = 0;
      if (count >= PHASE3_THRESHOLD)      { phase = 3; blendWeight = 0.95; }
      else if (count >= PHASE2_THRESHOLD) { phase = 2; blendWeight = +(count - PHASE2_THRESHOLD)/(PHASE3_THRESHOLD - PHASE2_THRESHOLD); }
      gameStats[gt] = { count, phase, blend_weight: +blendWeight.toFixed(3), needed_for_phase2: Math.max(0, PHASE2_THRESHOLD - count) };
    }

    return res.status(200).json({
      total_sessions:      allSessions.size,
      real_sessions:       realSessions.length,
      test_sessions:       testSessions.length,
      unique_players:      [...new Set(realSessions.map(d => d.data().player_id))].length,
      phase2_threshold:    PHASE2_THRESHOLD,
      phase3_threshold:    PHASE3_THRESHOLD,
      game_stats:          gameStats,
      generated_at:        new Date().toISOString(),
    });
  } catch (err) {
    console.error('[DevStats] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
