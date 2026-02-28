const pool = require('../db');

const deactivateUser = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      UPDATE users
      SET is_active = false
      WHERE id = $1
      RETURNING id, username, is_active;
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User deactivated successfully' });

  } catch (error) {
    console.error("DEACTIVATE USER ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// reactivar usuario
const activateUser = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      UPDATE users
      SET is_active = true
      WHERE id = $1
      RETURNING id, username, is_active;
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User activated successfully' });

  } catch (error) {
    console.error("ACTIVATE USER ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  deactivateUser,
  activateUser,
  activateUser
};