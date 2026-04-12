import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prepare } from '../config/database.js';

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'JWT_SECRET not configured' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const getProfile = (req, res) => {
  const user = prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
};
