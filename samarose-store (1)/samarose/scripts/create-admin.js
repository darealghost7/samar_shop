import '../lib/env.js';
import { db } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';

const [email, password, role = 'owner'] = process.argv.slice(2);
if (!email || !password || password.length < 10 || !['owner', 'staff'].includes(role)) {
  console.error('Usage: npm run create-admin -- email "password (10+ characters)" [owner|staff]');
  process.exit(1);
}
const hash = await hashPassword(password);
db.prepare("INSERT INTO users(email,password_hash,role) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role").run(email.toLowerCase(), hash, role);
console.log(`Saved ${role} account for ${email}`);
