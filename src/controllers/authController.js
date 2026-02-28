const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const register = async (req, res) => {
  const { username, email, password } = req.body;

  try {
    console.log("REGISTER BODY:", req.body);

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const userExists = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username, email, hashedPassword]
    );

    console.log("USER INSERTED:", newUser.rows[0]);

    res.status(201).json(newUser.rows[0]);

  } catch (error) {
    console.error("REGISTER ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;

  try {

    if (!email || !password) {
      console.log("VALIDATION FAILED - EMAIL OR PASSWORD MISSING");
      return res.status(400).json({ message: 'Email and password required' });
    }

    const result = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE email = $1  AND is_active = true',
      [email]
    );

    if (result.rows.length === 0) {
      console.log("USER NOT FOUND");
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    //bloquear si hay más de 5 intentos fallidos en 15 minutos
    // const failedAttempts = await pool.query(
    //   'SELECT COUNT(*) as count FROM failed_login_attempts WHERE email = $1 AND attempt_time > NOW() - INTERVAL \'15 minutes\'',
    //   [email]
    // );

    // if (failedAttempts.rows[0].count >= 5) {
    //   return res.status(400).json({ message: 'Too many failed login attempts. Please try again later.' });
    // }

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      console.log("PASSWORD INCORRECTO");
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({ token });

  } catch (error) {
    console.error("LOGIN ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { register, login };