import jwt from 'jsonwebtoken';
import { pool } from './db.js';
export function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters');
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, secret, { expiresIn: '8h', issuer: 'campussync-api' });
}
export async function authenticate(req, res, next) {
  try {
    const value = req.get('authorization') || '';
    const token = value.startsWith('Bearer ') ? value.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'campussync-api' });
    const result = await pool.query('SELECT id,email,full_name,role,active,must_change_password FROM app_users WHERE id=$1', [decoded.sub]);
    const user = result.rows[0];
    if (!user || !user.active || user.role !== decoded.role) return res.status(401).json({ error: 'Invalid session' });
    if (user.must_change_password && !['/auth/change-password','/auth/me','/auth/logout'].includes(req.path)) return res.status(403).json({ error: 'Password change required before accessing this resource.', code: 'PASSWORD_CHANGE_REQUIRED' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}
export const allow = (...roles) => (req,res,next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  next();
};
