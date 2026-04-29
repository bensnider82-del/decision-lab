/* ============================================================
   DECISION LAB — FIREBASE CLOUD FUNCTION
   File: functions/index.js

   SETUP:
   npm install -g firebase-tools
   firebase init functions   (choose JavaScript, Firestore)
   firebase deploy --only functions

   This function receives ONE POST per session containing
   all 5 game results, validates everything, and writes to
   two Firestore collections:
     - sessions          (one document per session)
     - game_results      (five documents per session)

   FIRESTORE STRUCTURE:
   /sessions/{session_id}
   /game_results/{result_id}   (result_id = session_id + "_" + game_type)
============================================================ */

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

// ── Constants ────────────────────────────────────────────────
const VALID_GAMES    = ['centipede', 'bart', 'duel', 'dutch_auction', 'commons'];
const REQUIRED_GAMES = 5;
const MAX_BALANCE    = 500;
const MIN_BALANCE    = 0;
const MAX_NAME_LEN   = 40;
const RATE_LIMIT_MS  = 30_000; // 30 seconds between submissions per player_id

// ── Main endpoint ─────────────────────────────────────────────
exports.submitSession = functions.https.onRequest(async (req, res) => {
  // CORS — allow your domain only in production
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { session, game_results } = req.body;

    // ── 1. Validate session object ──────────────────────────
    const sessionErr = validateSession(session);
    if (sessionErr) {
      console.warn('[Submit] Session validation failed:', sessionErr);
      return res.status(400).json({ error: sessionErr });
    }

    // ── 2. Validate game results array ──────────────────────
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

    // ── 3. Verify balance arithmetic is consistent ──────────
    const computedFinal = game_results.reduce((bal, gr) => {
      return Math.round((bal + gr.winnings) * 100) / 100;
    }, 100);
    if (Math.abs(computedFinal - session.final_balance) > 0.05) {
      return res.status(400).json({
        error: `Balance mismatch: computed ${computedFinal}, claimed ${session.final_balance}`
      });
    }

    // ── 4. Rate limiting ─────────────────────────────────────
    // Look up last submission time for this player_id
    const playerId   = session.player_id || req.ip;
    const rateLimRef = db.collection('_rate_limits').doc(playerId);
    const rateLimDoc = await rateLimRef.get();
    if (rateLimDoc.exists) {
      const lastMs = rateLimDoc.data().last_submission_ms;
      if (Date.now() - lastMs < RATE_LIMIT_MS) {
        return res.status(429).json({ error: 'Please wait before submitting again.' });
      }
    }

    // ── 5. Write to Firestore (batch write — atomic) ─────────
    const batch      = db.batch();
    const serverTime = admin.firestore.FieldValue.serverTimestamp();

    // Session document
    const sessionDoc = db.collection('sessions').doc(session.session_id);
    batch.set(sessionDoc, {
      ...session,
      timestamp:    serverTime,         // always use server time, never client
      player_id:    playerId,
      server_final_balance: computedFinal, // our computed version — source of truth
    });

    // Five game_result documents
    for (const gr of game_results) {
      const grDoc = db.collection('game_results').doc(gr.result_id);
      batch.set(grDoc, {
        ...gr,
        session_id:  session.session_id,
        player_id:   playerId,
        timestamp:   serverTime,
      });
    }

    // Update rate limit record
    batch.set(rateLimRef, { last_submission_ms: Date.now() });

    await batch.commit();
    console.log('[Submit] Session written:', session.session_id);

    // ── 6. Return leaderboard data ───────────────────────────
    const top100 = await db.collection('sessions')
      .orderBy('server_final_balance', 'desc')
      .limit(100)
      .get();

    const leaderboard = top100.docs.map((doc, i) => ({
      rank:         i + 1,
      name:         doc.data().player_name,
      balance:      doc.data().server_final_balance,
      session_id:   doc.id,
    }));

    // Calculate percentile for this player
    const allScores = await db.collection('sessions')
      .orderBy('server_final_balance', 'desc')
      .get();
    const totalSessions   = allScores.size;
    const rank            = allScores.docs.findIndex(d => d.id === session.session_id) + 1;
    const percentileRank  = totalSessions > 1
      ? Math.round((1 - (rank - 1) / (totalSessions - 1)) * 100)
      : 100;

    return res.status(200).json({
      ok:              true,
      session_id:      session.session_id,
      final_balance:   computedFinal,
      percentile:      percentileRank,       // "top X% of players"
      total_players:   totalSessions,
      leaderboard,
    });

  } catch (err) {
    console.error('[Submit] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Validation helpers ────────────────────────────────────────

function validateSession(s) {
  if (!s || typeof s !== 'object')                 return 'Missing session object';
  if (!s.session_id || typeof s.session_id !== 'string') return 'Missing session_id';
  if (s.session_id.length > 60)                   return 'session_id too long';
  if (!s.player_name || typeof s.player_name !== 'string') return 'Missing player_name';
  if (s.player_name.trim().length === 0)           return 'player_name is empty';
  if (s.player_name.length > MAX_NAME_LEN)        return 'player_name too long';
  if (s.games_played !== 5)                        return 'games_played must be 5';
  if (typeof s.final_balance !== 'number')         return 'final_balance must be a number';
  if (s.final_balance < MIN_BALANCE)              return `final_balance below minimum ${MIN_BALANCE}`;
  if (s.final_balance > MAX_BALANCE)              return `final_balance above maximum ${MAX_BALANCE}`;
  if (typeof s.hints_enabled !== 'boolean')        return 'hints_enabled must be boolean';
  if (!Array.isArray(s.game_order))               return 'game_order must be an array';
  if (s.game_order.length !== 5)                  return 'game_order must have 5 entries';
  for (const g of s.game_order) {
    if (!VALID_GAMES.includes(g))                 return `Unknown game type: ${g}`;
  }
  return null; // valid
}

function validateGameResult(gr, sessionId) {
  if (!gr || typeof gr !== 'object')               return 'Missing game result object';
  if (!gr.result_id)                               return 'Missing result_id';
  if (!gr.result_id.startsWith(sessionId))        return 'result_id does not match session_id';
  if (!VALID_GAMES.includes(gr.game_type))        return `Unknown game_type: ${gr.game_type}`;
  if (typeof gr.game_index !== 'number')           return 'game_index must be a number';
  if (gr.game_index < 0 || gr.game_index > 4)    return 'game_index out of range';
  if (typeof gr.balance_at_start !== 'number')    return 'balance_at_start must be a number';
  if (typeof gr.winnings !== 'number')             return 'winnings must be a number';
  if (gr.winnings < -200 || gr.winnings > 200)   return `winnings ${gr.winnings} out of plausible range`;
  if (typeof gr.game_params !== 'object')          return 'game_params must be an object';
  return null;
}


/* ============================================================
   LEADERBOARD ENDPOINT (read-only, no auth required)
   GET /leaderboard
============================================================ */
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
      date:    doc.data().timestamp?.toDate()?.toISOString() || null,
    }));

    const total = (await db.collection('sessions').count().get()).data().count;

    return res.status(200).json({ leaderboard, total_sessions: total });
  } catch (err) {
    console.error('[Leaderboard] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
