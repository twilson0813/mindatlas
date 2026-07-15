/**
 * Seed script to create an admin user.
 * 
 * Usage:
 *   npx tsx scripts/seed-admin.ts
 * 
 * Requires DATABASE_URL environment variable.
 */
import bcrypt from 'bcrypt';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const ADMIN_EMAIL = 'kn4yvv@gmail.com';
const ADMIN_PASSWORD = 'MindAtlas2024!'; // Change this after first login
const BCRYPT_COST = 12;

async function main() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    // Hash the password
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_COST);

    // Check if user already exists
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [ADMIN_EMAIL]);
    
    let userId: string;

    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
      console.log(`User already exists: ${userId}`);
    } else {
      // Create the user
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, role) 
         VALUES ($1, $2, 'admin') 
         RETURNING id`,
        [ADMIN_EMAIL, passwordHash]
      );
      userId = userResult.rows[0].id;
      console.log(`Created user: ${userId}`);
    }

    // Get super_admin role
    const roleResult = await client.query(
      "SELECT id FROM admin_roles WHERE name = 'super_admin'"
    );

    if (roleResult.rows.length === 0) {
      console.error('ERROR: super_admin role not found. Run migrations first.');
      process.exit(1);
    }

    const roleId = roleResult.rows[0].id;

    // Check if admin_user record already exists
    const existingAdmin = await client.query(
      'SELECT id FROM admin_users WHERE user_id = $1',
      [userId]
    );

    if (existingAdmin.rows.length > 0) {
      console.log(`Admin record already exists for user ${userId}`);
    } else {
      // Create admin_user record
      await client.query(
        `INSERT INTO admin_users (user_id, role_id, mfa_enabled)
         VALUES ($1, $2, false)`,
        [userId, roleId]
      );
      console.log(`Admin record created with super_admin role`);
    }

    console.log(`\nAdmin user ready:`);
    console.log(`  Email: ${ADMIN_EMAIL}`);
    console.log(`  Password: ${ADMIN_PASSWORD}`);
    console.log(`  Role: super_admin`);
    console.log(`\n⚠️  Change this password after first login!`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Failed to seed admin:', err);
  process.exit(1);
});
