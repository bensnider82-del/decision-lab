const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const VALID_GAMES    = ['centipede', 'bart', 'duel', 'dutch_auction', 'dutch-auction', 'commons', 'beauty_contest'];
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
    const sessionDoc = db.collection('sessions').doc(session.session_id);
    batch.set(sessionDoc, {
      ...session,
      timestamp:            serverTime,
      player_id:            playerId,
      server_final_balance: computedFinal,
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
