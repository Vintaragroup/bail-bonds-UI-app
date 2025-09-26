import express from 'express';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import User from '../models/User.js';
import { requireAuth, optionalAuth, setSessionCookie, clearSessionCookie } from '../middleware/auth.js';

const router = express.Router();

const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 24 * 14);

function sanitizeUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    roles: user.roles,
    departments: user.departments,
    status: user.status,
    mfaEnforced: user.mfaEnforced,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

router.post('/session', async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) {
    return res.status(400).json({ message: 'idToken is required' });
  }

  try {
    const decoded = await firebaseAuth.verifyIdToken(idToken, true);
    const updates = {
      email: decoded.email?.toLowerCase() || undefined,
      emailVerified: decoded.email_verified || false,
      displayName: decoded.name || undefined,
      lastLoginAt: new Date(),
    };
    const options = { new: true, upsert: true, setDefaultsOnInsert: true };
    const userDoc = await User.findOneAndUpdate({ uid: decoded.uid }, updates, options);

    await setSessionCookie(res, idToken);
    return res.json({
      ok: true,
      user: sanitizeUser(userDoc),
      sessionExpiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString(),
    });
  } catch (err) {
    console.error('Failed to create session:', err);
    return res.status(401).json({ message: 'Invalid ID token' });
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
});

router.get('/me', optionalAuth, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  return res.json({ ok: true, user: req.user });
});

router.post('/session/revoke', requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    await firebaseAuth.revokeRefreshTokens(uid);
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Failed to revoke sessions:', err);
    return res.status(500).json({ message: 'Failed to revoke sessions' });
  }
});

export default router;
