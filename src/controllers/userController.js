const pool = require('../db');

const deactivateUser = async (req, res) => {
  // Disabled: there is no account-recovery/admin mechanism yet, so allowing
  // even self-deactivation risks a permanent lockout once the JWT expires
  // (login requires is_active = true, and only the owner can reactivate).
  return res.status(403).json({ message: 'Account deactivation is currently disabled' });
};

// reactivar usuario
const activateUser = async (req, res) => {
  const { id } = req.params;

  if (id.toLowerCase() !== req.user.id.toLowerCase()) {
    return res.status(403).json({ message: 'You can only activate your own account' });
  }

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
  activateUser
};